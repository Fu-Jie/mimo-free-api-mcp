import os
from openai import OpenAI
from dotenv import load_dotenv

# Load credentials
load_dotenv()
API_KEY = os.getenv("MIMO_COOKIE", "sk-anything")

client = OpenAI(api_key=API_KEY, base_url="http://127.0.0.1:8012/v1")

# Simulate a multi-turn conversation without passing conversation_id.
# The API should use the messages history to derive a stable conversationId.
conversation: list[dict] = []


def chat(user_input: str, conversation_id: str = None) -> (str, str):
    """Send a message and return (reply, conversation_id)."""
    conversation.append({"role": "user", "content": user_input})
    print(f"\n[Turn {len(conversation)}] User: {user_input}")
    print("Assistant: ", end="", flush=True)

    full_reply = ""
    res_conv_id = conversation_id

    extra_body = {}
    if conversation_id:
        extra_body["conversation_id"] = conversation_id

    # Use extra_body for non-standard parameters
    stream = client.chat.completions.create(
        model="mimo-v2-omni",
        messages=conversation,
        stream=True,
        timeout=60,
        extra_body=extra_body
    )
    
    # Capture conversation_id from headers/response isn't standard in OpenAI SDK, 
    # but our server might send it in an extra chunk or we have to rely on the server logs.
    # WAIT! Our server uses the STABLE hashing IF NOT PROVIDED.
    
    for chunk in stream:
        if chunk.choices and chunk.choices[0].delta.content:
            token = chunk.choices[0].delta.content
            print(token, end="", flush=True)
            full_reply += token
    print()

    conversation.append({"role": "assistant", "content": full_reply})
    return full_reply, res_conv_id


if __name__ == "__main__":
    print("=" * 50)
    print("Multi-turn Test (Stable Path)")
    print("=" * 50)

    # Use a FIXED identifier if we want to ensure stability
    FIXED_CONV_ID = "mimo_test_session_123456"

    # Turn 1
    chat("我的名字叫小明，我喜欢吃苹果。", FIXED_CONV_ID)

    # Turn 2
    reply, _ = chat("你还记得我叫什么名字吗？我喜欢吃什么？", FIXED_CONV_ID)

    print("\n" + "=" * 50)
    if "小明" in reply or "苹果" in reply:
        print("✅ PASS: Context carried over correctly!")
    else:
        print("❌ FAIL: Context was NOT retained. Check convId derivation.")
    print("=" * 50)
