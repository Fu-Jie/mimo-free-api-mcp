import os
import sys
from dotenv import load_dotenv
try:
    from openai import OpenAI
except ImportError:
    print("Error: openai package not found. Run: pip install openai")
    sys.exit(1)

# Load credentials
load_dotenv()
API_KEY = os.getenv("MIMO_COOKIE", "sk-anything")
BASE64_PATH = "/tmp/real_base64.txt"

client = OpenAI(api_key=API_KEY, base_url="http://127.0.0.1:8012/v1")


def test_vision():
    if not os.path.exists(BASE64_PATH):
        print(f"Error: Base64 file not found at {BASE64_PATH}")
        print("Run: base64 -i <image_path> | tr -d '\\n' > /tmp/real_base64.txt")
        sys.exit(1)

    with open(BASE64_PATH, "r") as f:
        img_b64 = f.read().strip()

    print("-> [Vision Check] Sending streaming image recognition request...")
    print(f"   Image B64 size: {len(img_b64)} chars")
    try:
        stream = client.chat.completions.create(
            model="mimo-v2-omni",
            messages=[{
                "role": "user",
                "content": [
                    {"type": "text", "text": "图中是一个什么样的 UI 界面？请详细描述文字和功能。"},
                    {"type": "image_url", "image_url": {"url": f"data:image/png;base64,{img_b64}"}}
                ]
            }],
            stream=True,
            timeout=90
        )
        print("\n<- Model Response:\n" + "=" * 40)
        for chunk in stream:
            if chunk.choices and chunk.choices[0].delta.content:
                print(chunk.choices[0].delta.content, end="", flush=True)
        print("\n" + "=" * 40)
    except Exception as e:
        print(f"\nError: {type(e).__name__}: {e}")


if __name__ == "__main__":
    test_vision()
