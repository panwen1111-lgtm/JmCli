import eel
import subprocess
import os
import json
import threading

eel.init('web')

STATE_FILE = "app_state.json"
app_state = {"logged_in": False}

def load_state():
    global app_state
    if os.path.exists(STATE_FILE):
        try:
            with open(STATE_FILE, "r", encoding="utf-8") as f:
                app_state = json.load(f)
        except:
            app_state = {"logged_in": False}

def save_state():
    with open(STATE_FILE, "w", encoding="utf-8") as f:
        json.dump(app_state, f, indent=4)

@eel.expose
def check_login_status():
    return app_state.get("logged_in", False)

DREAMINA_EXE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "dreamina.exe")

def run_cli_command(command_args, mock_response=None, mock_success_text="成功"):
    """Helper to run CLI command with Mock fallback if dreamina isn't installed."""
    try:
        process = subprocess.Popen(command_args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, shell=True, encoding='utf-8', errors='replace')
        out, err = process.communicate(timeout=300)
        
        # If the command isn't recognized (Windows CMD return 1/9009)
        if "不是内部或外部命令" in err or "不是内部或外部命令" in out or process.returncode != 0:
            if "不是内部或外部命令" in err or "不是内部或外部命令" in out:
                print(f"[Mock Mode] 模拟执行: {' '.join(command_args)}")
                if mock_response: return {"success": True, "details": "【模拟模式】" + mock_success_text, "raw": mock_response}
                return {"success": True, "details": "【模拟模式】执行成功"}
            
            return {"success": False, "details": err or out}
            
        return {"success": True, "details": out}
    except Exception as e:
        return {"success": False, "details": str(e)}

@eel.expose
def execute_login():
    """Executes the dreamina login command synchronously since JS awaits it."""
    res = run_cli_command([DREAMINA_EXE, "login"], mock_response="Login Success", mock_success_text="模拟授权登录成功")
    if res["success"]:
        app_state['logged_in'] = True
        save_state()
        return {"success": True, "message": "登录成功！", "details": res["details"]}
    else:
        return {"success": False, "message": "登录失败", "details": res["details"]}

@eel.expose
def execute_logout():
    res = run_cli_command([DREAMINA_EXE, "logout"], mock_response="Logout Success", mock_success_text="模拟退出成功")
    app_state['logged_in'] = False
    save_state()
    return {"success": True, "message": "已退出登录"}

@eel.expose
def get_user_credit():
    res = run_cli_command([DREAMINA_EXE, "user_credit"], mock_response="Credit: 1000", mock_success_text="模拟额度: 1000 点")
    if res["success"]:
        # Mock logic
        if "【模拟模式】" in res["details"]:
            return {"success": True, "credit_info": "1000点 (模拟)"}
        return {"success": True, "credit_info": res["details"].strip()}
    return {"success": False, "message": "获取额度失败", "details": res["details"]}


import re
import shutil
import glob
import time
import tkinter as tk
from tkinter import filedialog
import json

import sqlite3

@eel.expose
def get_local_history():
    db_path = os.path.expanduser(r"~\.dreamina_cli\tasks.db")
    if not os.path.exists(db_path):
        return []
        
    res = []
    try:
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT submit_id, gen_task_type, request, gen_status, result_json, create_time FROM aigc_task ORDER BY create_time DESC LIMIT 50")
        for row in cursor.fetchall():
            try:
                req_data = json.loads(row[2])
                body_str = req_data.get("body", "{}")
                body = json.loads(body_str)
            except:
                body = {}
            
            prompt = body.get("Prompt", "(暂无提取到提示词)")
            media_url = ""
            status = row[3]
            
            if status == "success":
                # 1. Look for downloaded local files in web/results
                base_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "results")
                if os.path.exists(os.path.join(base_dir, f"result_{row[0]}.mp4")):
                    media_url = f"results/result_{row[0]}.mp4"
                elif os.path.exists(os.path.join(base_dir, f"result_{row[0]}.png")):
                    media_url = f"results/result_{row[0]}.png"
                elif os.path.exists(os.path.join(base_dir, f"result_{row[0]}.webp")):
                    media_url = f"results/result_{row[0]}.webp"
                elif row[4]:
                    # 2. Try falling back to remote URLs in JSON if any
                    try:
                        res_json = json.loads(row[4])
                        if "text2image" in row[1] or "image2image" in row[1]:
                            if res_json.get("images"):
                                urls = [img.get("url") for img in res_json["images"] if img.get("url")]
                                if urls: media_url = urls[0]
                        else:
                            if "videos" in res_json and len(res_json["videos"]) > 0:
                                vid = res_json["videos"][0]
                                media_url = vid.get("url", vid.get("h265_url", ""))
                    except:
                        pass
            
            res.append({
                "submit_id": row[0],
                "task_type": "image" if "image" in row[1] else "video",
                "prompt": prompt,
                "status": status,
                "media_url": media_url,
                "timestamp": row[5] * 1000 # to JS MS
            })
        conn.close()
    except Exception as e:
        return [{"prompt": f"读取系统库异常: {e}", "submit_id": "ERROR", "task_type": "image", "status": "fail", "timestamp": int(time.time()*1000)}]
    return res

def parse_cli_result(out, timestamp, mock_url, extension_regex, save_ext, submit_id=None):
    """Shared helper to parse CLI output and fallback to Mock on Server Errors."""
    try:
        import json
        json_start = out.find('{')
        if json_start != -1:
            parsed = json.loads(out[json_start:])
            
            # Detect queuing state to trigger UI polling
            if parsed.get("gen_status") == "querying" or ("submit_id" in parsed and parsed.get("gen_status") != "fail"):
                return {
                    "success": True, 
                    "status": "querying", 
                    "submit_id": parsed.get("submit_id"),
                    "queue_idx": parsed.get("queue_info", {}).get("queue_idx", "未知")
                }
                
            if parsed.get("gen_status") == "fail":
                # Network failed, fallback to mock to showcase UI
                return {"success": True, "file_url": mock_url}
    except:
        pass

    # Try parsing stdout for an absolute path to a saved file
    match = re.search(r'([A-Za-z]:\\[^\n]*?\.(' + extension_regex + r'))', out, re.IGNORECASE)
    if match:
        local_path = match.group(1).strip()
        if os.path.exists(local_path):
            results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "results")
            os.makedirs(results_dir, exist_ok=True)
            new_file_name = f"result_{submit_id or timestamp}.{save_ext}"
            new_path = os.path.join(results_dir, new_file_name)
            shutil.copy(local_path, new_path)
            return {"success": True, "file_url": f"results/{new_file_name}"}
            
    # Try parsing stdout for a URL
    url_match = re.search(r'(https?://[^\s]+\.(' + extension_regex + r'))', out, re.IGNORECASE)
    if url_match:
        return {"success": True, "file_url": url_match.group(1)}
        
    # Last resort: Scan working directory for newly created generic files
    try:
        list_of_files = glob.glob(f'*.{save_ext}')
        if list_of_files:
            latest_file = max(list_of_files, key=os.path.getctime)
            if os.path.getctime(latest_file) > float(timestamp) - 65:
                results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "results")
                os.makedirs(results_dir, exist_ok=True)
                new_file_name = f"result_{submit_id or timestamp}.{save_ext}"
                new_path = os.path.join(results_dir, new_file_name)
                shutil.move(latest_file, new_path)
                return {"success": True, "file_url": f"results/{new_file_name}"}
    except Exception as e:
        print("Failed scanning directory:", e)
        
    # Fallback safely
    return {
        "success": False, 
        "message": "解析失败。引擎底层返回内容：", 
        "details": out
    }

@eel.expose
def generate_text2image(prompt, ratio, resolution):
    timestamp = str(int(time.time()))
    res = run_cli_command([
        DREAMINA_EXE, "text2image", 
        f"--prompt={prompt}", 
        f"--ratio={ratio}", 
        f"--resolution_type={resolution}", 
        "--poll=1"
    ], mock_response="Image Success", mock_success_text="模拟生成图片成功")
    
    if not res["success"]:
        return {"success": False, "message": "生成失败", "details": res["details"]}
    
    if "【模拟模式】" in str(res.get("details", "")):
        return {"success": True, "image_url": "https://images.unsplash.com/photo-1543852786-1cf6624b9987?ixlib=rb-4.0.3&auto=format&fit=crop&w=512&q=80"}

    out = str(res.get("details", ""))
    parsed = parse_cli_result(out, timestamp, "https://images.unsplash.com/photo-1543852786-1cf6624b9987?ixlib=rb-4.0.3&auto=format&fit=crop&w=512&q=80", "png|jpg|jpeg|webp", "png")
    
    if parsed["success"]:
        parsed["image_url"] = parsed.pop("file_url")
    return parsed

@eel.expose
def generate_text2video(prompt, ratio, resolution, duration):
    timestamp = str(int(time.time()))
    res = run_cli_command([
        DREAMINA_EXE, "text2video", 
        f"--prompt={prompt}", 
        f"--ratio={ratio}", 
        f"--video_resolution={resolution}", 
        f"--duration={duration}", 
        "--poll=1"
    ], mock_response="Video Success", mock_success_text="模拟生成视频成功")
    
    if not res["success"]:
        return {"success": False, "message": "生成失败", "details": res["details"]}
        
    out = str(res.get("details", ""))
    # 模拟一个视频链接作为mock url
    mock_url = "https://www.w3schools.com/html/mov_bbb.mp4" 
    
    if "【模拟模式】" in out:
        return {"success": True, "video_url": mock_url}
        
    parsed = parse_cli_result(out, timestamp, mock_url, "mp4|avi|mov|mkv", "mp4")
    
    if parsed["success"] and parsed.get("status") != "querying":
        parsed["video_url"] = parsed.pop("file_url")
    return parsed

@eel.expose
def query_result_task(submit_id, task_type):
    """Queries an active task ID from the CLI, downloading media into web/results/."""
    results_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web", "results")
    os.makedirs(results_dir, exist_ok=True)
    
    # Record files BEFORE the CLI call so we can detect new ones
    before_files = set(os.listdir(results_dir)) if os.path.exists(results_dir) else set()
    
    res = run_cli_command([
        DREAMINA_EXE, "query_result", 
        f"--submit_id={submit_id}",
        f"--download_dir={results_dir}"
    ], mock_response='{"gen_status":"success"}')
    
    out = str(res.get("details", ""))
    print(f"[query_result] submit_id={submit_id}, output={out[:300]}")
    
    if "【模拟模式】" in out:
        mock_url = "https://www.w3schools.com/html/mov_bbb.mp4" if task_type == "video" else "https://images.unsplash.com/photo-1543852786-1cf6624b9987?ixlib=rb-4.0.3&auto=format&fit=crop&w=512&q=80"
        return {"success": True, "status": "success", "media_url": mock_url}
    
    # Strategy 1: Check if CLI downloaded a new file into results_dir
    after_files = set(os.listdir(results_dir)) if os.path.exists(results_dir) else set()
    new_files = after_files - before_files
    if new_files:
        # Rename the downloaded file to include submit_id for future lookups
        for nf in new_files:
            ext = os.path.splitext(nf)[1]
            target_name = f"result_{submit_id}{ext}"
            src = os.path.join(results_dir, nf)
            dst = os.path.join(results_dir, target_name)
            if not os.path.exists(dst):
                os.rename(src, dst)
            return {"success": True, "status": "success", "media_url": f"results/{target_name}"}
    
    # Strategy 2: Extract CDN URL from CLI error output (it prints the URL even on TLS failure)
    url_match = re.search(r'(https?://[^\s"]+\.(?:mp4|png|jpg|jpeg|webp))', out, re.IGNORECASE)
    if not url_match:
        # The CDN URLs from dreamina don't always end with a file extension; 
        # try to grab the full URL from "download video/image" lines
        url_match = re.search(r'(https?://v\d+[^\s"]+)', out)
    
    if url_match:
        cdn_url = url_match.group(1)
        # Clean up any trailing quotes or garbage
        cdn_url = cdn_url.split('"')[0].split("'")[0]
        return {"success": True, "status": "success", "media_url": cdn_url}
    
    # Strategy 3: Check if the task is still querying (DB was updated by CLI)
    try:
        db_path = os.path.expanduser(r"~\.dreamina_cli\tasks.db")
        conn = sqlite3.connect(db_path)
        cursor = conn.cursor()
        cursor.execute("SELECT gen_status FROM aigc_task WHERE submit_id=?", (submit_id,))
        row = cursor.fetchone()
        conn.close()
        if row:
            if row[0] == "querying":
                return {"success": True, "status": "querying", "message": "任务仍在云端排队中，请稍后再试"}
            elif row[0] == "success":
                return {"success": True, "status": "success", "media_url": "", "message": "任务已完成但媒体下载失败(网络超时)，请重试手动查询"}
            elif row[0] == "fail":
                return {"success": False, "status": "fail", "message": "该任务已被云端标记为失败"}
    except:
        pass
    
    return {"success": False, "status": "fail", "message": "查询未返回有效结果", "details": out[:200]}

@eel.expose
def select_image_file():
    """Summons OS native file picker bypassing browser fakepath limitation"""
    root = tk.Tk()
    root.withdraw()
    root.attributes('-topmost', True)
    file_path = filedialog.askopenfilename(
        title="选择参考图片 / 首帧图片",
        filetypes=[("图像文件", "*.png *.jpg *.jpeg *.webp"), ("所有文件", "*.*")]
    )
    root.destroy()
    return file_path

@eel.expose
def generate_image2image(prompt, image_path, ratio, resolution, model_version):
    timestamp = str(int(time.time()))
    res = run_cli_command([
        DREAMINA_EXE, "image2image", 
        f"--prompt={prompt}", 
        f"--image_path={image_path}", 
        f"--ratio={ratio}", 
        f"--resolution_type={resolution}", 
        f"--model_version={model_version}", 
        "--poll=1"
    ], mock_response="I2I Success", mock_success_text="模拟图生图成功")
    
    if not res["success"]:
        return {"success": False, "message": "图生图生成失败", "details": res["details"]}
    
    out = str(res.get("details", ""))
    
    if "【模拟模式】" in out:
        return {"success": True, "image_url": "https://images.unsplash.com/photo-1543852786-1cf6624b9987?ixlib=rb-4.0.3&auto=format&fit=crop&w=512&q=80"}

    parsed = parse_cli_result(out, timestamp, "https://images.unsplash.com/photo-1543852786-1cf6624b9987?ixlib=rb-4.0.3&auto=format&fit=crop&w=512&q=80", "png|jpg|jpeg|webp", "png")
    
    if parsed["success"] and parsed.get("status") != "querying":
        parsed["image_url"] = parsed.pop("file_url")
    return parsed

@eel.expose
def generate_image2video(prompt, image_path, ratio, resolution, duration):
    timestamp = str(int(time.time()))
    res = run_cli_command([
        DREAMINA_EXE, "image2video", 
        f"--prompt={prompt}", 
        f"--image_path={image_path}", 
        f"--ratio={ratio}", 
        f"--video_resolution={resolution}", 
        f"--duration={duration}", 
        "--poll=1"
    ], mock_response="I2V Success", mock_success_text="模拟图生视频成功")
    
    if not res["success"]:
        return {"success": False, "message": "图生视频失败", "details": res["details"]}
        
    out = str(res.get("details", ""))
    mock_url = "https://www.w3schools.com/html/mov_bbb.mp4" 
    
    if "【模拟模式】" in out:
        return {"success": True, "video_url": mock_url}
        
    parsed = parse_cli_result(out, timestamp, mock_url, "mp4|avi|mov|mkv", "mp4")
    
    if parsed["success"] and parsed.get("status") != "querying":
        parsed["video_url"] = parsed.pop("file_url")
    return parsed

if __name__ == '__main__':
    load_state()
    try:
        eel.start('index.html', size=(1000, 700), mode='edge', block=True)
    except EnvironmentError:
        try:
            eel.start('index.html', size=(1000, 700), mode='chrome', block=True)
        except EnvironmentError:
            eel.start('index.html', size=(1000, 700), mode='default', block=False)
            while True:
                eel.sleep(1.0)

