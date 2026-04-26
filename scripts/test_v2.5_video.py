import requests
import json
import os
import base64
from dotenv import load_dotenv

# 加载根目录的 .env
load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))
AUTH_TOKEN = os.getenv("token")
BASE_URL = "http://localhost:8001/v1"

HEADERS = {"Authorization": f"Bearer {AUTH_TOKEN}", "Content-Type": "application/json"}

VIDEO_PATH = "/Users/fujie/Downloads/AI_视频开场动画生成.mp4"

def test_video_vision():
    if not os.path.exists(VIDEO_PATH):
        print(f"Error: Video file not found at {VIDEO_PATH}")
        return

    print(f"\n[Test] Reading video file: {VIDEO_PATH}")
    with open(VIDEO_PATH, "rb") as f:
        video_data = f.read()
    
    video_b64 = base64.b64encode(video_data).decode("utf-8")
    print(f"[Test] Video encoded to Base64 (Size: {len(video_b64)} chars)")

    print("\n[Test] Sending request to MiMo-V2.5 with video...")
    payload = {
        "model": "mimo-v2.5",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请分析这个视频的内容，并总结视频中出现了哪些关键场景或文字。"},
                    {
                        "type": "video_url",
                        "video_url": {
                            "url": f"data:video/mp4;base64,{video_b64}"
                        },
                    },
                ],
            }
        ],
        "stream": True,
    }

    try:
        response = requests.post(f"{BASE_URL}/chat/completions", headers=HEADERS, json=payload, stream=True)
        response.raise_for_status()
        
        print("\n[Response] AI Analysis:\n")
        full_content = ""
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
                        full_content += content
                    except:
                        pass
        print("\n\n[Test] Success!")
    except Exception as e:
        print(f"\n[Error] Request failed: {e}")

if __name__ == "__main__":
    test_video_vision()
