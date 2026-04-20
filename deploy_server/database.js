const fs = require('fs');
const path = require('path');

const DB_FILE = path.join(__dirname, 'dousha_network.json');
let data = { accounts: [], tasks: [], lastAccountId: 0, lastTaskId: 0 };

function load() {
    try {
        if (fs.existsSync(DB_FILE)) {
            const raw = fs.readFileSync(DB_FILE, 'utf8');
            data = JSON.parse(raw);
        }
    } catch (e) {}
}

function save() {
    try {
        fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
    } catch (e) {}
}

load();

/**
 * 原子化提取任务，支持多节点并发锁定
 */
function fetchPendingTask() {
    load();
    const now = Date.now();
    
    // 查找目标：1.刚进来的新单(pending)  2.正在生成且已超过5秒没查验过的老单(running)
    const taskIndex = data.tasks.findIndex(t => {
        if (t.status === 'pending') return true;
        if (t.status === 'running') {
            const lastUpdate = new Date(t.updated_at).getTime();
            return (now - lastUpdate) > 5000; // 冷却期 5 秒
        }
        return false;
    });

    if (taskIndex === -1) return null;
    const task = data.tasks[taskIndex];

    const activeAccounts = data.accounts.filter(a => a.status === 'active');
    if (activeAccounts.length === 0) return null;
    
    // 如果任务没指定账号，随机分配一个；如果指定了，就用那个
    let account = null;
    if (task.account_id) {
        // 强制转为数字进行匹配，防止前端传字符串导致的失效
        const targetId = parseInt(task.account_id);
        account = data.accounts.find(a => parseInt(a.id) === targetId);
    }
    
    if (!account) {
        account = activeAccounts[Math.floor(Math.random() * activeAccounts.length)];
    }

    // --- 锁定任务 ---
    task.status = 'working'; 
    task.account_id = account.id;
    task.updated_at = new Date().toISOString();
    save();

    return {
        id: task.id,
        prompt: task.prompt,
        session: account.login_json,
        account_id: account.id,
        account_name: account.user_name, // 传回名称用于日志
        submit_id: task.submit_id
    };
}

function updateTaskResult(id, status, resultUrl, errorMsg, submitId = null) {
    load();
    const task = data.tasks.find(t => t.id === id);
    if (task) {
        // 如果外部传进来是 pending，我们自动转为 running (表示已在路路上)
        task.status = (status === 'pending') ? 'running' : status;
        if (resultUrl) task.result_url = resultUrl;
        if (errorMsg) task.error_msg = errorMsg;
        if (submitId) task.submit_id = submitId;
        task.updated_at = new Date().toISOString();
        save();
    }
}

function submitTask(prompt, accountId = null) {
    load();
    data.lastTaskId++;
    const newTask = {
        id: data.lastTaskId,
        prompt: prompt,
        account_id: accountId ? parseInt(accountId) : null,
        status: 'pending',
        submit_id: null,
        result_url: null,
        error_msg: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
    data.tasks.push(newTask);
    save();
    return newTask.id;
}

function saveAccount(userName, loginJson) {
    load();
    let account = data.accounts.find(a => a.user_name === userName);
    if (account) {
        account.login_json = loginJson;
        account.status = 'active';
    } else {
        data.lastAccountId++;
        account = {
            id: data.lastAccountId,
            user_name: userName,
            login_json: loginJson,
            points: 1000,
            status: 'active',
            created_at: new Date().toISOString()
        };
        data.accounts.push(account);
    }
    save();
    return account.id;
}

function deleteAccount(id) {
    load();
    const targetId = parseInt(id);
    const initialLen = data.accounts.length;
    data.accounts = data.accounts.filter(a => parseInt(a.id) !== targetId);
    if (data.accounts.length !== initialLen) {
        save();
        return true;
    }
    return false;
}

function getTasks(limit = 10) { load(); return data.tasks.slice(-limit).reverse(); }
function getAccountsRaw() { load(); return data.accounts; }
function getAccounts() { load(); return data.accounts.map(a => ({ id: a.id, user_name: a.user_name, points: a.points, status: a.status, created_at: a.created_at })); }

module.exports = {
    fetchPendingTask,
    updateTaskResult,
    submitTask,
    saveAccount,
    deleteAccount, // 导出删除功能
    getTasks,
    getAccounts,
    getAccountsRaw
};
