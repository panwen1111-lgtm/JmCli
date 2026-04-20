# 即梦 CLI (Dreamina) 集成开发接口文档

## 1. 基础环境
*   **二进制文件**：`dreamina.exe` (需放置在项目根目录或指定路径)
*   **配置文件**：CLI 会在用户目录的 `.dreamina_cli/` 下自动生成并维护登录凭证 (`credential.json`)。
*   **核心特性**：采用异步提交 (`--poll=1`) + 轮询查询模式。

---

## 2. 文生图 (Text to Image) 调用规范

用于将纯文本 Prompt 转换为图像。

### A. 命令行格式
```bash
dreamina.exe text2image --prompt="[提示词]" --model_version="[模型ID]" --ratio="[比例]" --resolution_type="2k" --poll=1
```

### B. 核心参数说明
*   `--prompt`: 创意描述词。
*   `--model_version`: 推荐 `seedance2.0` (标准版) 或 `seedance2.0fast` (极速版)。
*   `--ratio`: 画幅比例，如 `16:9`, `1:1`, `9:16`。
*   `--resolution_type`: 默认建议设为 `2k`。
*   `--poll=1`: **关键参数**。设为 1 表示“提交后立即返回”，不阻塞等待生成，方便前端做异步队列。

---

## 3. 全能参考 (Multimodal Reference) 调用规范

这是最强大的生成模式，支持图片、视频、音频作为参考。

### A. 命令行格式
```bash
dreamina.exe multimodal2video --prompt="[提示词]" --image="[图片路径]" --video="[运镜参考路径]" --audio="[音色路径]" --model_version="seedance2.0" --ratio="16:9" --duration=5 --poll=1
```

### B. 参数进阶
*   `--image`: 角色或场景的主图参考（支持本地绝对路径）。
*   `--video`: 运镜/动作参考（支持本地 MP4）。
*   `--audio`: 音声/BGM 参考。
*   **逻辑说明**：即使目标是生图，在 CLI 中如果带有 `--image` 等参考项，命令类型通常切换为 `multimodal2video` 或 `multimodal2image`。

---

## 4. 返回参数解析 (Response Parsing)

CLI 的输出通常是文本混合 JSON 的形式。

### A. 提交成功响应
```json
{
  "success": true,
  "submit_id": "7361284592019485716",
  "message": "Task submitted successfully"
}
```
*   **解析重点**：抓取 `submit_id`。
*   **容错处理**：如果 JSON 解析失败，建议使用正则 `/(?:submit_id|taskId|ID)\s*[:=]\s*["']?([\w-]{16,})["']?/i` 提取 ID。

---

## 5. 任务查询 (Query Result)

### A. 命令行格式
```bash
dreamina.exe query_result --submit_id="[ID]"
```

### B. 核心状态解析逻辑
返回的结果 JSON 结构中：
1.  **状态判定**：`data.status` 或 `data.gen_status`。
    -   `pending`: 排队中。
    -   `running` / `processing`: 生成中。
    -   `success` / `completed`: 已成功。
    -   `failed`: 失败。
2.  **资源提取**：
    -   **视频链接**：`data.video_url` 或 `data.result_json.videos[0].url`。
    -   **图片链接**：`data.image_url` 或 `data.result_json.images[0].url`。

---

## 6. 工具函数参考 (Javascript/Node.js)

```javascript
/* 鲁棒性的 JSON 提取函数 */
function parseJsonSafe(str) {
    if (!str) return null;
    try {
        return JSON.parse(str);
    } catch (e) {
        // 应对 CLI 打印的调试文字，正则截取最后一个 JSON 块
        const matches = str.match(/\{[\s\S]*\}/g);
        if (matches) return JSON.parse(matches[matches.length - 1]);
    }
    return null;
}

/* 核心调用封装示例 */
async function submitTask(exePath, args) {
    const { spawn } = require('child_process');
    return new Promise((resolve) => {
        const child = spawn(exePath, args);
        let stdout = '';
        child.stdout.on('data', (d) => stdout += d.toString());
        child.on('close', () => {
            const result = parseJsonSafe(stdout);
            resolve(result ? result.submit_id : null);
        });
    });
}
```
