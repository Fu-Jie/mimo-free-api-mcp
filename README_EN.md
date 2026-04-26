# MiMo Free API MCP🚀 (V2.5 Series)

English | [简体中文](./README.md)


> An advanced OpenAI-compatible gateway + native MCP plugin integration based on the reverse engineering of the official Xiaomi Large Model (MiMo) website ([aistudio.xiaomimimo.com](https://aistudio.xiaomimimo.com)). Now fully adapted to the **MiMo V2.5 Multimodal** series, supporting the **Thinking (Chain of Thought) protocol** and **Omni (Multimodal) interaction**.

---

## 🏗️ Core Features (V2.5 Features)

1.  **V2.5 Multimodal Adaptation**: Deep integration of `mimo-v2.5` and `mimo-v2.5-pro` models, supporting complex analysis of native images, videos, and audio.
2.  **Thinking Protocol Alignment**: Perfectly supports the latest official Chain of Thought (Reasoning) protocol. Stream output automatically includes `reasoning_content`, authentically restoring the AI's thinking process.
3.  **Transparent Upgrade Routing**: Maintains compatibility with the V2 era. Requests for `mimo-v2-omni` are smoothly routed to `mimo-v2.5`, and `mimo-v2-pro` to `mimo-v2.5-pro`.
4.  **Environmental Token Configuration**: Supports one-click deployment via the `token` environment variable (format: `ph.uid.token`) in `.env`.
5.  **Native MCP Server**: Integrated with the latest MCP standards. Empowers clients like Claude and Cursor with native **web search (`search`)** and **visual analysis (`vision`)** capabilities.

---

## 📊 Model Matrix

| Model ID | Base Capability | Thinking (Reasoning) | Core Advantages |
| :--- | :--- | :--- | :--- |
| `mimo-v2.5` | **Multimodal Flagship** | ✅ Enabled by default | Best for visual, audio, and multimodal understanding |
| `mimo-v2.5-pro` | **Inference Enhanced** | ✅ Enabled by default | Rigorous logic, strongest search, and long-text analysis |
| `mimo-v2-flash` | **Ultra-fast Lightweight** | Optional (via suffix) | Millisecond response, ideal for simple dialogue and translation |
| `mimo-v2-omni` | (Compatibility ID) | ✅ (Routed to 2.5) | Compatible with legacy V2-Omni clients |
| `mimo-v2-pro` | (Compatibility ID) | ✅ (Routed to 2.5-pro) | Compatible with legacy V2-Pro clients |

> [!TIP]
> **Force Enable Thinking**: You can force activate the reasoning chain for any model by adding the `-thinking` suffix to the Model ID (e.g., `mimo-v2-flash-thinking`).

> [!WARNING]
> **Tool Calling Limitation**: Native Function Calling is currently extremely unstable and **cannot be reliably used in Agents (e.g., AutoGPT, LangChain Agents)**. It is recommended for use only in dialogue, visual analysis, or via the MCP plugin in supported clients (e.g., Claude/Cursor).

---

## 🔑 Credential Configuration

The project supports passing credentials via environment variables or API headers.

### Method A: One-click .env Deployment (Recommended)
Create a `.env` file in the root directory (refer to `.env.example`) and fill in the Token captured from the official website:
```env
# Format: ph.uid.token or long encrypted string
token=xxxxxxxx.yyyyyyyy.zzzzzzzz
```

### Method B: OpenAI Header Transmission
Use the Bearer Token directly during API calls:
```bash
Authorization: Bearer YOUR_MIMO_TOKEN
```

---

## 📂 Local File Support (Docker Mode)

When running in Docker, the service cannot access host files by default due to container isolation.

### Core Workflow:
1. **Multi-Mode Support**: This project supports **URLs**, **Base64 Data**, and **Local Filenames**.
2. **Mount & Map (Local)**: To use local files, place them in a host directory and map it to `/app/media` in your `docker-compose.yml`:
   ```yaml
   volumes:
     - /your/host/path:/app/media:ro
   ```
3. **Simple Access**: Once mounted, just tell the AI the filename (e.g., "Analyze `test.mp4`"). The system will automatically look in `/app/media`.

### 💡 Usage Tips & Prompting Guide
- **Filename (Recommended)**: "Analyze this local video: `demo.mp4`"
- **URL Address**: "Check this online image: `https://example.com/cat.jpg`"
- **Base64**: Simply paste the Base64 Data URI to the AI.
- **Comparison**: "Compare `local_image.png` with this web image `https://.../2.jpg`"

> **Note**: Ensure the AI has access to the `vision` tool. This project informs the AI in the tool schema about these multiple sources.

---

## 🤖 MCP Plugin Integration (Cursor / Claude)

The MCP service in this project is integrated on port `8001` and has been fully upgraded to the **2025 Streamable HTTP** standard.

### Client Configuration Example:
Please add the following configuration to `claude_desktop_config.json`:

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

### Provided Tools
- **`search(query)`**: AI automatically calls MiMo's web search.
- **`vision(query, image)`**: AI analyzes images, videos, audio, or local resources (supports local absolute paths, Base64, or URLs).

---

## 🐳 Quick Deployment

```bash
# 1. Ensure .env is configured with the token
# 2. Start the container
docker compose up -d --build
```

---

## ⚖️ Disclaimer

This project is for academic exchange only. Please comply with the official Xiaomi MiMo user agreement.
