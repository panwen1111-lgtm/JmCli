const express = require('express');
const db = require('./database');
const path = require('path');
const fs = require('fs');
const CliAdapter = require('./cli_adapter');

const PORT = 3000;
const EXE_PATH = path.resolve(__dirname, 'dreamina.exe');
const GLOBAL_DOWNLOAD_DIR = path.join(__dirname, 'public', 'outputs');
const CONCURRENCY = 4;

const C = {
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    cyan: '\x1b[36m',
    red: '\x1b[31m',
    reset: '\x1b[0m',
    bold: '\x1b[1m'
};

if (!fs.existsSync(GLOBAL_DOWNLOAD_DIR)) fs.mkdirSync(GLOBAL_DOWNLOAD_DIR, { recursive: true });

const nodes = [];
for (let i = 1; i <= CONCURRENCY; i++) {
    const profilePath = path.resolve(__dirname, 'nodes', `node_${i}`);
    if (!fs.existsSync(profilePath)) fs.mkdirSync(profilePath, { recursive: true });
    nodes.push({ id: i, cli: new CliAdapter(EXE_PATH, profilePath), profilePath });
}

const loginCli = nodes[0].cli;
let loginSession = { process: null, status: 'idle', urlObj: null, result: null };

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/outputs', express.static(GLOBAL_DOWNLOAD_DIR));

function injectCredential(node, sessionJson) {
    try {
        const configDir = path.join(node.profilePath, '.dreamina_cli');
        if (!fs.existsSync(configDir)) fs.mkdirSync(configDir, { recursive: true });
        fs.writeFileSync(path.join(configDir, 'credential.json'), sessionJson, 'utf8');
    } catch (e) {}
}

app.get('/api/login/start', (req, res) => {
    if (loginSession.process) loginSession.process.kill();
    try {
        const oldCred = path.join(nodes[0].profilePath, '.dreamina_cli', 'credential.json');
        if (fs.existsSync(oldCred)) fs.unlinkSync(oldCred);
    } catch (e) {}

    try {
        console.log(`${C.yellow}[CLI] 启动登录通道...${C.reset}`);
        const proc = loginCli.spawn(['relogin', '--debug']);
        loginSession = { process: proc, status: 'starting', urlObj: null, result: null };
        
        proc.stdout.on('data', (data) => {
            const str = data.toString('utf8');
            process.stdout.write(`${C.green}[OUT] ${C.reset}${str}`);
            const urls = loginCli.parseLoginUrl(str);
            if (urls && !loginSession.urlObj) {
                loginSession.urlObj = urls;
                loginSession.status = 'waiting_for_login';
                console.log(`${C.cyan}[System] 链接已抓取: \n  - 扫码页: ${urls.step1}\n  - 凭证页: ${urls.step2}${C.reset}`);
            }
        });

        proc.stderr.on('data', (data) => {
            process.stdout.write(`${C.red}[ERR] ${C.reset}${data.toString('utf8')}`);
        });

        proc.on('close', (code) => {
            console.log(`${C.yellow}[CLI] 登录进程退出 (代码: ${code})${C.reset}`);
        });

        res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, error: err.message }); }
});

app.get('/api/login/status', (req, res) => {
    const { process, ...state } = loginSession;
    res.json(state);
});

app.post('/api/accounts', (req, res) => {
    const { userName, loginJson } = req.body;
    db.saveAccount(userName, loginJson);
    console.log(`${C.green}[Database] 节点 [${userName}] 已手动入库成功${C.reset}`);
    res.json({ success: true });
});

app.get('/api/accounts', (req, res) => res.json(db.getAccounts()));
app.get('/api/accounts/raw', (req, res) => res.json(db.getAccountsRaw()));
app.delete('/api/accounts/:id', (req, res) => { res.json({ success: db.deleteAccount(req.params.id) }); });
app.post('/api/submit', (req, res) => { res.json({ taskId: db.submitTask(req.body.prompt, req.body.accountId) }); });
app.get('/api/tasks', (req, res) => res.json(db.getTasks()));

async function startNodeRunner(node) {
    console.log(`${C.cyan}[Node-${node.id}] 就绪.${C.reset}`);
    while (true) {
        try {
            const task = db.fetchPendingTask();
            if (task) {
                try {
                    const result = await executeCliTaskOnNode(node, task);
                    if (result.status === 'success') {
                        db.updateTaskResult(task.id, 'completed', result.image_url, null);
                    } else if (result.status === 'processing') {
                        db.updateTaskResult(task.id, 'pending', '正在处理...', null, result.submit_id);
                    }
                } catch (err) {
                    db.updateTaskResult(task.id, 'failed', null, err.message);
                }
            }
        } catch (e) {}
        await new Promise(r => setTimeout(r, 4000));
    }
}

async function executeCliTaskOnNode(node, task) {
    if (task.session) injectCredential(node, task.session);
    let args = task.submit_id ? ['query_result', `--submit_id=${task.submit_id}`, `--download_dir=${GLOBAL_DOWNLOAD_DIR}`] : ['text2image', `--prompt=${task.prompt}`, '--ratio=1:1', '--resolution_type=2k', '--poll=1'];
    const genRes = await node.cli.run(args);
    if (!genRes.success && task.submit_id) return { status: 'processing', submit_id: task.submit_id };
    if (!genRes.success) throw new Error(`CLI Error`);
    const res = node.cli.parseJson(genRes.output);
    const status = res.status || res.gen_status || (res.data && (res.data.status || res.data.gen_status));
    if (status === 'success' || status === 'completed') {
        let found = findUrlGreedily(res);
        if (found && !found.startsWith('http')) { const relativePath = path.relative(GLOBAL_DOWNLOAD_DIR, found).replace(/\\/g, '/'); found = `/outputs/${relativePath}`; }
        return { status: 'success', image_url: found };
    } else { return { status: 'processing', submit_id: res.submit_id || (res.data && res.data.submit_id) || task.submit_id }; }
}

function findUrlGreedily(obj) {
    if (!obj) return null;
    if (typeof obj === 'string') {
        const str = obj.trim();
        if (str.startsWith('http') && (str.includes('.png') || str.includes('.jpg'))) return str;
        if ((str.includes(':') || str.startsWith('/')) && (str.endsWith('.png') || str.endsWith('.jpg'))) return str;
        return null;
    }
    if (typeof obj === 'object') { for (const key in obj) { const found = findUrlGreedily(obj[key]); if (found) return found; } }
    return null;
}

app.get('/provider', (req, res) => res.sendFile(path.join(__dirname, 'public', 'provider.html')));
app.get('/consumer', (req, res) => res.sendFile(path.join(__dirname, 'public', 'consumer.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

app.listen(PORT, () => {
    console.log(`${C.cyan}🚀 Matrix Core 监听中 :${PORT}${C.reset}`);
    nodes.forEach(node => startNodeRunner(node));
});
