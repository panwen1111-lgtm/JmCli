const BetterSqlite3 = require('better-sqlite3');
const path = require('path');

console.log('[DB] Connecting to SQLite...');
const GLOBAL_DB = new BetterSqlite3(path.join(__dirname, 'dousha_network.db'));
console.log('[DB] Database connected successfully.');

GLOBAL_DB.exec(`
  CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_name TEXT NOT NULL,
    login_json TEXT NOT NULL,
    points INTEGER DEFAULT 1000,
    status TEXT DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER,
    prompt TEXT NOT NULL,
    status TEXT DEFAULT 'pending',
    result_url TEXT,
    error_msg TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id)
  );
`);

function fetchPendingTask() {
    try {
        const logic = GLOBAL_DB.transaction(function() {
            // 1. 找一个 pending 的任务
            const t = GLOBAL_DB.prepare("SELECT * FROM tasks WHERE status = 'pending' LIMIT 1").get();
            if (!t) return null;

            // 2. 确定账号：如果任务已指定则取指定账号，否则随机取一个活跃账号
            let a;
            if (t.account_id) {
                a = GLOBAL_DB.prepare("SELECT * FROM accounts WHERE id = ? AND status = 'active'").get(t.account_id);
            } else {
                a = GLOBAL_DB.prepare("SELECT * FROM accounts WHERE status = 'active' ORDER BY RANDOM() LIMIT 1").get();
            }
            
            if (!a) return null;

            // 3. 锁定任务
            GLOBAL_DB.prepare("UPDATE tasks SET status = 'processing', account_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
              .run(a.id, t.id);

            return {
                id: t.id,
                prompt: t.prompt,
                session: a.login_json,
                account_id: a.id
            };
        });
        return logic();
    } catch (err) {
        console.error('[DB Error in fetchPendingTask]:', err.message);
        return null;
    }
}

function updateTaskResult(id, status, resultUrl, errorMsg) {
    try {
        GLOBAL_DB.prepare("UPDATE tasks SET status = ?, result_url = ?, error_msg = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
          .run(status, resultUrl, errorMsg, id);
    } catch (err) {
        console.error('[DB Error in updateTaskResult]:', err.message);
    }
}

function submitTask(prompt, accountId = null) {
    try {
        const res = GLOBAL_DB.prepare("INSERT INTO tasks (prompt, account_id) VALUES (?, ?)").run(prompt, accountId);
        return res.lastInsertRowid;
    } catch (err) {
        console.error('[DB Error in submitTask]:', err.message);
        throw err;
    }
}

function saveAccount(userName, loginJson) {
    try {
        const existing = GLOBAL_DB.prepare("SELECT id FROM accounts WHERE user_name = ?").get(userName);
        if (existing) {
            GLOBAL_DB.prepare("UPDATE accounts SET login_json = ?, status = 'active' WHERE id = ?").run(loginJson, existing.id);
            return existing.id;
        } else {
            const res = GLOBAL_DB.prepare("INSERT INTO accounts (user_name, login_json) VALUES (?, ?)").run(userName, loginJson);
            return res.lastInsertRowid;
        }
    } catch (err) {
        console.error('[DB Error in saveAccount]:', err.message);
        throw err;
    }
}

function getTasks(limit = 10) {
    return GLOBAL_DB.prepare("SELECT * FROM tasks ORDER BY created_at DESC LIMIT ?").all(limit);
}

function getAccounts() {
    return GLOBAL_DB.prepare("SELECT id, user_name, points, status, created_at FROM accounts").all();
}

module.exports = {
    fetchPendingTask,
    updateTaskResult,
    submitTask,
    saveAccount,
    getTasks,
    getAccounts
};
