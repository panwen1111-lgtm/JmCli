# 即梦 (Dreamina) CLI 集成技术手册

本文档总结了 `JmCli` 项目中集成即梦官方 CLI 工具的技术路线与细节，旨在为跨项目复现“全能参考视频生成”及“本地化任务管理”提供参考。

---

## 一、 核心架构

项目采用 **Python (Eel) + JavaScript (Vanilla/CSS) + dreamina.exe (CLI 核心)** 的混合架构。

-   **前端**：基于 `Eel` 框架，使用原生 HTML5/CSS3 开发。引入了 `Frontend Design Skills` 优化，强调玻璃拟态 (Glassmorphism) 与高清动态质感。
-   **后端**：Python 作为逻辑中转站，通过 `subprocess` 调用命令行程序，并解析输出结果。
-   **数据**：利用 CLI 自带的 SQLite 数据库 (`tasks.db`) 进行任务同步与展示。

---

## 二、 功能实现路线

### 1. 登录与身份认证
-   **逻辑**：调用 `dreamina login`。
-   **技术细节**：
    -   CLI 会在本地 `~/.dreamina_cli/credential.json` 存储登录凭证。
    -   后端通过 `run_cli_command` 执行登录命令。若 CLI 调起浏览器完成 OAuth2 流程，后端静默等待返回。
    -   **登录状态检测**：通过执行 `dreamina user_credit`。若命令返回 200/成功，则表示当前 Token 有效。

### 2. 文生视频 (Text to Video)
-   **命令格式**：`dreamina text2video --prompt="..." --model_version="seedance2.0" --ratio="16:9" --duration=8 --poll=1`
-   **重点参数**：
    -   `--poll=1`：将请求设为立即返回模式（仅提交不阻塞），使 UI 不会因长时间网络请求而卡死。
    -   通过正则或 JSON 解析返回的 `submit_id`。

### 3. 全能参考 (Multimodal2Video)
-   **定位**：即梦的 Flagship 视频生成模式。
-   **输入参数**：
    -   `--image`：主图参考（绝对路径）。
    -   `--video`：运镜参考（绝对路径/可选）。
    -   `--audio`：BGM 背景音乐（绝对路径/可选）。
-   **后端实现**：利用 Python `tkinter.filedialog` 获取操作系统原生的文件物理路径，并传递给 CLI。

### 4. 异步任务查询 (Query Async Results)
-   **场景**：任务提交成功后处于 `querying` 状态，需要后续轮询结果。
-   **逻辑链**：
    1.  调用 `dreamina query_result --submit_id=<ID> --download_dir=<LocalDir>`。
    2.  **结果解析策略**：
        -   **策略 A (本地文件驱动)**：遍历下载目录，对比调用前后的文件差异，识别新下载的 `.mp4` 或 `.webp` 文件。
        -   **策略 B (正则抓取内容)**：若下载失败（常见于网络代理问题），CLI 仍会打印 CDN URL。后端通过正则 `(https?://[^\s"]+\.(?:mp4|png|...))` 提取云端链接。
        -   **策略 C (数据库反馈)**：直接查询 `tasks.db` 中的 `gen_status` 字段。

---

## 三、 本地历史任务管理

项目直接复用 `dreamina.exe` 维护的本地 SQLite 数据库，实现“零管理”历史同步。

-   **数据库路径**：`./.dreamina_cli/tasks.db`
-   **关键表名**：`aigc_task`
-   **逻辑实现**：
    ```python
    import sqlite3
    # 按照创建时间倒序读取最近50条记录
    query = "SELECT submit_id, gen_task_type, request, gen_status, result_json, create_time FROM aigc_task ORDER BY create_time DESC LIMIT 50"
    ```
-   **解析技巧**：`request` 字段存储的是 JSON 字符串，其中包含了原始的 `Prompt`。后端需进行二次 `json.loads` 以提取用户友好的描述信息。

---

## 四、 核心改动：配置文件本地化 (Decentralization)

为了让程序“随存随走”，支持跨目录移植而不丢失配置，采用了 **Windows 目录联接 (Junction)** 技术。

### 技术操作：
1.  **物理移动**：将默认存储位置 `C:\Users\<User>\.dreamina_cli` 物理移动至项目根目录 `D:\...\JmCli\.dreamina_cli`。
2.  **建立符号链接**：在用户主主目录下创建一个名为 `.dreamina_cli` 的目录联接（软链）。
    -   **命令**：`mklink /J "C:\Users\pw\.dreamina_cli" "D:\Antigravity WorkSpace\JmCli\.dreamina_cli"`
3.  **优势**：
    -   **二进制兼容**：硬编码了路径的 `dreamina.exe` 会认为自己还在访问用户主目录，但实际读写的是项目内的本地文件。
    -   **代码解耦**：Python 后端代码中直接定义 `LOCAL_DATA_DIR` 指向 `./.dreamina_cli`，彻底摆脱了环境变量和系统路径的束缚。

---

## 五、 UI 优化规范 (基于 Frontend Design Skills)

-   **字体组合**：`Outfit` (正文) + `Space Grotesk` (展示/技术指标)。
-   **背景处理**：
    -   添加 `noise-overlay` (噪点层) 提供细腻质感。
    -   玻璃面板：`backdrop-filter: blur(40px) saturate(180%) contrast(110%);`
-   **动效**：
    -   使用 `Cubic-bezier(0.19, 1, 0.22, 1)` (Expo Out) 实现丝滑的弹性反馈。
    -   针对列表项使用 `translateX` 或 `scale` 的 Staggered 进场效果。

---

## 六、 环境准备清单

1.  **runtime**：Python 3.12+ (Eel, PyInstaller)。
2.  **CLI**：即梦官方 `dreamina.exe` (需放入项目根目录)。
3.  **权限**：运行 `mklink /J` 需要管理员权限（或在 Windows 开发人员模式下运行）。
