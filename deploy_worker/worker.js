const axios = require('axios');
const CliAdapter = require('./cli_adapter');
const path = require('path');
const fs = require('fs');

// 生成一个随机 Worker ID 用于日志区分多人并发
const WORKER_ID = 'Worker-' + Math.random().toString(36).substring(2, 6).toUpperCase();

// CLI 路径（强制要求在同级目录）
const EXE_PATH = path.resolve(__dirname, 'dreamina.exe');
const cli = new CliAdapter(EXE_PATH);

// 服务器地址（支持通过参数传入，例如：node worker.js http://x.x.x.x:3000）
const SERVER_URL = process.argv[2] || 'http://localhost:3000';

async function runWorker() {
    console.log('====================================================');
    console.log(`[${WORKER_ID}] CLI 节点已启动，正在竞争任务队列...`);
    console.log('====================================================');
    
    while (true) {
        try {
            // 试图领取任务
            const response = await axios.get(`${SERVER_URL}/fetch-task`);
            const task = response.data;
            console.log(`\n[${WORKER_ID}] ✅ 成功抢到任务: ${task.id}`);
            console.log(`[${WORKER_ID}] 提示词: ${task.prompt}`);

            try {
                const result = await executeCliTask(task);
                // 提交执行结果
                await axios.post(`${SERVER_URL}/complete-task`, {
                    id: task.id,
                    status: 'completed',
                    result: result
                });
                console.log(`[${WORKER_ID}] 任务 ${task.id} 执行成功并提交结果`);
            } catch (execErr) {
                await axios.post(`${SERVER_URL}/complete-task`, {
                    id: task.id,
                    status: 'failed',
                    error: execErr.message
                });
                console.error(`[${WORKER_ID}] 任务 ${task.id} 失败:`, execErr.message);
            }

        } catch (err) {
            if (err.response && err.response.status === 404) {
                // 没任务，正常轮询
            } else {
                console.error(`[${WORKER_ID}] 轮询异常:`, err.message);
            }
        }
        // 每 5 秒轮询一次
        await new Promise(r => setTimeout(r, 5000));
    }
}

async function executeCliTask(task) {
    // 1. 恢复对应账号的登录态
    if (task.session) {
        console.log(`[${WORKER_ID}] 正在恢复账号 [ID:${task.account_id}] 的登录态...`);
        const importRes = await cli.run(['import_login_response'], task.session);
        if (!importRes.success) {
            throw new Error(`Session 注入失败: ${importRes.output}`);
        }
    }

    // 2. 执行生图任务
    console.log(`[${WORKER_ID}] 正在启动 dreamina.exe 执行 text2image...`);
    const genRes = await cli.run([
        'text2image',
        `--prompt=${task.prompt}`,
        '--ratio=1:1',
        '--resolution_type=2k',
        '--poll=1' 
    ]);

    if (!genRes.success) {
        throw new Error(`CLI 报错: ${genRes.output}`);
    }

    // 3. 解析 CLI 输出
    const data = cli.parseJson(genRes.output);
    if (!data) {
        throw new Error('无法解析 CLI 返回的 JSON');
    }

    if (data.gen_status !== 'success') {
        // 如果是在排队，返回当前状态
        return {
            status: data.gen_status,
            submit_id: data.submit_id,
            raw: data
        };
    }

    // 处理成功的图片
    let imageUrl = null;
    if (data.result_json && data.result_json.images && data.result_json.images.length > 0) {
        imageUrl = data.result_json.images[0].url || data.result_json.images[0].path;
    }

    return {
        submit_id: data.submit_id,
        image_url: imageUrl
    };
}

runWorker();
