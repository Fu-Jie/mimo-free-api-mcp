# MiMo Free API MCP🚀 (V2.5 Series)

[English](./README_EN.md) | 简体中文


> 基于小米大模型（MiMo）官方网站（[aistudio.xiaomimimo.com](https://aistudio.xiaomimimo.com)）逆向构建的高级 OpenAI 兼容网关 + 原生 MCP 插件集成。现已全量适配 **MiMo V2.5 全模态** 系列，支持 **Thinking (思维链) 协议** 与 **Omni (全模态) 交互**。

---

## 🏗️ 核心特性 (V2.5 Features)

1.  **V2.5 全模态适配**: 深度集成 `mimo-v2.5` 与 `mimo-v2.5-pro` 模型，支持原生图像、视频、音频的复杂分析。
2.  **Thinking 协议对齐**: 完美支持官方最新的思维链 (Reasoning) 协议。流式输出中自动包含 `reasoning_content`，真实还原 AI 思考过程。
3.  **透明升级路由**: 保持对 V2 时代的兼容。请求 `mimo-v2-omni` 会自动平滑路由至 `mimo-v2.5`，`mimo-v2-pro` 会路由至 `mimo-v2.5-pro`。
4.  **环境化 Token 配置**: 支持在 `.env` 中通过 `token` 环境变量（格式：`ph.uid.token`）完成一键部署。
5.  **Native MCP Server**: 集成最新 MCP 标准。赋予 Claude / Cursor 等客户端原生的 **联网搜索 (`search`)** 与 **视觉分析 (`vision`)** 能力。

---

## 📊 模型矩阵 (Model Matrix)

| 模型 ID | 基座能力 | 推理思维链 (Thinking) | 核心优势 |
| :--- | :--- | :--- | :--- |
| `mimo-v2.5` | **全模态旗舰** | ✅ 默认开启 | 视觉、音频、多模态理解最佳方案 |
| `mimo-v2.5-pro` | **推理增强版** | ✅ 默认开启 | 逻辑严密、最强搜索与长文本分析 |
| `mimo-v2-flash` | **极速轻量版** | 可选 (后缀激活) | 毫秒级响应，适合简单对话与翻译 |
| `mimo-v2-omni` | (兼容 ID) | ✅ (路由至 2.5) | 兼容旧版 V2-Omni 客户端 |
| `mimo-v2-pro` | (兼容 ID) | ✅ (路由至 2.5-pro) | 兼容旧版 V2-Pro 客户端 |

> [!TIP]
> **强制开启 Thinking**：您可以通过为模型 ID 添加 `-thinking` 后缀（如 `mimo-v2-flash-thinking`）强制激活任何模型的思维链模式。

---

## 🔑 凭证配置 (Credentials)

项目支持通过环境变量或 API Header 传递凭证。

### 方式 A：一键式 .env 部署 (推荐)
在根目录创建 `.env` 文件，填入从官网抓取的三段式 Token：
```env
# 格式: ph.uid.token
token=xxxxxxxx.yyyyyyyy.zzzzzzzz
```

### 方式 B：OpenAI Header 传递
直接在 API 调用时使用 Bearer Token：
```bash
Authorization: Bearer xxxxxxxx.yyyyyyyy.zzzzzzzz
```

---

## 🤖 MCP 插件集成 (Cursor / Claude)

本项目 MCP 服务集成在 `8001` 端口下，已全面升级至 **2025 Streamable HTTP** 标准。

### 客户端配置示例：
请将以下配置添加到 `claude_desktop_config.json`：

```json
{
  "mcpServers": {
    "mimo": {
      "url": "http://localhost:8001/mcp",
      "type": "http",
      "headers": {
        "Authorization": "Bearer YOUR_TOKEN"
      }
    }
  }
}
```

### 提供的工具 (Tools)
- **`search(query)`**: AI 自动调用 Mimo 联网搜索。
- **`vision(query, image)`**: AI 分析图像、视频或本地资源（自动映射至 V2.5 引擎）。

---

## 🐳 快速部署 (Deployment)

```bash
# 1. 确保 .env 已配置 token
# 2. 启动容器
docker compose up -d --build
```

---

## ⚖️ 声明

本项目仅供学术交流，请遵守小米 MiMo 官方用户协议。
