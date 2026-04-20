import os
import json
import requests
from dotenv import load_dotenv

# 加载凭证
dotenv_path = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(dotenv_path)
MIMO_COOKIE = os.getenv("MIMO_COOKIE")

API_BASE = "http://127.0.0.1:8001/v1"
HEADERS = {
    "Authorization": f"Bearer {MIMO_COOKIE}",
    "Content-Type": "application/json"
}

def test_search():
    url = f"{API_BASE}/chat/completions"
    payload = {
        "model": "mimo-v2-omni",
        "messages": [{"role": "user", "content": "搜索并告诉我：上海海昌海洋公园今天的门票价格是多少？请列出参考链接。"}],
        "stream": True # 开启流式以观察引用发射
    }
    
    print(f"📡 正在请求: {payload['messages'][0]['content']}")
    
    response = requests.post(url, headers=HEADERS, json=payload, stream=True)
    
    print("--- [Response Stream] ---")
    for line in response.iter_lines():
        if line:
            decoded = line.decode('utf-8').replace('data: ', '')
            if decoded.strip() == "[DONE]": break
            try:
                chunk = json.loads(decoded)
                content = chunk['choices'][0]['delta'].get('content', "")
                if content:
                    print(content, end="", flush=True)
            except:
                continue
    print("\n--------------------------")

if __name__ == "__main__":
    if not MIMO_COOKIE:
        print("❌ 错误: 未在 .env 中找到 MIMO_COOKIE")
    else:
        test_search()
