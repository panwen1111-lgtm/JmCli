const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * CLI Adapter - 负责与 dreamina.exe 交互
 */
class CliAdapter {
    constructor(exePath, profilePath = null) {
        this.exePath = exePath;
        this.profilePath = profilePath; // 隔离的运行环境路径 (关键)
    }

    /**
     * 通用執行命令方法
     */
    run(args, input = null) {
        return new Promise((resolve) => {
            // 核心隔离逻辑：注入 USERPROFILE 环境变量
            const spawnEnv = { ...process.env };
            if (this.profilePath) {
                spawnEnv.USERPROFILE = this.profilePath;
                spawnEnv.HOME = this.profilePath;
            }

            const child = spawn(this.exePath, args, {
                shell: false,
                windowsHide: true,
                env: spawnEnv // 应用环境变量
            });

            let stdout = '';
            let stderr = '';

            if (input && child.stdin) {
                child.stdin.write(input);
                child.stdin.end();
            }

            child.stdout.on('data', (data) => {
                stdout += data.toString();
            });

            child.stderr.on('data', (data) => {
                stderr += data.toString();
            });

            child.on('close', (code) => {
                const combined = (stdout + stderr).trim();
                if (code === 0) {
                    resolve({ success: true, output: combined });
                } else {
                    resolve({ success: false, output: combined, code });
                }
            });

            child.on('error', (err) => {
                resolve({ success: false, error: err.message });
            });
        });
    }

    /**
     * 流式执行命令 (用于登录等交互式命令)
     */
    spawn(args) {
        const spawnEnv = { ...process.env };
        if (this.profilePath) {
            spawnEnv.USERPROFILE = this.profilePath;
            spawnEnv.HOME = this.profilePath;
        }

        return spawn(this.exePath, args, {
            shell: false,
            windowsHide: true,
            env: spawnEnv
        });
    }

    /**
     * 解析 CLI 输出中的登录 URL (双模态)
     */
    parseLoginUrl(output) {
        const urls = output.match(/https:\/\/jimeng\.jianying\.com\/[^\s'"]+/g);
        if (!urls) return null;
        
        // 抓取包含 dreamina_cli_login 的凭证直读链接 (Step 2)
        const step2 = urls.find(u => u.includes('dreamina_cli_login'));
        // 抓取包含 ai-tool/login 的登录引导链接 (Step 1)
        const step1 = urls.find(u => u.includes('ai-tool/login'));

        return {
            step1: step1 || urls[0],
            step2: step2 || step1 || urls[0]
        };
    }

    /**
     * 解析 CLI 输出中的 JSON
     */
    parseJson(str) {
        try {
            const match = str.match(/\{[\s\S]*\}/);
            if (match) return JSON.parse(match[0]);
        } catch (e) {
            return null;
        }
    }
}

module.exports = CliAdapter;
