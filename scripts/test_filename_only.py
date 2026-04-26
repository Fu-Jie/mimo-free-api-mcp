import requests
import json
import os

# API configuration
API_URL = "http://localhost:8001/v1/chat/completions"
# Using only the filename, no path
TARGET_FILENAME = "AI_视频开场动画生成.mp4"

def test_filename_only():
    print(f"[Test] Testing Filename-Only Mode (Fixed Storage)")
    print(f"[Test] Filename: {TARGET_FILENAME}")
    
    payload = {
        "model": "mimo-v2.5",
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": "请分析这个视频的内容。"
                    },
                    {
                        "type": "video_url",
                        "video_url": {
                            "url": TARGET_FILENAME
                        }
                    }
                ]
            }
        ],
        "stream": False
    }

    print("\n[Test] Sending request...")
    try:
        response = requests.post(API_URL, json=payload, timeout=60)
        response.raise_for_status()
        
        result = response.json()
        print("\n[Test] Response received:")
        print(result['choices'][0]['message']['content'])
        
    except Exception as e:
        print(f"\n[Test] Error: {e}")
        if hasattr(e, 'response') and e.response is not None:
            print(f"[Test] Error Details: {e.response.text}")

if __name__ == "__main__":
    test_filename_only()
