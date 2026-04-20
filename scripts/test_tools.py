import os
from openai import OpenAI
from dotenv import load_dotenv

# 🌟 Force no-proxy for local testing to avoid Connection errors
os.environ["HTTP_PROXY"] = ""
os.environ["HTTPS_PROXY"] = ""
os.environ["NO_PROXY"] = "127.0.0.1,localhost"

# Load credentials from .env
load_dotenv()

# 🌟 Smart Authentication: Construct real Mimo token from .env
mimo_cookie = os.getenv("MIMO_COOKIE", "")
if not mimo_cookie:
    ph = os.getenv("xiaomichatbot_ph", "")
    uid = os.getenv("xiaomichatbot_userId", "")
    token = os.getenv("xiaomichatbot_serviceToken", "")
    mimo_cookie = f"{ph}.{uid}.{token}"

client = OpenAI(
    api_key=mimo_cookie,
    base_url="http://127.0.0.1:8012/v1"
)

# 1. 定义更丰富的测试工具集
tools = [
    {
        "type": "function",
        "function": {
            "name": "get_current_weather",
            "description": "获取指定地点的实时天气信息",
            "parameters": {
                "type": "object",
                "properties": {
                    "location": {"type": "string", "description": "城市, 例如: 北京"},
                    "unit": {"type": "string", "enum": ["celsius", "fahrenheit"]},
                },
                "required": ["location"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "smart_calculator",
            "description": "执行复杂的数学运算 (加减乘除)",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {"type": "string", "description": "数学表达式, 例如: 125 * 45"},
                },
                "required": ["expression"],
            },
        },
    }
]

def run_test_case(title, user_input):
    print("\n" + "=" * 50)
    print(f"TEST: {title}")
    messages = [
        {"role": "system", "content": "你是一个有用的 AI 助手。"},
        {"role": "user", "content": user_input}
    ]
    print(f"[Input] {user_input}")
    print("Assistant response:", end="", flush=True)

    try:
        response = client.chat.completions.create(
            model="mimo-v2-omni",
            messages=messages,
            tools=tools,
            stream=True
        )

        full_content = ""
        tool_calls = []
        for chunk in response:
            delta = chunk.choices[0].delta
            if delta.content:
                print(delta.content, end="", flush=True)
                full_content += delta.content
            if delta.tool_calls:
                for tc in delta.tool_calls:
                    tool_calls.append(tc)

        if tool_calls:
            print("\n" + "-" * 20)
            print(f"✅ DETECTED {len(tool_calls)} TOOL CALLS:")
            for tc in tool_calls:
                print(f"   🔧 Name: {tc.function.name}")
                print(f"   📥 Args: {tc.function.arguments}")
        else:
            print("\n" + "-" * 20)
            print("❌ NO TOOL CALL DETECTED (Natural response)")
    except Exception as e:
        print(f"\n❌ FAILED: {str(e)}")

def main():
    # 测试案例 1：天气查询
    run_test_case("Weather Tool Verification", "明天北京会下雨吗？请使用 get_current_weather 工具。")
    
    # 测试案例 2：数学运算
    run_test_case("Math Tool Verification", "告诉我 125 乘以 45 等于多少？请调用 smart_calculator 工具。")

    # 测试案例 3：并行多工具（北京、东京天气 + 数学）
    run_test_case("Parallel Tool Calls (Multi-Task)", "同时帮我查一下北京、东京现在的天气，并算出 125 乘以 45 是多少。请并行调用三个工具指令。")

if __name__ == "__main__":
    main()
