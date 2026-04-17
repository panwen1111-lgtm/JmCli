const axios = require('axios');
const CliAdapter = require('./cli_adapter');
const path = require('path');
const fs = require('fs');

// CLI 路径 (根据实际位置调整)
const EXE_PATH = path.resolve(__dirname, '..', 'dreamina.exe');
const cli = new CliAdapter(EXE_PATH);
const SERVER_URL = 'http://localhost:3000';

async function runWorker() {
    console.log('[Worker] CLI 仿真节点启动，正在监听任务队列...');
    
    while (true) {
        try {
            const response = await axios.get(`${SERVER_URL}/fetch-task`);
            const task = response.data;
            console.log(`[Worker] 领取任务: ${task.id} - Prompt: ${task.prompt}`);

            try {
                const result = await executeCliTask(task);
                await axios.post(`${SERVER_URL}/complete-task`, {
                    id: task.id,
                    status: 'completed',
                    result: result
                });
                console.log(`[Worker] 任务 ${task.id} 成功完成`);
            } catch (execErr) {
                await axios.post(`${SERVER_URL}/complete-task`, {
                    id: task.id,
                    status: 'failed',
                    error: execErr.message
                });
                console.error(`[Worker] 任务 ${task.id} 执行失败:`, execErr.message);
            }

        } catch (err) {
            if (err.response && err.response.status === 404) {
            } else {
                console.error('[Worker] 轮询异常:', err.message);
            }
        }
        await new Promise(r => setTimeout(r, 5000));
    }
}

async function executeCliTask(task) {
    // 1. 恢复登录态 (Session Hosting 核心步奏)
    // 假设 task.session 是从 dreamina login 获取的完整 JSON 字符串
    if (task.session) {
        console.log('[Worker] 正在恢复登录态...');
        const importRes = await cli.run(['import_login_response'], task.session);
        if (!importRes.success) {
            throw new Error(`Session 注入失败: ${importRes.output}`);
        }
        console.log('[Worker] 登录态注入成功');
    }

    // 2. 执行生图任务
    console.log('[Worker] 正在执行生图任务...');
    const genRes = await cli.run([
        'text2image',
        `--prompt=${task.prompt}`,
        '--ratio=1:1',
        '--resolution_type=2k',
        '--poll=1' // 开启轮询，等待生成结束
    ]);

    if (!genRes.success) {
        throw new Error(`生成失败: ${genRes.output}`);
    }

    // 3. 解析结果 (从 CLI stdout 中提取 JSON)
    const data = cli.parseJson(genRes.output);
    if (!data || data.gen_status !== 'success') {
        throw new Error(`CLI 返回异常回执: ${genRes.output}`);
    }

    // 处理图片 URL
    let imageUrl = null;
    if (data.result_json && data.result_json.images && data.result_json.images.length > 0) {
        imageUrl = data.result_json.images[0].url || data.result_json.images[0].path;
    }

    return {
        submit_id: data.submit_id,
        image_url: imageUrl,
        raw: data
    };
}

runWorker();
