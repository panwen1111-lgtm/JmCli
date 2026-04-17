const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

/**
 * CLI Adapter - 负责与 dreamina.exe 交互
 */
class CliAdapter {
    constructor(exePath) {
        this.exePath = exePath;
    }

    /**
     * 通用執行命令方法
     * @param {string[]} args 参数数组
     * @param {string} input (可选) 写入 stdin 的数据 (如登录 JSON)
     */
    run(args, input = null) {
        return new Promise((resolve) => {
            const child = spawn(this.exePath, args, {
                shell: false,
                windowsHide: true
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
