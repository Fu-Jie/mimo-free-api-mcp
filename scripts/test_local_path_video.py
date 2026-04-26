import requests
import json
import os
from dotenv import load_dotenv

# 加载根目录的 .env
load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))
AUTH_TOKEN = os.getenv("token")
BASE_URL = "http://localhost:8001/v1"

HEADERS = {"Authorization": f"Bearer {AUTH_TOKEN}", "Content-Type": "application/json"}

# 🌟 测试目标：直接传入宿主机的绝对路径
# 因为我们在 docker-compose 中挂载了该目录，所以容器内应该能访问到
VIDEO_PATH = "/Users/fujie/Downloads/AI_视频开场动画生成.mp4"

def test_local_path_vision():
    print(f"\n[Test] Testing Local Path Mode (Docker Mount)")
    print(f"[Test] Target Path: {VIDEO_PATH}")

    payload = {
        "model": "mimo-v2.5",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请分析这个本地路径对应的视频内容。"},
                    {
                        "type": "video_url",
                        "video_url": {
                            "url": VIDEO_PATH  # 🌟 直接传路径字符串
                        },
                    },
                ],
            }
        ],
        "stream": True,
    }

    try:
        print("\n[Test] Sending request...")
        response = requests.post(f"{BASE_URL}/chat/completions", headers=HEADERS, json=payload, stream=True)
        response.raise_for_status()
        
        print("\n[Response] AI Analysis:\n")
        for line in response.iter_lines():
            if line:
                line_str = line.decode("utf-8")
                if line_str.startswith("data: "):
                    data_str = line_str[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        data = json.loads(data_str)
                        content = data["choices"][0]["delta"].get("content", "")
                        print(content, end="", flush=True)
                    except:
                        pass
        print("\n\n[Test] Success!")
    except Exception as e:
        print(f"\n[Error] Request failed: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"Server Response: {e.response.text}")

if __name__ == "__main__":
    test_local_path_vision()
