document.addEventListener('DOMContentLoaded', async () => {
    
    // UI Elements
    const loginView = document.getElementById('login-view');
    const dashboardView = document.getElementById('dashboard-view');
    const loginBtn = document.getElementById('login-btn');
    const logoutBtn = document.getElementById('logout-btn');
    const errorMessage = document.getElementById('login-error');
    const creditValue = document.getElementById('credit-value');

    // Initialize View
    const isLoggedIn = await eel.check_login_status()();
    if (isLoggedIn) {
        showDashboard();
    } else {
        showLogin();
    }

    // Handlers
    loginBtn.addEventListener('click', async () => {
        setLoading(loginBtn, true);
        hideError();

        // Calling Python exposed function for login
        const result = await eel.execute_login()();
        
        setLoading(loginBtn, false);

        if (result.success) {
            showDashboard();
        } else {
            showError(result.message + (result.details ? ': ' + result.details : ''));
        }
    });

    logoutBtn.addEventListener('click', async () => {
        const result = await eel.execute_logout()();
        if (result.success) {
            showLogin();
        } else {
            alert('Logout failed: ' + result.message);
        }
    });

    // Helpers
    function showLogin() {
        dashboardView.classList.add('hidden');
        loginView.classList.remove('hidden');
        resetUI();
    }

    async function showDashboard() {
        loginView.classList.add('hidden');
        dashboardView.classList.remove('hidden');
        
        // Fetch User Credit upon entering dashboard
        creditValue.innerText = "正在查询余额...";
        const creditData = await eel.get_user_credit()();
        if (creditData.success) {
            creditValue.innerText = creditData.credit_info || "已获取记录";
        } else {
            creditValue.innerText = "获取失败";
            console.error(creditData.details);
        }
    }

    function setLoading(btnElement, isLoading) {
        if (isLoading) {
            btnElement.classList.add('loading');
            btnElement.disabled = true;
        } else {
            btnElement.classList.remove('loading');
            btnElement.disabled = false;
        }
    }

    function showError(msg) {
        errorMessage.innerText = msg;
        errorMessage.classList.remove('hidden');
    }

    function hideError() {
        errorMessage.classList.add('hidden');
    }
    
    function resetUI() {
        hideError();
        setLoading(loginBtn, false);
    }
    
    // ============================================
    // Sidebar Navigation Logic
    // ============================================
    const navItems = document.querySelectorAll('.nav-item:not(.disabled)');
    const toolViews = document.querySelectorAll('.tool-view');
    const previewPlaceholder = document.getElementById('preview-placeholder');
    const previewImage = document.getElementById('preview-image');
    const previewVideo = document.getElementById('preview-video');
    const scannerLine = document.querySelector('.scanner-line');
    const placeholderText = document.querySelector('.placeholder-text');

    navItems.forEach(item => {
        item.addEventListener('click', () => {
            // Update active state in nav
            navItems.forEach(n => n.classList.remove('active'));
            item.classList.add('active');

            // Find target view and display it
            const targetId = item.dataset.target;
            toolViews.forEach(view => {
                if (view.id === targetId) {
                    view.classList.remove('hidden');
                    view.classList.add('active');
                } else {
                    view.classList.remove('active');
                    view.classList.add('hidden');
                }
            });
            
            // Reset preview
            if (targetId !== 'view-history') {
                previewImage.classList.add('hidden');
                previewVideo.classList.add('hidden');
                previewPlaceholder.classList.remove('hidden');
                previewVideo.pause();
                previewVideo.removeAttribute('src');
                previewImage.removeAttribute('src');
                placeholderText.innerText = "期待你的" + (targetId.includes('2i') ? "灵感图片" : "震撼视频") + "...";
                
                // Keep history's preview layout hidden when browsing tasks, UNLESS user specifically previews a card.
                document.querySelector('.preview-panel').style.display = 'flex';
            } else {
                refreshHistoryUI();
                document.querySelector('.preview-panel').style.display = 'none'; // History uses full width until a card is clicked for preview
            }
        });
    });

    // ============================================
    // Selection Capsule UI Logic (Shared)
    // ============================================
    document.querySelectorAll('.radio-capsules').forEach(group => {
        group.addEventListener('click', (e) => {
            if(e.target.classList.contains('capsule')) {
                group.querySelectorAll('.capsule').forEach(c => c.classList.remove('active'));
                e.target.classList.add('active');
            }
        });
    });

    const getActiveVal = (groupId) => {
        const el = document.querySelector(`#${groupId} .capsule.active`);
        return el ? el.dataset.val : null;
    };

    // ============================================
    // Generic File Picker Logic
    // ============================================
    let cachedI2iPath = "";
    let cachedI2vPath = "";

    const bindPicker = (btnId, labelId, setter) => {
        const btn = document.getElementById(btnId);
        if(btn) {
            btn.addEventListener('click', async () => {
                const path = await eel.select_image_file()();
                if(path) {
                    document.getElementById(labelId).innerText = "..." + path.slice(-25);
                    document.getElementById(labelId).title = path;
                    setter(path);
                }
            });
        }
    };

    bindPicker('btn-pick-i2i', 'path-i2i', p => cachedI2iPath = p);
    bindPicker('btn-pick-i2v', 'path-i2v', p => cachedI2vPath = p);

    // ============================================
    // Text to Image (文生图) Logic
    // ============================================
    const btnGenerateT2I = document.getElementById('btn-generate-t2i');
    if(btnGenerateT2I) {
        const promptT2I = document.getElementById('t2i-prompt');

        btnGenerateT2I.addEventListener('click', async () => {
            const promptInfo = promptT2I.value.trim();
            if (!promptInfo) return alert("请输入画面灵感提示词！");

            const ratio = getActiveVal('t2i-ratio');
            const res = getActiveVal('t2i-resolution');

            btnGenerateT2I.disabled = true;
            btnGenerateT2I.innerHTML = '<span class="spinner" style="position:relative; display:inline-block; border-top-color: var(--secondary-color);"></span> <span style="margin-left: 10px;">梦境渲染中...</span>';
            
            previewVideo.classList.add('hidden');
            previewImage.classList.add('hidden');
            previewPlaceholder.classList.remove('hidden');
            previewPlaceholder.classList.add('loading');
            scannerLine.classList.remove('hidden');
            placeholderText.innerText = "正在向计算节点提交任务...";

            try {
                const result = await eel.generate_text2image(promptInfo, ratio, res)();
                await handlePollingResult(result, "image", btnGenerateT2I, "开始生成图片", promptInfo);
            } catch(e) {
                alert("异常: " + e);
                placeholderText.innerText = "连接异常";
                btnGenerateT2I.disabled = false;
                btnGenerateT2I.innerHTML = '<span class="btn-text">开始生成图片</span> <span class="btn-icon">⚡</span>';
            }
        });
    }

    // ============================================
    // Text to Video (文生视频) Logic
    // ============================================
    const btnGenerateT2V = document.getElementById('btn-generate-t2v');
    if(btnGenerateT2V) {
        const promptT2V = document.getElementById('t2v-prompt');

        btnGenerateT2V.addEventListener('click', async () => {
            const promptInfo = promptT2V.value.trim();
            if (!promptInfo) return alert("请输入剧情画面提示词！");

            const ratio = getActiveVal('t2v-ratio');
            const res = getActiveVal('t2v-resolution');
            const duration = getActiveVal('t2v-duration');

            btnGenerateT2V.disabled = true;
            btnGenerateT2V.innerHTML = '<span class="spinner" style="position:relative; display:inline-block; border-top-color: var(--secondary-color);"></span> <span style="margin-left: 10px;">序列帧渲染中...</span>';
            
            previewImage.classList.add('hidden');
            previewVideo.classList.add('hidden');
            previewPlaceholder.classList.remove('hidden');
            previewPlaceholder.classList.add('loading');
            scannerLine.classList.remove('hidden');
            placeholderText.innerText = "正在向视频集群提交任务...";

            try {
                const result = await eel.generate_text2video(promptInfo, ratio, res, duration)();
                await handlePollingResult(result, "video", btnGenerateT2V, "开始生成视频", promptInfo);
            } catch(e) {
                alert("异常: " + e);
                placeholderText.innerText = "连接异常";
                btnGenerateT2V.disabled = false;
                btnGenerateT2V.innerHTML = '<span class="btn-text">开始生成视频</span> <span class="btn-icon">⚡</span>';
            }
        });
    }

    // ============================================
    // Image to Image (图生图) Logic
    // ============================================
    const btnGenerateI2I = document.getElementById('btn-generate-i2i');
    if(btnGenerateI2I) {
        const promptI2I = document.getElementById('i2i-prompt');
        btnGenerateI2I.addEventListener('click', async () => {
            const promptInfo = promptI2I.value.trim();
            if (!cachedI2iPath) return alert("请先点击[选择参考首图]！");
            if (!promptInfo) return alert("请输入重绘提示词！");

            const ratio = getActiveVal('i2i-ratio');
            const res = getActiveVal('i2i-resolution');
            const model = getActiveVal('i2i-model');

            btnGenerateI2I.disabled = true;
            btnGenerateI2I.innerHTML = '<span class="spinner" style="position:relative; display:inline-block; border-top-color: var(--secondary-color);"></span> <span style="margin-left: 10px;">启动重绘中...</span>';
            
            previewVideo.classList.add('hidden');
            previewImage.classList.add('hidden');
            previewPlaceholder.classList.remove('hidden');
            previewPlaceholder.classList.add('loading');
            scannerLine.classList.remove('hidden');
            placeholderText.innerText = "向集群传输核心首图...";

            try {
                const result = await eel.generate_image2image(promptInfo, cachedI2iPath, ratio, res, model)();
                await handlePollingResult(result, "image", btnGenerateI2I, "开始重绘图像", promptInfo || "[以图生图任务]");
            } catch(e) {
                alert("异常: " + e);
                placeholderText.innerText = "连接异常";
                btnGenerateI2I.disabled = false;
                btnGenerateI2I.innerHTML = '<span class="btn-text">开始重绘图像</span> <span class="btn-icon">✨</span>';
            }
        });
    }

    // ============================================
    // Image to Video (图生视频) Logic
    // ============================================
    const btnGenerateI2V = document.getElementById('btn-generate-i2v');
    if(btnGenerateI2V) {
        const promptI2V = document.getElementById('i2v-prompt');
        btnGenerateI2V.addEventListener('click', async () => {
            const promptInfo = promptI2V.value.trim();
            if (!cachedI2vPath) return alert("请先点击[选择视频首帧图]！");
            // API works with empty prompts for I2V, but typically people provide them

            const ratio = getActiveVal('i2v-ratio');
            const res = getActiveVal('i2v-resolution');
            const duration = getActiveVal('i2v-duration');

            btnGenerateI2V.disabled = true;
            btnGenerateI2V.innerHTML = '<span class="spinner" style="position:relative; display:inline-block; border-top-color: var(--secondary-color);"></span> <span style="margin-left: 10px;">序列推演中...</span>';
            
            previewImage.classList.add('hidden');
            previewVideo.classList.add('hidden');
            previewPlaceholder.classList.remove('hidden');
            previewPlaceholder.classList.add('loading');
            scannerLine.classList.remove('hidden');
            placeholderText.innerText = "正在向视频集群推流首帧并请求推演...\n视频渲染可能需要 3~6 分钟...";

            try {
                const result = await eel.generate_image2video(promptInfo, cachedI2vPath, ratio, res, duration)();
                await handlePollingResult(result, "video", btnGenerateI2V, "开始序列帧推演", promptInfo || "[图生视频任务]");
            } catch(e) {
                alert("异常: " + e);
                placeholderText.innerText = "连接异常";
                btnGenerateI2V.disabled = false;
                btnGenerateI2V.innerHTML = '<span class="btn-text">开始序列帧推演</span> <span class="btn-icon">🪄</span>';
            }
        });
    }

    // ============================================
    // Shared UI Polling & History Tracker
    // ============================================
    async function handlePollingResult(initialResult, taskType, btnElement, btnText, promptStr) {
        let result = initialResult;
        const previewPlaceholder = document.getElementById('preview-placeholder');
        const placeholderText = document.querySelector('.placeholder-text');
        const scannerLine = document.querySelector('.scanner-line');

        // Fire and forget logic
        if (result.success && result.status === "querying") {
            // It was submitted successfully!
            placeholderText.innerText = "✅ 核心已向计算云提交，您可继续创作！\n结果请前往【历史记录】大盘查询。";
            
            // Wait 2 seconds so user sees the message, then restore UI
            setTimeout(() => {
                btnElement.disabled = false;
                btnElement.innerHTML = `<span class="btn-text">${btnText}</span> <span class="btn-icon">⚡</span>`;
                previewPlaceholder.classList.remove('loading');
                scannerLine.classList.add('hidden');
                placeholderText.innerText = "期待你的下一次梦境...";
            }, 2500);

            // Fetch history tab dynamically in background so it's fresh
            refreshHistoryUI();
        } else if(result.success && result.status !== "querying") {
            // Already finished (e.g. simulated mode or instantaneous generation)
            const randomBuster = '?t=' + new Date().getTime();
            const previewImage = document.getElementById('preview-image');
            const previewVideo = document.getElementById('preview-video');
            
            if (taskType === "image") {
                previewImage.src = result.image_url + randomBuster;
                previewImage.onload = () => {
                    previewPlaceholder.classList.add('hidden');
                    previewImage.classList.remove('hidden');
                };
            } else {
                previewVideo.src = result.video_url + randomBuster;
                previewVideo.onloadeddata = () => {
                    previewPlaceholder.classList.add('hidden');
                    previewVideo.classList.remove('hidden');
                    previewVideo.play();
                };
            }
            eel.get_user_credit()().then(d => { if(d.success) document.getElementById('credit-value').innerText = d.credit_info; });
            
            // Restore UI quickly
            btnElement.disabled = false;
            btnElement.innerHTML = `<span class="btn-text">${btnText}</span> <span class="btn-icon">⚡</span>`;
            previewPlaceholder.classList.remove('loading');
            scannerLine.classList.add('hidden');
            placeholderText.innerText = "期待你的下一次梦境...";
            refreshHistoryUI();

        } else {
            // Hard failure
            alert("生成崩溃：\n" + (result.message || "") + "\n\n" + (result.details || ''));
            
            btnElement.disabled = false;
            btnElement.innerHTML = `<span class="btn-text">${btnText}</span> <span class="btn-icon">⚡</span>`;
            previewPlaceholder.classList.remove('loading');
            scannerLine.classList.add('hidden');
            placeholderText.innerText = "灵感溃散，请重试";
        }
    }

    // ============================================
    // History Renderer
    // ============================================
    document.getElementById('btn-refresh-history').addEventListener('click', refreshHistoryUI);

    async function refreshHistoryUI() {
        const container = document.getElementById('history-container');
        container.innerHTML = '<div style="color:var(--text-secondary);">加载本地落卷数据中...</div>';
        try {
            const data = await eel.get_local_history()();
            container.innerHTML = '';
            
            if(!data || data.length === 0) {
                container.innerHTML = '<div style="color:var(--text-secondary); width: 100%; text-align:center; padding: 50px;">当前尚无历史渲染任务。去尝试创造第一幅画作吧！</div>';
                return;
            }

            data.forEach(item => {
                const card = document.createElement('div');
                card.className = `history-card status-${item.status}`;
                
                const d = new Date(item.timestamp);
                const timeStr = `${d.getMonth()+1}-${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;

                const badgeMap = {
                    'image': '✨ 图生/文生图片',
                    'video': '🎬 序列帧视频'
                };

                let actionBtnHTML = '';
                if(item.status === 'querying' && !item.submit_id.startsWith('MOCK')) {
                    actionBtnHTML = `<button id="btn-query-${item.submit_id}" class="btn btn-secondary" style="padding: 4px 12px; font-size:12px;" onclick="resumeQuery('${item.submit_id}', '${item.task_type}')">⚡ 手动查询</button>`;
                } else if(item.status === 'success' && item.media_url) {
                    // Escape the URL for safe embedding in onclick
                    const safeUrl = item.media_url.replace(/'/g, "\\'");
                    actionBtnHTML = `<button class="btn btn-secondary" style="padding: 4px 12px; font-size:12px;" onclick="previewHistoryMedia('${safeUrl}', '${item.task_type}')">👁️ 预览回放</button>`;
                } else if(item.status === 'success' && !item.media_url) {
                    // Success but no media downloaded yet - offer re-query
                    actionBtnHTML = `<button id="btn-query-${item.submit_id}" class="btn btn-secondary" style="padding: 4px 12px; font-size:12px;" onclick="resumeQuery('${item.submit_id}', '${item.task_type}')">🔄 重新下载</button>`;
                } else {
                    actionBtnHTML = `<span class="hc-time">生成中断/失败</span>`;
                }

                card.innerHTML = `
                    <div class="hc-header">
                        <span class="hc-badge">${badgeMap[item.task_type] || '记录'}</span>
                        <span style="font-family:monospace; opacity:0.6;">${item.submit_id.slice(0, 10)}...</span>
                    </div>
                    <div class="hc-prompt">${item.prompt}</div>
                    <div class="hc-actions">
                        <span class="hc-time">${timeStr}</span>
                        <div>${actionBtnHTML}</div>
                    </div>
                `;
                container.appendChild(card);
            });
        } catch(e) {
            container.innerHTML = '<div style="color:red;">历史记录读取失败:' + e + '</div>';
        }
    }
    
    // Global functions for inline onclick in created elements
    window.previewHistoryMedia = (url, type) => {
        document.querySelector('.preview-panel').style.display = 'flex';
        const previewPlaceholder = document.getElementById('preview-placeholder');
        const previewImage = document.getElementById('preview-image');
        const previewVideo = document.getElementById('preview-video');
        
        previewPlaceholder.classList.add('hidden');
        previewImage.classList.add('hidden');
        previewVideo.classList.add('hidden');
        previewVideo.pause();

        if (type === 'image') {
            previewImage.src = url;
            previewImage.classList.remove('hidden');
        } else {
            previewVideo.src = url;
            previewVideo.classList.remove('hidden');
            previewVideo.play();
        }
    };

    window.resumeQuery = async (submit_id, taskType) => {
        // Use single-card UI loading instead of modal loading
        const btn = document.getElementById(`btn-query-${submit_id}`);
        if(btn) {
            btn.innerHTML = `<span class="spinner" style="display:inline-block; width:10px; height:10px; border:2px solid #fff; border-top-color:transparent; border-radius:50%; margin-right:5px; vertical-align:middle; animation: spin 1s linear infinite;"></span> 查询中...`;
            btn.disabled = true;
        }

        try {
            const result = await eel.query_result_task(submit_id, taskType)();
            console.log('[resumeQuery] result:', result);
            
            if (result.success && result.status === 'success' && result.media_url) {
                // Great! We have media. Show it immediately in the preview panel.
                document.querySelector('.preview-panel').style.display = 'flex';
                previewHistoryMedia(result.media_url, taskType);
            } else if (result.success && result.status === 'querying') {
                alert('该任务仍在云端排队中，请稍后再试。');
            } else if (result.message) {
                alert(result.message);
            }
            
            // Always refresh history to reflect DB changes
            refreshHistoryUI();
        } catch(e) {
            alert('查询发生异常！');
            if(btn) {
                btn.innerHTML = `⚡ 手动查询`;
                btn.disabled = false;
            }
        }
    };
});
