# MiMo Free API MCP🚀

> 基于小米大模型（MiMo）官方网站（[aistudio.xiaomimimo.com](https://aistudio.xiaomimimo.com)）逆向构建的高级 OpenAI 兼容网关 + 原生 MCP 插件集成。集成了 **SQLite 语境持久化**、**智能长文本自动分切**、以及 **多用户隔离的 MCP 工具集**。

---

## 🏗️ 核心架构 (Core Architecture)

本项目采用 **集成化单体服务** 模式，通过 Docker 一键部署：

1.  **API Gateway (8001)**: 
    - 核心网关，提供 OpenAI 兼容的 `/chat/completions`。
    - 兼具多模态资源上传、长文本自动分切、以及基于 MD5 指纹的上下文持久化。
2.  **Native MCP Server (Integrated)**:
    - 基于 **Model Context Protocol (Node.js SDK)** 原生实现。
    - **Session 隔离**: 每个连接均拥有独立的上下文，支持多用户并发。
    - **动态注入**: 将小米的搜索、识图能力直接“投喂”给 Claude / Cursor 自身的推理逻辑。

---

## 🚨 核心警告：功能边界说明 (Critical Warning)

在使用本项目前，请务必理解以下功能差异：

### 1. 原生工具调用 (Native Tool Calling)
本项目在 `/v1/chat/completions` 接口中保持了 OpenAI `tools` 字段的兼容性。
- **实现原理**: 基于 Chat 接口模拟/转换产生的工具调用。
- **功能特性**: 适用于简单的单次工具触发，由于转换机制限制，不建议用于构建 Agent 自主闭环。

### 2. MCP 插件服务 (MCP Plugins)
MCP 服务是独立于 API 的功能模块，通过插件协议直接与 AI 客户端（如 Claude / Cursor）交互。
- **实现原理**: 基于 Model Context Protocol 原生实现。
- **功能特性**: 直接为客户端提供 Mimo 的 **联网搜索 (`search`)** 和 **全模态识图 (`vision`)** 能力。

---

## 🤖 MCP 服务详细介绍 (Deep Dive)

**Model Context Protocol (MCP)** 是由 Anthropic 发布的开放协议。通过本项目集成的 MCP Server，您可以赋予 AI 助手（如 Claude Desktop, Cursor）原本不具备的能力：

- **Search 增强**: 当您询问实时新闻、技术文档或最新股价时，AI 会自动调用 `search` 工具。它会访问小米搜索后端，获取多个来源的摘要，并由 AI 整合输出。
- **全模态 Vision**: 突破普通的图文识别。通过 `vision` 工具，AI 可以直接“看”到您本地的图片、扫描件、PDF，甚至分析视频内容。

---

## 📊 模型矩阵 (Model Matrix)

| 模型 ID | 基座能力 | 核心优势 | 模块支持 |
| :--- | :--- | :--- | :--- |
| `mimo-v2-flash` | 轻量、高频率 | 响应极速，性价比极高 | 文本 |
| `mimo-v2-omni` | **全模态旗舰** | 视觉、音频、工具调用最佳 | 文本、图像、视频、音频 |
| `mimo-v2-pro` | 强逻辑、专业版 | 思维缜密，最强搜索增强 | 文本、搜索 |

---

## 🔑 凭证配置 (Credentials)

采用小米标准的 Bearer 鉴权，内容为 `ph.uid.token` 三段式组合：

- **格式**: `xxxxxxxx.yyyyyyyy.zzzzzzzz`
- **获取**: 通过小米 AI 实验室 F12 抓包获取 Cookie 中的 `xiaomichatbot_ph`、`userId` 和 `serviceToken`。

---

## 🤖 MCP 插件集成配置 (Cursor / Claude)

本项目 MCP 服务集成在 `8001` 端口下，已全面升级至 **2025 Streamable HTTP** 标准。

### 客户端配置：
请将以下 JSON 配置添加到您的客户端（如 `claude_desktop_config.json`），并将 `YOUR_TOKEN` 替换为三段式 Bearer 内容。

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

> [!TIP]
> **鉴权优势**: 通过 `headers` 模式配置，凭证不会在日志或 URL 中明文显示，安全性更高。

### 获取的工具 (Tools)
- **`search(query)`**: AI 自动调用 Mimo 联网搜索。
- **`vision(query, image)`**: AI 分析图像、视频或文档资源。

---

## 🐳 快速部署 (Deployment)

```bash
docker compose up -d --build
```

---

## ⚖️ 声明

本项目仅供学术交流，请遵守小米 MiMo 官方用户协议。
