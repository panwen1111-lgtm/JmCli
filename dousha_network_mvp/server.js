const express = require('express');
const app = express();
const port = 3000;

app.use(express.json());

// 内存任务队列
let tasks = [];
let taskIdCounter = 1;

// 1. 提交任务
app.post('/submit', (req, res) => {
    const { prompt, session } = req.body;
    const task = {
        id: taskIdCounter++,
        prompt,
        session, // 登陆凭证 (Cookies/LocalStorage)
        status: 'pending',
        result: null,
        createdAt: new Date()
    };
    tasks.push(task);
    console.log(`[Server] 新任务已提交: ${task.id}`);
    res.json({ success: true, taskId: task.id });
});

// 2. Worker 获取任务 (给 Worker 调用的接口)
app.get('/fetch-task', (req, res) => {
    const task = tasks.find(t => t.status === 'pending');
    if (task) {
        task.status = 'processing';
        console.log(`[Server] 任务 ${task.id} 已分发给 Worker`);
        res.json(task);
    } else {
        res.status(404).json({ error: '没有待处理任务' });
    }
});

// 3. Worker 提交结果
app.post('/complete-task', (req, res) => {
    const { id, status, result, error } = req.body;
    const task = tasks.find(t => t.id === id);
    if (task) {
        task.status = status; // 'completed' or 'failed'
        task.result = result;
        task.error = error;
        console.log(`[Server] 任务 ${id} 已完成: ${status}`);
        res.json({ success: true });
    } else {
        res.status(404).json({ error: '任务不存在' });
    }
});

// 4. 用户查询状态
app.get('/status/:id', (req, res) => {
    const id = parseInt(req.params.id);
    const task = tasks.find(t => t.id === id);
    if (task) {
        res.json(task);
    } else {
        res.status(404).json({ error: '任务不存在' });
    }
});

app.listen(port, () => {
    console.log(`[Server] Dousha MVP 控制中心运行在 http://localhost:${port}`);
});
