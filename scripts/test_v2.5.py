import requests
import json
import time
import os
import uuid
from dotenv import load_dotenv

# 加载根目录的 .env
load_dotenv(os.path.join(os.path.dirname(__file__), "../.env"))
AUTH_TOKEN = os.getenv("token")
BASE_URL = "http://localhost:8001/v1"

HEADERS = {"Authorization": f"Bearer {AUTH_TOKEN}", "Content-Type": "application/json"}

def test_model(model_name, query="你好，请介绍一下你自己。"):
    print(f"\n[Test] Testing model: {model_name}")
    payload = {
        "model": model_name,
        "messages": [{"role": "user", "content": query}],
        "stream": True,
    }
    
    try:
        res = requests.post(
            f"{BASE_URL}/chat/completions", headers=HEADERS, json=payload, stream=True
        )
        
        if res.status_code != 200:
            print(f"❌ Error: {res.status_code} - {res.text}")
            return

        print("-> Stream response:")
        has_thinking = False
        full_content = ""
        
        for line in res.iter_lines():
            if line:
                decoded = line.decode("utf-8")
                if decoded.startswith("data: "):
                    data_str = decoded[6:]
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                        delta = chunk["choices"][0]["delta"]
                        
                        if "reasoning_content" in delta and delta["reasoning_content"]:
                            if not has_thinking:
                                print("\n[Thinking] ", end="", flush=True)
                                has_thinking = True
                            print(delta["reasoning_content"], end="", flush=True)
                            
                        if "content" in delta and delta["content"]:
                            if has_thinking:
                                print("\n[Content] ", end="", flush=True)
                                has_thinking = False
                            print(delta["content"], end="", flush=True)
                            full_content += delta["content"]
                    except Exception as e:
                        continue
        print("\n✅ Test completed.")
    except Exception as e:
        print(f"❌ Exception: {e}")

if __name__ == "__main__":
    if not AUTH_TOKEN:
        print("❌ Error: 'token' not found in .env")
    else:
        # 测试新模型
        test_model("mimo-v2.5", "请问你是哪个版本的模型？")
        test_model("mimo-v2.5-pro", "请深度思考并回答：什么是大模型的全模态能力？")
