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
import type { SearchResponse, SearchResultItem, VisionResponse } from "./mimo.ts";
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
            { name: "mimo-free-api-mcp", version: "1.5.0" },
            { capabilities: { tools: {} } }
        );

        // --- Tool Declaration ---
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
            tools: [
                {
                    name: "search",
                    description: "Perform a web search using Mimo AI (V2.6) to get the latest information. Prefer concise 'entity + attribute + context' phrases for richest recall. Returns deduplicated results with source name, publish date, URL, and snippet.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "The search query or question to answer" },
                            model: { type: "string", description: "Optional model override (defaults to mimo-v2.6-flash; can pass mimo-v2.6-pro)" },
                            max_results: { type: "number", description: "Optional maximum number of deduplicated results to return" },
                            include_domains: { type: "array", items: { type: "string" }, description: "Optional allowlist of domain suffixes (e.g. ['github.com', 'nvidia.com'])" },
                            exclude_domains: { type: "array", items: { type: "string" }, description: "Optional blocklist of domain suffixes" },
                        },
                        required: ["query"]
                    }
                },
                {
                    name: "vision",
                    description: "Multi-modal analysis using Mimo AI (V2.6) for images, videos, audio, and PDFs. Supports single `image` or multi-image `images` comparison via URLs, Base64 data URIs, or filenames from /app/media storage.",
                    inputSchema: {
                        type: "object",
                        properties: {
                            query: { type: "string", description: "The question or instruction about the media content" },
                            image: { type: "string", description: "Single media source: URL, Base64 data URI, or filename in /app/media (e.g. 'demo.mp4')" },
                            images: { type: "array", items: { type: "string" }, description: "Multiple media sources for comparison or multi-page analysis" },
                            model: { type: "string", description: "Optional model override (defaults to mimo-v2.6-pro for images, mimo-v2.6-flash for video/audio/PDF)" },
                        },
                        required: ["query"]
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
                    const { query, model, max_results, include_domains, exclude_domains } = (args ?? {}) as {
                        query: string;
                        model?: string;
                        max_results?: number;
                        include_domains?: string[];
                        exclude_domains?: string[];
                    };
                    const result: SearchResponse = await mimo.performSearch(query, request, {
                        model,
                        maxResults: max_results,
                        includeDomains: include_domains,
                        excludeDomains: exclude_domains,
                    });

                    if (result.error) {
                        const errText = typeof result.error === "string" ? result.error : JSON.stringify(result.error);
                        const detail = result.details ? ` | ${result.details.slice(0, 300)}` : "";
                        return {
                            content: [{ type: "text", text: `Error: ${errText}${detail}` }],
                            isError: true
                        };
                    }
                    if (result.base_resp && result.base_resp.status_code !== 0) {
                        return {
                            content: [{ type: "text", text: `Error: ${result.base_resp.status_msg || "Search failed"}` }],
                            isError: true
                        };
                    }

                    const results = result.data?.results;
                    const text = Array.isArray(results) && results.length > 0
                        ? results.map((r: SearchResultItem) => {
                            const metaParts: string[] = [];
                            if (r.siteName) metaParts.push(`Source: ${r.siteName}`);
                            if (r.datePublished) metaParts.push(`Published: ${r.datePublished}`);
                            const metaLine = metaParts.length > 0 ? `\n${metaParts.join(" | ")}` : "";
                            return `### ${r.title}\nURL: ${r.url}${metaLine}\n${r.snippet}`;
                        }).join("\n\n")
                        : "No search results found.";
                    return { content: [{ type: "text", text }] };
                }

                if (name === "vision") {
                    const { query, image, images, model } = (args ?? {}) as {
                        query: string;
                        image?: string;
                        images?: string[];
                        model?: string;
                    };
                    const mediaList = Array.isArray(images) && images.length > 0 ? images : (image ? [image] : []);
                    if (mediaList.length === 0) {
                        return {
                            content: [{ type: "text", text: "Error: Either `image` or non-empty `images` is required." }],
                            isError: true
                        };
                    }
                    const result: VisionResponse = await mimo.performVision(query, mediaList, request, { model });
                    if (result.base_resp.status_code !== 0) {
                        const detail = result.data.details ? ` | ${result.data.details.slice(0, 300)}` : "";
                        return {
                            content: [{ type: "text", text: `Error: ${result.base_resp.status_msg || "Vision failed"}${detail}` }],
                            isError: true
                        };
                    }
                    const text = result.data.content || "No content recognized.";
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
