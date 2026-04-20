import Request from '@/lib/request/Request.ts';
import Response from '@/lib/response/Response.ts';
import { getCredentials } from '@/api/controllers/mimo.ts';
import { MCPServerManager } from '@/api/controllers/mcp.ts';
import logger from '@/lib/logger.ts';

export default {

    prefix: '/mcp',

    get: {

        '': async (request: Request, ctx: any) => {
            const sessionId = ctx.headers["mcp-session-id"];
            // 🌟 如果已经有 Session 且管理器中有记录，则跳过 Token 校验（由 Manager 处理后续）
            if (!sessionId || !MCPServerManager.hasSession(sessionId)) {
                try {
                    await getCredentials(request);
                } catch (err) {
                    logger.warn("[MCP] Unauthorized access attempt (GET)");
                    return new Response({ error: 'Unauthorized', message: 'Missing or invalid token' }, { statusCode: 401 });
                }
            }

            // Handle MCP SSE stream
            await MCPServerManager.handle(ctx, request);
        }

    },

    post: {

        '': async (request: Request, ctx: any) => {
            const sessionId = ctx.headers["mcp-session-id"];
            // 🌟 核心修复：如果已建立会话，无需每次 POST 都带 Token
            if (!sessionId || !MCPServerManager.hasSession(sessionId)) {
                try {
                    await getCredentials(request);
                } catch (err) {
                    logger.warn("[MCP] Unauthorized access attempt (POST)");
                    return new Response({ error: 'Unauthorized' }, { statusCode: 401 });
                }
            }

            // Handle MCP JSON-RPC message
            await MCPServerManager.handle(ctx, request);
        }

    },

    delete: {

        '': async (request: Request, ctx: any) => {
            // Handle MCP session termination
            await MCPServerManager.handle(ctx, request);
        }

    }

}
