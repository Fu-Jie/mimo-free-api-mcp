import os
import json
import base64
import requests
from dotenv import load_dotenv

# ==========================================================
# 🚀 Mimo API 适配器 全接口 Python Demo (高度对齐官网协议)
# ==========================================================
# 本脚本涵盖：
# 1. 基础对话 (Base Chat)
# 2. 推理型思维链 (Thinking Mode - Flash/Pro/Omni)
# 3. 视觉识别 (图像/视频 - Multi-modal)
# 4. 自动联网识别测试 (Web Search Auto-Trigger)
# 5. 工具调用测试 (Tool Calling)
# ==========================================================

# 🌟 1. 自动定位同级目录下的 .env 并加载凭证 (MIMO_COOKIE, MIMO_PH)
dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path)

MIMO_COOKIE = os.getenv("MIMO_COOKIE", "your_cookie_here")
API_BASE = "http://127.0.0.1:8001/v1"

# 鉴权头部：模拟用户向适配器发包
HEADERS = {
    "Authorization": f"Bearer {MIMO_COOKIE}",
    "Content-Type": "application/json"
}

def call_mimo(model, prompt, image_path=None, video_path=None, audio_path=None, tools=None, stream=True):
    """万能 Mimo 接口包装器"""
    url = f"{API_BASE}/chat/completions"
    
    # 构建消息内容：支持图、影、音
    content = [{"type": "text", "text": prompt}]
    
    # 自动处理媒体 Base64 转换
    def get_b64(path):
        if not os.path.exists(path):
            print(f"⚠️ [Skip] 资源不存在: {path}")
            return None
        with open(path, "rb") as f:
            return base64.b64encode(f.read()).decode("utf-8")

    if image_path:
        b64 = get_b64(image_path)
        if b64: content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
    
    if video_path:
        b64 = get_b64(video_path)
        if b64: content.append({"type": "video_url", "video_url": {"url": f"data:video/mp4;base64,{b64}"}})

    # 小提示：Mimo 视觉模型目前音频可能也通过内容通道接收
    if audio_path:
        b64 = get_b64(audio_path)
        if b64: content.append({"type": "image_url", "image_url": {"url": f"data:audio/wav;base64,{b64}"}})

    payload = {
        "model": model,
        "messages": [{"role": "user", "content": content}],
        "stream": stream,
        "temperature": 0.3 if "flash" in model else 1.0, # 对齐官网逻辑
        "top_p": 0.95
    }
    
    # 注入工具
    if tools:
        payload["tools"] = tools

    print(f"\n🚀 [演示] 场景: {prompt[:40]}... (模型: {model})")
    
    try:
        response = requests.post(url, headers=HEADERS, json=payload, stream=stream)
        
        if stream:
            print("--- [Response Stream] ---")
            for line in response.iter_lines():
                if line:
                    decoded = line.decode('utf-8').replace('data: ', '')
                    if decoded.strip() == "[DONE]": break
                    try:
                        chunk = json.loads(decoded)
                        delta = chunk['choices'][0]['delta']
                        # 识别推理内容 (Thinking) - 渲染为灰色
                        if 'reasoning_content' in delta:
                            print(f"\033[90m{delta['reasoning_content']}\033[0m", end="", flush=True)
                        # 识别正文内容
                        if 'content' in delta:
                            print(delta['content'], end="", flush=True)
                    except: continue
            print("\n--------------------------")
        else:
            print(f"--- [Regular Response] ---")
            print(json.dumps(response.json(), indent=2, ensure_ascii=False))
            print("--------------------------")
            
    except Exception as e:
        print(f"❌ 请求失败: {e}")

if __name__ == "__main__":
    print(f"📡 使用配置: {dotenv_path}")
    print(f"🔑 Cookie 长度: {len(MIMO_COOKIE)} 字节")
    
    # 1. 【推理能力展示】 - 使用 Flash 后缀版本强制开启 Thinking
    call_mimo("mimo-v2-flash-thinking", "请逻辑严密地推导：在什么特定的数学语境下 2 + 2 = 5 是成立的？", stream=True)

    # 2. 【视觉能力展示】 - 视频内容识别
    assets_dir = os.path.join(os.path.dirname(__file__), "assets")
    demo_video = os.path.join(assets_dir, "demo.mp4")
    call_mimo("mimo-v2-omni", "仔细观察这段视频并描述其中的画面内容", video_path=demo_video, stream=True)

    # 3. 【自动联网展示】 - 官网 1:1 逻辑 (不手动控制 webSearchStatus，看模型自驱动)
    call_mimo("mimo-v2-omni", "今天小米官网有什么最新的产品发布信息吗？请搜索并告诉我。")

    # 4. 【工具调用展示】 - 查看模型生成结构化 JSON 工具包的能力
    weather_tool = [
        {
            "type": "function",
            "function": {
                "name": "get_weather",
                "description": "获取实时天气信息",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {"type": "string", "description": "城市名，如 上海"}
                    },
                    "required": ["city"]
                }
            }
        }
    ]
    call_mimo("mimo-v2-omni", "上海今天天气怎么样？", tools=weather_tool, stream=False)

    print("\n✅ 所有场景均已演示完毕！")
