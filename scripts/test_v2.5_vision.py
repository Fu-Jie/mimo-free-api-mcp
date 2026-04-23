import requests
import json
import os
from dotenv import load_dotenv

# 加载根目录的 .env
load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))
AUTH_TOKEN = os.getenv("token")
BASE_URL = "http://localhost:8001/v1"

HEADERS = {"Authorization": f"Bearer {AUTH_TOKEN}", "Content-Type": "application/json"}

# 1x1 蓝色像素
TEST_IMAGE_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwACggF/y79m4wAAAABJRU5ErkJggg=="

def test_vision():
    print("\n[Test] Testing Vision with MiMo-V2.5")
    payload = {
        "model": "mimo-v2.5",
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "请问这张图片里是什么颜色？"},
                    {
                        "type": "image_url",
                        "image_url": {
                            "url": f"data:image/png;base64,{TEST_IMAGE_B64}"
                        },
                    },
                ],
            }
        ],
        "stream": False,
    }
    
    try:
        res = requests.post(
            f"{BASE_URL}/chat/completions", headers=HEADERS, json=payload
        )
        
        if res.status_code != 200:
            print(f"❌ Error: {res.status_code} - {res.text}")
            return

        result = res.json()
        print(f"<- Response: {result['choices'][0]['message']['content']}")
        print("✅ Vision test completed.")
    except Exception as e:
        print(f"❌ Exception: {e}")

if __name__ == "__main__":
    if not AUTH_TOKEN:
        print("❌ Error: 'token' not found in .env")
    else:
        test_vision()
