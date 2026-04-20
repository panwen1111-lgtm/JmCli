const express = require('express');
const db = require('./database');
const path = require('path');
const fs = require('fs');
const os = require('os');
const CliAdapter = require('./cli_adapter');

const EXE_PATH = path.resolve(__dirname, '..', 'dreamina.exe');
const cli = new CliAdapter(EXE_PATH);
const app = express();
const PORT = 3000;

// 登录状态缓存
let loginSession = {
    process: null,
    status: 'idle', // idle, starting, waiting_for_login, success, error
    url: null,
    result: null,
    error: null
};

app.use(express.json());
// 托管静态页面
app.use(express.static(path.join(__dirname, 'public')));

// --- 供应端端接口 (Provider) ---

// 启动集成登录
app.get('/api/login/start', (req, res) => {
    console.log('[Server] 接收到登录启动请求...');
    if (loginSession.process) {
        console.log('[Server] 正在清理旧进程 PID:', loginSession.process.pid);
        loginSession.process.kill();
    }

    try {
        const proc = cli.spawn(['login', '--debug']);
        loginSession = {
            process: proc,
            status: 'starting',
            url: null,
            result: null,
            error: null
        };

        console.log('[Server] CLI 登录进程已启动, PID:', proc.pid);

        let fullOutput = '';

        // 监听标准输出
        proc.stdout.on('data', (data) => {
            const str = data.toString('utf8');
            fullOutput += str;
            console.log(`[CLI Stdout PID:${proc.pid}]`, str);

            if (!loginSession.url) {
                const url = cli.parseLoginUrl(str);
                if (url) {
                    console.log('[Server] 成功捕获登录 URL:', url);
                    loginSession.url = url;
                    loginSession.status = 'waiting_for_login';
                }
            }

            if (str.includes('[DREAMINA:LOGIN_SUCCESS]') || str.includes('[DREAMINA:LOGIN_REUSED]')) {
                console.log('[Server] 检测到登录成功或复用态');
                
                // 尝试从本地配置文件读取 JSON
                try {
                    const credPath = path.join(os.homedir(), '.dreamina_cli', 'credential.json');
                    if (fs.existsSync(credPath)) {
                        const content = fs.readFileSync(credPath, 'utf8');
                        loginSession.result = content;
                        loginSession.status = 'success';
                        console.log('[Server] 已从本地成功读取 Session JSON');
                    } else {
                        // 如果文件不存在，再尝试解析输出（备选）
                        const json = cli.parseJson(fullOutput);
                        if (json) {
                            loginSession.result = JSON.stringify(json);
                            loginSession.status = 'success';
                        }
                    }
                } catch (e) {
                    console.error('[Server] 读取本地凭证失败:', e.message);
                }
                
                proc.kill();
                loginSession.process = null;
            }
        });

        // 监听错误输出
        proc.stderr.on('data', (data) => {
            const errStr = data.toString('utf8');
            console.error(`[CLI Stderr PID:${proc.pid}]`, errStr);
            // 某些情况下 URL 可能会在 stderr 输出
            if (!loginSession.url) {
                const url = cli.parseLoginUrl(errStr);
                if (url) {
                    loginSession.url = url;
                    loginSession.status = 'waiting_for_login';
                }
            }
        });

        proc.on('close', (code) => {
            console.log(`[Server] CLI 进程 PID:${proc.pid} 已退出，退出码: ${code}`);
            if (loginSession.status === 'starting' || loginSession.status === 'waiting_for_login') {
                 if (code !== 0) {
                     loginSession.status = 'error';
                     loginSession.error = `进程异常退出 (码:${code})`;
                 }
            }
        });

        res.json({ success: true });
    } catch (err) {
        console.error('[Server] 启动登录进程失败:', err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/login/status', (req, res) => {
    const { process, ...state } = loginSession;
    res.json(state);
});

app.post('/api/login/stop', (req, res) => {
    if (loginSession.process) {
        loginSession.process.kill();
        loginSession.process = null;
    }
    loginSession.status = 'idle';
    res.json({ success: true });
});

// 提交托管 Session
app.post('/api/accounts', (req, res) => {
    const { userName, loginJson } = req.body;
    if (!userName || !loginJson) return res.status(400).json({ error: '缺少参数' });
    
    try {
        const id = db.saveAccount(userName, loginJson);
        res.json({ success: true, accountId: id });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 获取账号列表
app.get('/api/accounts', (req, res) => {
    res.json(db.getAccounts());
});

// --- 消费端接口 (Consumer) ---

// 提交任务
app.post('/api/submit', (req, res) => {
    const { prompt, accountId } = req.body;
    if (!prompt) return res.status(400).send('Prompt is required');
    
    try {
        const taskId = db.submitTask(prompt, accountId);
        console.log(`[Server] 新任务已提交: ${taskId} (指定账号: ${accountId || '无'})`);
        res.json({ taskId });
    } catch (err) {
        res.status(500).send(err.message);
    }
});

// 获取所有任务状态
app.get('/api/tasks', (req, res) => {
    res.json(db.getTasks());
});

// 查询特定任务状态
app.get('/status/:id', (req, res) => {
    const tasks = db.getTasks(100);
    const task = tasks.find(t => t.id == req.params.id);
    if (!task) return res.status(404).send('Task not found');
    res.json(task);
});

// --- Worker 接口 ---

// Worker 领取任务 (原子化操作)
app.get('/fetch-task', (req, res) => {
    const task = db.fetchPendingTask();
    if (task) {
        console.log(`[Server] 任务 ${task.id} 已分发给 Worker`);
        res.json(task);
    } else {
        res.status(404).send('No tasks available');
    }
});

// Worker 完成任务汇报
app.post('/complete-task', (req, res) => {
    const { id, status, result, error } = req.body;
    db.updateTaskResult(id, status, result ? result.image_url : null, error);
    console.log(`[Server] 任务 ${id} 已完成: ${status}`);
    res.send('Result saved');
});

// --- 页面路由 ---
app.get('/provider', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'provider.html'));
});

app.get('/consumer', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'consumer.html'));
});

app.listen(PORT, () => {
    console.log('====================================================');
    console.log(`🚀 Dousha Network Phase 2 运行在 http://localhost:${PORT}`);
    console.log(`➡️  供应端: http://localhost:${PORT}/provider`);
    console.log(`➡️  消费端: http://localhost:${PORT}/consumer`);
    console.log('====================================================');
});
