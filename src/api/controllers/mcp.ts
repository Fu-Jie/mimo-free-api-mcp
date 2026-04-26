// @ts-ignore
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
// @ts-ignore
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
// @ts-ignore
} from "@modelcontextprotocol/sdk/types.js";
import { randomUUID } from "crypto";
import * as mimo from "./mimo.ts";
import logger from "@/lib/logger.ts";
import Request from "@/lib/request/Request.ts";

/**
 * MCP Server Manager (2025-03-26 Streamable HTTP Standard)
 *
 * Implements the latest MCP specification using StreamableHTTPServerTransport.
 * Key differences from legacy SSE transport:
 * - Single endpoint for both GET (SSE stream) and POST (JSON-RPC messages)
 * - Session management via `mcp-session-id` header
 * - Transport creates session on `initialize` request, reuses on subsequent
 */
export class MCPServerManager {

    // Active transports keyed by session ID
    private static transports: Record<string, { transport: StreamableHTTPServerTransport, server: Server }> = {};

    // Request objects keyed by session ID for credential access during tool execution
    private static credentials: Record<string, Request> = {};

    /**
     * Check if a session ID exists
     */
    public static hasSession(sessionId: string): boolean {
        return !!this.transports[sessionId];
    }

    /**
     * Create a configured MCP Server instance with tools bound to a specific user's credentials.
     * @param sessionRef Mutable reference to the session ID (updated after onsessioninitialized)
     * @param fallbackRequest The original HTTP request, used as fallback for credentials
     */
    private static createServerWithRef(sessionRef: { id: string }, fallbackRequest: Request): Server {
        const server = new Server(
            { name: "mimo-free-api-mcp", version: "1.2.0" },
            { capabilities: { tools: {} } }
        );

        // --- Tool Declaration ---
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "search",
                    description: "Perform a web search using Mimo AI to get the latest information. Returns a summary of findings with citations.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "The search query or question to answer" },
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "vision",
                    description: "Multi-modal analysis for images, videos, and audio. Supports URLs, Base64 data URIs, or simple Filenames (which are automatically retrieved from the fixed /app/media storage).",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "The question or instruction about the media content" },
                            image: { type: "string", description: "Media source: Can be a URL, Base64 URI, or just a Filename (e.g., 'video.mp4') from the local storage." },
                        },
                        required: ["query", "image"]
                    }
                }
            ]
        }));

        // --- Tool Execution ---
        server.setRequestHandler(CallToolRequestSchema, async (call) => {
            const { name, arguments: args } = call.params;
            // Resolve credentials: try session store first, then fallback to original request
            const request = this.credentials[sessionRef.id] || fallbackRequest;
            logger.info(`[MCP] Executing tool: ${name} (session: ${sessionRef.id})`);

            try {
                if (name === "search") {
                    const { query } = args as { query: string };
                    const result = await mimo.performSearch(query, request) as any;

                    let text = "No search results found.";
                    if (result && result.data && result.data.results) {
                        text = result.data.results
                            .map((r: any) => `### ${r.title}\nURL: ${r.url}\n${r.snippet}`)
                            .join("\n\n");
                    }
                    return { content: [{ type: "text", text }] };
                }

                if (name === "vision") {
                    const { query, image } = args as { query: string, image: string };
                    const result = await mimo.performVision(query, [image], request) as any;
                    const text = result?.data?.content || "No content recognized.";
                    return { content: [{ type: "text", text }] };
                }

                throw new Error(`Tool not found: ${name}`);
            } catch (err: any) {
                logger.error(`[MCP] Tool execution error (${name}):`, err.message);
                return {
                    content: [{ type: "text", text: `Error: ${err.message}` }],
                    isError: true
                };
            }
        });

        return server;
    }

    /**
     * Check if a JSON-RPC body is an "initialize" request.
     */
    private static isInitializeRequest(body: any): boolean {
        if (body && body.method === "initialize") return true;
        if (Array.isArray(body) && body.some((msg: any) => msg.method === "initialize")) return true;
        return false;
    }

    /**
     * Handle all MCP HTTP traffic (POST and GET) on a single endpoint.
     * Follows the 2025-03-26 Streamable HTTP specification.
     */
    static async handle(ctx: any, request: Request) {
        // Support session ID from both headers (standard) and query (SSE fallback)
        const sessionId = (ctx.headers["mcp-session-id"] || ctx.query.sessionId) as string | undefined;
        const body = request.body;

        // --- POST: JSON-RPC messages ---
        if (ctx.method === "POST") {
            // Case 1: Existing session — route to its transport
            if (sessionId && this.transports[sessionId]) {
                logger.info(`[MCP] Routing POST to existing session: ${sessionId}`);
                await this.transports[sessionId].transport.handleRequest(ctx.req, ctx.res, body);
                ctx.respond = false;
                return;
            }

            // Case 2: No session + initialize request — create new session
            if (this.isInitializeRequest(body)) {
                logger.info("[MCP] Received initialize request, creating new session...");

                // Mutable ref so the server's tool handlers can access the real session ID
                const sessionRef = { id: "pending" };

                const transport = new StreamableHTTPServerTransport({
                    sessionIdGenerator: () => randomUUID(),
                    onsessioninitialized: (newSessionId: string) => {
                        logger.info(`[MCP] Session initialized: ${newSessionId}`);
                        sessionRef.id = newSessionId;
                        // Store the transport and credentials for this session
                        this.transports[newSessionId] = { transport, server };
                        this.credentials[newSessionId] = request;

                        // Cleanup on close
                        transport.onclose = () => {
                            logger.info(`[MCP] Session ${newSessionId} closed. Cleaning up...`);
                            delete this.transports[newSessionId];
                            delete this.credentials[newSessionId];
                        };
                    }
                });

                const server = this.createServerWithRef(sessionRef, request);
                await server.connect(transport);

                // Now handle the initialize request itself
                await transport.handleRequest(ctx.req, ctx.res, body);
                ctx.respond = false;
                return;
            }

            // Case 3: No session + not initialize — reject
            logger.warn("[MCP] POST without valid session or initialize request");
            ctx.status = 400;
            ctx.body = {
                jsonrpc: "2.0",
                error: { code: -32000, message: "Bad Request: No valid session. Send an initialize request first." },
                id: null
            };
            return;
        }

        // --- GET: SSE stream for server-initiated notifications ---
        if (ctx.method === "GET") {
            if (sessionId && this.transports[sessionId]) {
                logger.info(`[MCP] SSE stream established for session: ${sessionId}`);
                await this.transports[sessionId].transport.handleRequest(ctx.req, ctx.res, undefined);
                ctx.respond = false;
                return;
            }

            if (!sessionId) {
                // Health check or initial probe
                ctx.status = 200;
                ctx.body = { status: "ok", service: "mimo-mcp", message: "Send a POST with initialize request to start a session." };
                return;
            }

            logger.info(`[MCP] GET rejected: Session ${sessionId} not found or expired.`);
            ctx.status = 410; // Gone
            ctx.body = { error: "Session expired", code: "SESSION_EXPIRED" };
            return;
        }

        // --- DELETE: Session termination ---
        if (ctx.method === "DELETE") {
            if (sessionId && this.transports[sessionId]) {
                logger.info(`[MCP] DELETE session: ${sessionId}`);
                const session = this.transports[sessionId];
                await session.transport.close();
                await session.server.close();
                delete this.transports[sessionId];
                delete this.credentials[sessionId];
                ctx.status = 200;
                ctx.body = { ok: true };
                return;
            }
            ctx.status = 404;
            ctx.body = { error: "Session not found" };
            return;
        }
    }
}
