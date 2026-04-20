const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'dousha_network.db'));

const accounts = db.prepare("SELECT * FROM accounts").all();
console.log('--- Accounts in Database ---');
console.table(accounts);

const tasks = db.prepare("SELECT * FROM tasks").all();
console.log('\n--- Tasks in Database ---');
console.table(tasks);
