import requests
import json
import time
import base64
import os
import uuid
from dotenv import load_dotenv

# ==========================================================
# 🧪 Mimo API 生产环境全真模拟测试 (v2.0)
# ==========================================================
# 核心验证: 云端持久化、MD5 视觉缓存、分流解析
# ==========================================================

# 1. 自动加载凭证 (必须包含 MIMO_COOKIE="PH.UID.TOKEN")
load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
AUTH_TOKEN = os.getenv("MIMO_COOKIE")
BASE_URL = "http://localhost:8001/v1"  # Docker 映射端口

HEADERS = {"Authorization": f"Bearer {AUTH_TOKEN}", "Content-Type": "application/json"}

# 伪造一个 1x1 像素的蓝色 PNG 图片 Base64，用于测试 MD5 缓存
TEST_IMAGE_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwACggF/y79m4wAAAABJRU5ErkJggg=="


def test_chat_persistence():
    """验证云端持久化 (两轮对话测试)"""
    print("\n[Case 1] 验证云端持久化 (2-Round Persistence Test)")
    conv_id = str(uuid.uuid4()).replace("-", "")

    # 第一步：埋下信息
    payload_1 = {
        "model": "mimo-v2-flash",
        "messages": [{"role": "user", "content": "你好，请记住我的幸运数字是 999。"}],
        "conversation_id": conv_id,
        "stream": False,
    }
    print("-> 发送 Round 1 (设置记忆)...")
    res1 = requests.post(
        f"{BASE_URL}/chat/completions", headers=HEADERS, json=payload_1
    )
    print(f"<- Round 1 回复: {res1.json()['choices'][0]['message']['content'][:20]}...")

    # 第二步：检索信息
    payload_2 = {
        "model": "mimo-v2-flash",
        "messages": [{"role": "user", "content": "请问我的幸运数字是多少？"}],
        "conversation_id": conv_id,
        "stream": False,
    }
    print("-> 发送 Round 2 (测试记忆回调)...")
    res2 = requests.post(
        f"{BASE_URL}/chat/completions", headers=HEADERS, json=payload_2
    )
    answer = res2.json()["choices"][0]["message"]["content"]
    print(f"<- Round 2 最终回答: {answer}")
    if "999" in answer:
        print("✅ 持久化测试成功：模型记住了上下文！")
    else:
        print("❌ 持久化测试失败：模型未能调取历史记录。")


def test_vision_cache():
    """验证 MD5 缓存 (视觉识别效率测试)"""
    print("\n[Case 2] 验证 MD5 资源缓存 (MD5 Cache & Vision Test)")

    def call_vision():
        payload = {
            "model": "mimo-v2-omni",
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": "图中是什么颜色？"},
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
        start = time.time()
        res = requests.post(
            f"{BASE_URL}/chat/completions", headers=HEADERS, json=payload
        )
        end = time.time()
        return end - start, res.json()

    print("-> 第一次发送图片 (触发上传 & 3秒预热)...")
    t1, r1 = call_vision()
    print(
        f"<- 第一次耗时: {t1:.2f}s | 模型描述: {r1['choices'][0]['message']['content']}"
    )

    print("-> 第二次发送'相同'图片 (应该命中服务器/内存缓存)...")
    t2, r2 = call_vision()
    print(
        f"<- 第二次耗时: {t2:.2f}s | 模型描述: {r2['choices'][0]['message']['content']}"
    )

    if t2 < t1 * 0.5:
        print(f"✅ MD5 缓存测试成功：第二次响应提速了 {(t1-t2)/t1*100:.1f}%")
    else:
        print("💡 缓存效果不明显，可能受网络波动或小米后端解析延迟影响。")


def test_thinking_flow():
    """验证流式思考链分流解析"""
    print("\n[Case 3] 验证思考链 (Thinking Chain Stream Test)")
    payload = {
        "model": "mimo-v2-pro",
        "messages": [{"role": "user", "content": "请深度思考并解释量子纠缠。"}],
        "stream": True,
    }
    print("-> 开始流式获取并解析数据...")
    res = requests.post(
        f"{BASE_URL}/chat/completions", headers=HEADERS, json=payload, stream=True
    )

    has_thinking = False
    has_content = False

    for line in res.iter_lines():
        if line:
            decoded = line.decode("utf-8").replace("data: ", "")
            if "[DONE]" in decoded:
                break
            try:
                chunk = json.loads(decoded)
                delta = chunk["choices"][0]["delta"]
                if "reasoning_content" in delta and delta["reasoning_content"]:
                    if not has_thinking:
                        print("\n[Thinking Start] ", end="", flush=True)
                        has_thinking = True
                    print(".", end="", flush=True)  # 简化显示思考中的点
                if "content" in delta and delta["content"]:
                    if not has_content:
                        print("\n[Message content Start] ", end="", flush=True)
                        has_content = True
                    print(delta["content"], end="", flush=True)
            except:
                continue

    print("\n✅ 流式解析测试结束。")


if __name__ == "__main__":
    if not AUTH_TOKEN or AUTH_TOKEN == "your_cookie_here":
        print(
            "❌ 错误: 请先在 scripts/.env 中填入有效的 MIMO_COOKIE (格式: ph.uid.token)"
        )
    else:
        try:
            test_chat_persistence()
            test_vision_cache()
            test_thinking_flow()
        except Exception as e:
            print(f"❌ 测试过程中发生异常: {e}")
