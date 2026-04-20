# 🚀 Mimo Thinking 协议与超参精准对齐报告 (Alignment Walkthrough)

我们已完成对 Xiaomi Mimo API 适配器的全量升级，确保其逻辑与官方最新的 **Thinking (推理型思维链)** 协议及 **推荐超参** 策略完全对齐。

## ✅ 核心对齐事项

### 1. Thinking 协议对象重构
*   **废弃旧制**：彻底废弃了 `enableThinking` 布尔值字段（不再推荐）。
*   **全量对齐**：现已使用官方最新的对象结构：
    ```json
    "thinking": {
      "type": "enabled" // 或 "disabled"
    }
    ```
*   **代码位置**：已在 `src/api/controllers/mimo.ts` 中完成核心注入逻辑。

### 2. 模型差异化默认配置 (Smart Defaults)
根据官方文档推荐，适配器实现了智能补全逻辑：

| 模型 ID | Thinking 默认值 | 推荐 Temperature | 推荐 Top_P |
| :--- | :--- | :--- | :--- |
| **mimo-v2-flash** | `disabled` | `0.3` | `0.95` |
| **mimo-v2-pro** | `enabled` | `1.0` | `0.95` |
| **mimo-v2-omni** | `enabled` | `1.0` | `0.95` |

> [!TIP]
> **强制开启机制**：您依然可以通过模型后缀 `-thinking`（如 `mimo-v2-flash-thinking`）来强行激活任何模型的思维链模式。

### 3. 模型列表极简回归
*   **精简 UI**：模型选择列表已精简为 3 个基础 ID（Flash, Pro, Omni），不再展示冗余的后缀变体。
*   **自动映射**：适配器内部会自动将这些 ID 映射至小米官方的 `studio` 及最新命名。

---

## 🛠️ 技术验证
我们通过详细日志验证了以下 Payload 生成逻辑：
1. **Flash 请求** ➡ 自动补全为 `temperature: 0.3` 且 `thinking.type: "disabled"`。
2. **Omni 请求** ➡ 自动补全为 `temperature: 1.0` 且 `thinking.type: "enabled"`。
3. **后缀请求** ➡ 强制覆盖为 `thinking.type: "enabled"`。

适配器目前已完美对齐 Mimo Studio 最新发布的 2.0 协议规范。🚀
