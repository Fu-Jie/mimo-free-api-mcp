import { PassThrough } from "stream";
import _ from 'lodash';
import axios from "axios";
import fs from "fs-extra";
import path from "path";
import crypto from "crypto";
// @ts-ignore
import { fileTypeFromBuffer } from "file-type";
import { createParser } from "eventsource-parser";
import { v4 as uuidv4 } from "uuid";

import logger from "@/lib/logger.ts";
import util from "@/lib/util.ts";
import APIException from "@/lib/exceptions/APIException.ts";
import EX from "@/api/consts/exceptions.ts";
import { registerToken } from "@/lib/mimo_heartbeat.ts";
import { getEncoding } from "js-tiktoken";
import Database from "better-sqlite3";
 
// 🌟 核心数据库：用于实现基于内容哈希的 7 天会话重用
const db = new Database(path.join(process.cwd(), ".mimo_history.db"));
db.exec(`
    CREATE TABLE IF NOT EXISTS conversation_index (
        content_hash TEXT,
        user_id TEXT,
        conv_id TEXT,
        last_msg_id TEXT,
        created_at INTEGER,
        PRIMARY KEY (content_hash, user_id)
    )
`);
db.exec(`
    CREATE TABLE IF NOT EXISTS system_config (
        config_key TEXT PRIMARY KEY,
        config_value TEXT,
        updated_at INTEGER
    )
`);

const getSystemConfig = (key: string, defaultValue: any) => {
    const row = db.prepare("SELECT config_value FROM system_config WHERE config_key = ?").get(key) as any;
    if (row) {
        try { return JSON.parse(row.config_value); } catch (e) { return row.config_value; }
    }
    return defaultValue;
};

const setSystemConfig = (key: string, value: any) => {
    const valStr = typeof value === 'string' ? value : JSON.stringify(value);
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT OR REPLACE INTO system_config (config_key, config_value, updated_at) VALUES (?, ?, ?)").run(key, valStr, now);
};

const lookupSession = (messages: any[], userId: string) => {
    if (!messages || messages.length === 0 || !userId) return null;
    // 🌟 多用户隔离指纹：Hash 中包含 userId
    const contextFingerprint = `${userId}|` + messages.map(m => `${m.role}:${m.text}`).join("|");
    const hash = crypto.createHash("md5").update(contextFingerprint).digest("hex");
    const sevenDaysAgo = Math.floor(Date.now() / 1000) - (7 * 24 * 3600);
    const row = db.prepare("SELECT conv_id, last_msg_id FROM conversation_index WHERE content_hash = ? AND user_id = ? AND created_at > ? ORDER BY created_at DESC").get(hash, userId, sevenDaysAgo) as any;
    return row ? { convId: row.conv_id, lastMsgId: row.last_msg_id } : null;
};

const upsertSession = (messages: any[], convId: string, lastMsgId: string, userId: string) => {
    if (!messages || messages.length === 0 || !convId || !lastMsgId || !userId) return;
    const contextFingerprint = `${userId}|` + messages.map(m => `${m.role}:${m.text}`).join("|");
    const hash = crypto.createHash("md5").update(contextFingerprint).digest("hex");
    const now = Math.floor(Date.now() / 1000);
    db.prepare("INSERT OR REPLACE INTO conversation_index (content_hash, user_id, conv_id, last_msg_id, created_at) VALUES (?, ?, ?, ?, ?)").run(hash, userId, convId, lastMsgId, now);
};

const tokenizer = getEncoding("cl100k_base");
 
// 🌟 全局会话追踪：用于实现多轮对话在官网的连续性 (Persistent ParentID Mapping)
const SESSION_CACHE_PATH = path.join(process.cwd(), ".mimo_sessions.json");
let sessionCache: Record<string, string> = {};
try { if (fs.existsSync(SESSION_CACHE_PATH)) sessionCache = fs.readJSONSync(SESSION_CACHE_PATH); } catch (e) {}

const saveSessionParent = (convId: string, msgId: string) => {
    if (!convId || !msgId) return;
    sessionCache[convId] = msgId;
    try { fs.writeJSONSync(SESSION_CACHE_PATH, sessionCache); } catch (e) {}
};
const getSessionParent = (convId: string) => sessionCache[convId];

// 🌟 全局资源缓存：通过图片的 MD5 摘要映射小米 ResourceId...

// 🌟 全局资源缓存：通过图片的 MD5 摘要映射小米 ResourceId，实现多轮对话图片持久化 (防止重复上传)
const mediaCache = new Map<string, any>();
 
// 🌟 动态阈值管理器：自适应限流与降级逻辑 (存储在 SQLite)
const getMimoConfig = () => {
    const config = getSystemConfig("mimo_threshold", { maxSafeTokens: 15000, lastFailureTokens: 999999 });
    return config;
};

const updateSafeThreshold = (failedTokens: number) => {
    const config = getMimoConfig();
    config.lastFailureTokens = failedTokens;
    // 降级策略：取失败值的 80% 作为新阈值，最小不低于 5000
    config.maxSafeTokens = Math.max(5000, Math.floor(failedTokens * 0.8));
    logger.warn(`[Adaptive Limit] Learned new threshold: ${config.maxSafeTokens} tokens (Failed at ${failedTokens})`);
    setSystemConfig("mimo_threshold", config);
};

const CREDENTIALS_PATH = path.resolve('./credentials.json');

function extractXiaomichatbotPh(cookie: string): string {
    const match = cookie.match(/xiaomichatbot_ph="?([^";\s]+)"?/);
    if (!match) {
        throw new APIException(EX.API_REQUEST_FAILED, "Cannot extract xiaomichatbot_ph from cookie");
    }
    return match[1];
}

export async function getCredentials(req?: any) {
    const authHeader = req?.headers?.authorization;
    const authQuery = req?.query?.token;
    
    let token = "";
    if (authHeader && authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
    } else if (authQuery) {
        token = authQuery;
    }

    // 1. 尝试从 Header 或 Query 提取 (User Provided)
    if (token && (token.includes(".") || token.includes("/"))) {
        const separator = token.includes(".") ? "." : "/";
        const parts = token.split(separator);
        if (parts.length >= 2) {
            const ph = parts[0];
            const userId = parts.length === 3 ? parts[1] : (process.env.xiaomichatbot_userId || "");
            const serviceToken = parts[parts.length - 1];
            
            const cookie = `userId=${userId}; xiaomichatbot_ph=${ph}; serviceToken=${serviceToken}`;
            registerToken(cookie);
            
            return { xiaomichatbot_ph: ph, userId: userId, serviceToken: serviceToken, cookie: cookie };
        }
    }

    // 2. 尝试从环境变量兜底 (Static Deployment)
    const envPh = process.env.xiaomichatbot_ph;
    const envUserId = process.env.xiaomichatbot_userId;
    const envToken = process.env.xiaomichatbot_serviceToken;

    if (envPh && envToken) {
        const cookie = `userId=${envUserId || ""}; xiaomichatbot_ph=${envPh}; serviceToken=${envToken}`;
        return {
            xiaomichatbot_ph: envPh,
            userId: envUserId || "",
            serviceToken: envToken,
            cookie: cookie
        };
    }

    // 3. 实在没招了
    logger.error(`[Credentials Error] No valid Authorization header NO env credentials found.`);
    throw new APIException(EX.API_REQUEST_FAILED, "Missing or invalid Authorization (Format: ph.userId.token or use .env)");
}

function formatOpenAIChunk(content: string | null, model: string, finishReason: string | null = null, reasoningContent: string | null = null, usage: any = null, citations: any[] | null = null, toolCalls: any[] | null = null) {
    const delta: any = {};
    // 🌟 彻底清理：移除所有 Mimo 返回的不可见控制字符 \u0000
    const cleanContent = (content || "").replace(/\u0000/g, "");
    const cleanReasoning = (reasoningContent || "").replace(/\u0000/g, "");

    delta.content = cleanContent;
    if (cleanReasoning) delta.reasoning_content = cleanReasoning;
    if (citations && citations.length > 0) delta.citations = citations;
    if (toolCalls && toolCalls.length > 0) delta.tool_calls = toolCalls;

    const chunk: any = {
        id: `chatcmpl-${uuidv4().replace(/-/g, '')}`,
        object: "chat.completion.chunk",
        created: util.unixTimestamp(),
        model: model,
        choices: [{ index: 0, delta: delta, logprobs: null, finish_reason: finishReason }]
    };
    if (usage) chunk.usage = usage;
    return `data: ${JSON.stringify(chunk)}\n\n`;
}

// 三步走：上传图片到小米文件服务器
async function uploadMediaToMimo(base64Data: string, cookie: string, xiaomichatbot_ph: string, model: string): Promise<any> {
    // 🌟 核心修正：剥离 Data URI 前缀，确保 Buffer.from 拿到的是纯 base64 数据
    const pureBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
    const buffer = Buffer.from(pureBase64, "base64");
    const md5 = crypto.createHash("md5").update(buffer).digest("hex");

    // 🌟 核心缓存：如果该图片已经上传并解析过，直接复用 ID，实现持久会话
    if (mediaCache.has(md5)) {
        logger.info(`[Media Cache Hit] Skipping upload for MD5: ${md5}`);
        return mediaCache.get(md5);
    }

    const mimeResult = await fileTypeFromBuffer(buffer);
    const mimeType = mimeResult ? mimeResult.mime : "image/jpeg";
    const extension = mimeResult ? `.${mimeResult.ext}` : ".jpg";
    const fileName = `${uuidv4()}${extension}`;

    const headers = { 
        "Cookie": cookie, 
        "Content-Type": "application/json",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Referer": "https://aistudio.xiaomimimo.com/", "Origin": "https://aistudio.xiaomimimo.com"
    };

    try {
        // 1. 获取上传签名 URL
        const infoRes = await axios.post(
            `https://aistudio.xiaomimimo.com/open-apis/resource/genUploadInfo?xiaomichatbot_ph=${encodeURIComponent(xiaomichatbot_ph)}`,
            { fileName, fileContentMd5: md5 },
            { headers }
        );
        logger.info(`[genUploadInfo Res] ${JSON.stringify(infoRes.data)}`);
        const { uploadUrl, resourceUrl, objectName } = infoRes.data.data;

        // 2. PUT 提交 二进制数据
        logger.info(`[FDS PUT Start] URL: ${uploadUrl.substring(0, 100)}... Size: ${buffer.length}`);
        const fetchRes = await fetch(uploadUrl, {
            method: 'PUT',
            body: buffer,
            headers: {
                'Content-Type': 'application/octet-stream',
                'content-md5': md5 
            }
        });

        if (!fetchRes.ok) {
            const errorText = await fetchRes.text();
            logger.error(`[FDS PUT Failed] Status: ${fetchRes.status} Error: ${errorText}`);
            throw new Error(`FDS PUT Failed: ${fetchRes.status} ${fetchRes.statusText} - ${errorText}`);
        }
        logger.info(`[FDS PUT Success] ${objectName}`);

        // 3. 注册挂载并换取核心 ID (增加重试机制)
        const getReadyModelForParse = (m: string) => {
            const low = m.toLowerCase();
            if (low.includes("flash")) {
                return low.endsWith("-studio") ? low : `${low}-studio`;
            }
            return low;
        };
        const readyModelForParse = getReadyModelForParse(model);
        const parseUrl = `https://aistudio.xiaomimimo.com/open-apis/resource/parse?fileUrl=${encodeURIComponent(resourceUrl)}&objectName=${encodeURIComponent(objectName)}&model=${readyModelForParse}&xiaomichatbot_ph=${encodeURIComponent(xiaomichatbot_ph)}`;
        logger.info(`[Multimedia Parse Request] URL: ${parseUrl}`);
        
        let parseRes: any;
        let retryCount = 0;
        const maxRetries = 5;

        while (retryCount < maxRetries) {
            try {
                parseRes = await axios.post(parseUrl, {}, { headers: { "Cookie": cookie, "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36", "Referer": "https://aistudio.xiaomimimo.com/", "Origin": "https://aistudio.xiaomimimo.com" } });
                if (parseRes.data && parseRes.data.code === 0 && parseRes.data.data && parseRes.data.data.id) {
                    // 🌟 沉淀解析：给小米视觉引擎一点内部索引时间
                    logger.info(`[Ingestion Success] Resource ID: ${parseRes.data.data.id}. Waiting 3s for indexing...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                    break;
                }
            } catch (e) {
                logger.warn(`[Parse Attempt ${retryCount}] Failed: ${e.message}`);
            }
            retryCount++;
            if (retryCount < maxRetries) {
                await new Promise(resolve => setTimeout(resolve, 2000));
            }
        }

        if (parseRes?.data?.code === 0 && parseRes?.data?.data?.id) {
            const isVideo = mimeType.startsWith("video/");
            const isAudio = mimeType.startsWith("audio/");
            let mediaType = "image";
            if (isVideo) mediaType = "video";
            else if (isAudio) mediaType = "audio";
            else if (mimeType.includes("pdf")) mediaType = "pdf";

            const result = {
                mediaType: mediaType,
                fileUrl: resourceUrl,
                compressedVideoUrl: "",
                audioTrackUrl: isAudio ? resourceUrl : "",
                name: fileName,
                size: buffer.length,
                status: "completed",
                objectName: objectName,
                tokenUsage: parseRes.data.data.tokenUsage || 106,
                url: parseRes.data.data.id // 🌟 核心绑定：/resource/parse 返回 data.id
            };
            mediaCache.set(md5, result);
            return result;
        } else {
            throw new Error(`Parse failed after ${retryCount} retries: ${JSON.stringify(parseRes?.data || 'No Response')}`);
        }
    } catch (err: any) {
        logger.error(`[Multimedia Upload Error] ${err.message}`);
        throw err;
    }
}

function messagesPrepare(messages: any[]): { query: string, base64Medias: { base64: string, type: string, mimeType: string }[], processedMessages: any[] } {
    const base64Medias: { base64: string, type: string, mimeType: string }[] = [];
    const seenBase64 = new Set<string>(); // 🌟 用于去重

    const processedMessages = messages.map(message => {
        let text = "";
        if (Array.isArray(message.content)) {
            message.content.forEach((item: any) => {
                if (item.type === "text") { text += item.text; }
                else if ((item.type === "image_url" || item.type === "video_url" || item.type === "audio_url" || item.type === "input_file") && item[item.type]?.url) {
                    const url = item[item.type].url;
                    if (url.startsWith("data:")) {
                        const base64 = url.split(",")[1];
                        if (base64 && !seenBase64.has(base64)) {
                            const mime = url.split(";")[0].split(":")[1];
                            let type = 'image';
                            if (mime.startsWith('video')) type = 'video';
                            else if (mime.startsWith('audio')) type = 'audio';
                            base64Medias.push({ base64, type, mimeType: mime });
                            seenBase64.add(base64);
                        }
                    }
                }
            });
        } else {
            text = String(message.content || "");
            
            // 🌟 修复工具调用上下文：使用更易于模型理解的结构化描述
            if (message.role === "assistant" && message.tool_calls) {
                const calls = message.tool_calls.map((tc: any) => `- Tool: ${tc.function.name}\n  Args: ${tc.function.arguments}`).join("\n");
                text = `[Decision Record: Agent decided to use the following tools]\n${calls}`;
            } else if (message.role === "tool") {
                text = `[Observation Record: Tool result for "${message.name || message.tool_call_id}"]\n${text}`;
            }
        }
        if (text.endsWith('FINISHED')) text = text.substring(0, text.length - 8).trim();
        return { role: message.role, text };
    });

    if (processedMessages.length === 0) return { query: '', base64Medias, processedMessages: [] };

    // 🌟 核心改进：query 只取最后一条消息，之前的作为上下文参考
    const lastMsg = processedMessages[processedMessages.length - 1];
    const queryText = lastMsg.text;
    
    return { query: queryText, base64Medias, processedMessages };
}

export function createCompletionStream(model: string, messages: any[], convId?: string, req?: any) {
    const transStream = new PassThrough();

    // 🌟 1. 唯一真理源：预解析消息、媒体、提问
    let { query, base64Medias, processedMessages } = messagesPrepare(messages);
    
    const currentMimoConfig = getMimoConfig();
    let tokens = tokenizer.encode(query).length;
    logger.info(`[Token Check] Prompt Length: ${query.length} chars | Estimated Tokens: ${tokens} | Safe Threshold: ${currentMimoConfig.maxSafeTokens}`);

    if (tokens > 100000) {
        throw new APIException(EX.API_REQUEST_PARAMS_INVALID, `抱歉，您发送的文本极其超长（约 ${tokens} tokens）。即使分段发送也可能导致不可预知的错误，请尝试进一步简化。`)
            .setHTTPStatusCode(400);
    }

    let readyModel = model;
    let forceThinking = false;
    let lastMsgId = "0";

    // 🌟 2. 智商升配与模型锁定（识图场景锁定 Omni 以提高解析成功率）
    if (base64Medias.length > 0) {
        readyModel = "mimo-v2-omni"; 
        logger.info(`[AutoUpgrade] Vision detected, switching to ${readyModel}`);
    } else if (req?.body?.tools) {
        readyModel = "mimo-v2-omni";
        logger.info(`[AutoUpgrade] Tools detected, switching to ${readyModel}`);
    }

    // 🌟 3. 规范超参
    let temperature = req?.body?.temperature;
    let top_p = req?.body?.top_p ?? 0.95;

    if (temperature === undefined || temperature === null) {
        temperature = readyModel.includes("flash") ? 0.3 : 1.0;
    }

    // 内部异步执行
    (async () => {
        try {
            logger.info("[Marker] 1. createCompletionStream Inner Start");
            const creds = await getCredentials(req);
            const { cookie, xiaomichatbot_ph, userId } = creds;
            logger.info("[Marker] 2. Credentials acquired: " + xiaomichatbot_ph);

            // 3. 处理自动分段逻辑 (如果无 convId 且超过 18k Tokens)
            let currentConvId = convId;
            let currentParentId = "0";

            let isAlreadySplit = false;
            const checkAndTriggerSplit = async (targetTokens: number) => {
                const config = getMimoConfig();
                if (targetTokens > config.maxSafeTokens) {
                    logger.info(`[Workflow] Triggering Split Workflow (${targetTokens} > ${config.maxSafeTokens})...`);
                    const splitChunks = smartSplitText(query, Math.floor(config.maxSafeTokens * 0.85));
                    logger.info(`[Workflow] Split into ${splitChunks.length} chunks.`);

                    for (let i = 0; i < splitChunks.length - 1; i++) {
                        const chunkPrefix = `【系统指令：长文本分段传输 - 第 ${i+1}/${splitChunks.length} 部分】\n由于单次输入超限，我正将完整内容分拆发送。请你：\n1. 静默接收并记忆本段内容；\n2. 暂不进行分析或总结；\n3. 仅回复 "OK" 或 "已接收，请继续"。\n\n--- 文本内容如下 ---\n\n`;
                        const chunkText = chunkPrefix + splitChunks[i];
                        
                        logger.info(`[Workflow] Feeding Chunk ${i+1}/${splitChunks.length}...`);
                        const chunkResult: any = await performMimoRequest({
                            query: chunkText,
                            model: readyModel,
                            conversationId: currentConvId,
                            parentId: currentParentId,
                            xiaomichatbot_ph,
                            cookie,
                            temperature,
                            top_p
                        });
                        
                        currentConvId = chunkResult.conversationId;
                        currentParentId = chunkResult.lastMsgId;
                        logger.info(`[Workflow] Chunk ${i+1} handled. MsgID: ${currentParentId} | ConvID: ${currentConvId}`);
                    }
                    
                    // 注入结束指令，激活全文处理逻辑
                    query = `【系统指令：分段传输结束 - 最后一部分】\n这是长文本的最后一段。你现在已经拥有了核心背景的全部信息。请结合前序所有分段内容，执行以下最终指令：\n\n--- 最终指令 ---\n\n${splitChunks[splitChunks.length - 1]}`;
                    isAlreadySplit = true;
                    return true;
                }
                return false;
            };

            await checkAndTriggerSplit(tokens);
            
            if (currentConvId && currentParentId === "0") {
                // 如果是手动传入的已存在会话，尝试从本地缓存恢复 ParentID
                const cachedParent = getSessionParent(currentConvId);
                if (cachedParent) {
                    currentParentId = cachedParent;
                    logger.info(`[Session Resume] Found ParentID in cache: ${currentParentId}`);
                }
            }

            // 4. 处理多模态媒体上传 (图片/视频)
            const multiMedias: any[] = [];
            let isAnyNewMedia = false; 

            for (const media of base64Medias) {
                const md5 = crypto.createHash("md5").update(Buffer.from(media.base64, "base64")).digest("hex");
                if (!mediaCache.has(md5)) isAnyNewMedia = true;

                const dataUrl = `data:${media.mimeType};base64,${media.base64}`;
                const mediaObj = await uploadMediaToMimo(dataUrl, cookie, xiaomichatbot_ph, readyModel);
                if (mediaObj) multiMedias.push(mediaObj);
            }

            // 🌟 角色转换与对齐：直接复用最前方已处理好的 processedMessages
            const syncMessages = processedMessages.map((msg: any) => ({
                role: msg.role === 'assistant' ? 'bot' : msg.role,
                text: msg.text
            }));

            logger.info(`[Context Router Entry] Total incoming messages: ${messages.length} | Processed: ${syncMessages.length}`);

            // 🌟 连续对话路由逻辑：确保 convId 满足 32 位十六进制格式要求
            let safeConvId = "";
            let rawConvId = currentConvId || (convId ? convId : "");
            
            // 🌟 语义化智能重用逻辑：基于“全链路历史哈希”检索，包含 userId 实现多用户隔离
            if (!rawConvId) {
                const cached = lookupSession(processedMessages, userId);
                if (cached) {
                    rawConvId = cached.convId;
                    currentParentId = cached.lastMsgId;
                    logger.info(`[Semantic Cache] Multi-turn match found for User ${userId}! Reusing Conv: ${rawConvId}`);
                }
            }

            if (rawConvId) {
                // 校验是否为 32 位十六进制。如果不符合，则通过 MD5 强制转换
                if (/^[0-9a-fA-F]{32}$/.test(rawConvId)) {
                    safeConvId = rawConvId.toLowerCase();
                } else {
                    safeConvId = crypto.createHash("md5").update(rawConvId).digest("hex");
                }
            }
            
            let finalQuery = query;

            if (safeConvId) {
                // 如果没有 parentId (根消息)，且消息列表 > 1，则进行物理拼接注入
                if (syncMessages.length > 1 && currentParentId === "0") {
                    const historyText = syncMessages.slice(0, -1)
                        .map((m: any) => `（${m.role === 'bot' ? '你刚才回复' : '我刚才说过'}）：${m.text}`)
                        .join("\n");
                    finalQuery = `对话背景如下：\n${historyText}\n\n基于此背景，我的新问题是：${query}`;
                    logger.info(`[Session Routing] ID: ${safeConvId} | Spliced Context (Root Start)`);
                } else {
                    // 🌟 核心修复：有 parentId 时，finalQuery 直接等于 query，不再拼接历史
                    finalQuery = query;
                    logger.info(`[Session Routing] ID: ${safeConvId} | Branch: ${currentParentId} | Source: ${currentConvId ? "Workflow" : "Cache"}`);
                }
            } else {
                safeConvId = uuidv4().replace(/-/g, '').substring(0, 32);
                if (syncMessages.length > 1) {
                    finalQuery = syncMessages.map((m: any) => `${m.role === 'bot' ? 'Assistant: ' : 'User: '}${m.text}`).join("\n\n");
                    finalQuery += "\n\n(以上是历史对话记录，请直接针对最后的问题作答)";
                }
                logger.info(`[Stateless Routing] New ID: ${safeConvId}`);
            }

            // 🌟 4. 隐形触发模式：深度优化 Agent 角色指令
            if (req?.body?.tools) {
                const tools = req.body.tools;
                const toolsText = tools.map((t: any) => {
                    const params = t.function.parameters?.properties ? Object.keys(t.function.parameters.properties).map(k => `${k}: ${t.function.parameters.properties[k].description || "no description"}`).join(", ") : "none";
                    return `### Tool Name: ${t.function.name}\n- Description: ${t.function.description || "no description"}\n- Parameters: {${params}}`;
                }).join("\n\n");

                const agentPrompt = `[AGENT SYSTEM PROTOCOL]
You are now operating as an Advanced Agent. You must solve the user's request by utilizing the tools provided below.

# AVAILABLE TOOLS
${toolsText}

# TOOL CALLING PROTOCOL
1. **Thought Phase**: Use <think> tags to analyze whether a tool is needed.
2. **Action Phase**: If a tool is required, you MUST output the JSON object wrapped in <tool_call> tags. Example:
<tool_call>
{"tool_calls": [{"id": "call_unique", "type": "function", "function": {"name": "tool_name", "arguments": "{\"arg_name\": \"value\"}"}}]}
</tool_call>
3. **Observation Phase**: After a tool is called, the system will provide the "Observation Record". Do NOT hallucinate tool results.
4. **Final Answer**: Once you have enough information, provide a direct answer to the user.

# CONSTRAINTS
- NEVER explain that you are calling a tool.
- DO NOT use internal Search tools if an external tool can do the job.
- Output ONLY the <tool_call> block if tool calling is active.

Current Task: `;
                finalQuery = agentPrompt + finalQuery;
                logger.info(`[Agent Protocol] Injected refined tool definitions for ${tools.length} tools.`);
            }

            const parentId = "0"; 
            logger.info(`[Final Spliced Query Snapshot] ${finalQuery.substring(0, 100)}...`);

            // 🌟 3. STATION 模型映射优化
            const getStationModel = (original: string) => {
                const low = original.toLowerCase();
                if (low.includes("flash")) {
                    return low.endsWith("-studio") ? low : `${low}-studio`;
                }
                return low;
            };

            const readyModelWithStudio = getStationModel(readyModel);
            
            const payload: any = {
                msgId: uuidv4().replace(/-/g, ''), // 注入模式下，随机 msgId 即可
                conversationId: safeConvId,
                query: finalQuery, 
                messages: [], // 不传历史数组，防止后端 ID 校验失败导致的静默重置
                parentId: currentParentId,
                save: true,             
                isEditedQuery: false, 
                source: 'STATION', 
                scene: 'STATION',
                isLocal: false,
                modelConfig: {
                    enableThinking: false, 
                    webSearchStatus: (req?.body?.web_search === true) ? "enabled" : "disabled",
                    model: readyModelWithStudio,
                    temperature: temperature,
                    topP: top_p
                },
                multiMedias: multiMedias.map((m: any) => ({
                    mediaType: m.mediaType,
                    fileUrl: m.fileUrl,
                    compressedVideoUrl: "",
                    audioTrackUrl: "",
                    name: m.name,
                    size: m.size,
                    status: "completed",
                    objectName: m.objectName,
                    tokenUsage: m.tokenUsage, 
                    url: m.url 
                }))
            };
            logger.info(`[Mimo Payload] Model: ${readyModelWithStudio} | Medias: ${multiMedias.length} | Hash: ${payload.multiMedias[0]?.url}`);
            logger.info(`[Mimo Payload] Model: ${readyModel} | Medias: ${multiMedias.length} | HasNew: ${isAnyNewMedia}`);

            // 3. 异步图片预热：仅当有新图时才由于异步特征等待 3 秒；历史图（缓存命中所必解析过）直接秒开
            if (multiMedias.length > 0) {
                if (isAnyNewMedia) {
                    logger.info(`[Vision] New media detected. Waiting 3s for async processing...`);
                    await new Promise(resolve => setTimeout(resolve, 3000));
                } else {
                    logger.info(`[Vision] All media hit cache. Skipping delay (Lightning Fast mode ⚡)`);
                }
            }
            
            const encodedPh = encodeURIComponent(xiaomichatbot_ph);
            const url = `https://aistudio.xiaomimimo.com/open-apis/bot/chat?xiaomichatbot_ph=${encodedPh}`;
            const headers: any = { 
                "Content-Type": "application/json", 
                "Accept": "text/event-stream, text/plain, */*",
                "Cookie": cookie, 
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/120.0.0.0", 
                "Referer": "https://aistudio.xiaomimimo.com/", 
                "Origin": "https://aistudio.xiaomimimo.com" 
            };
            logger.info(`[Marker] 3. Target URL: ${url}`);

            // 🌟 核心修正：使用子代理抓包确认的真实 STATION 同步路径
            const saveUrl = `https://aistudio.xiaomimimo.com/open-apis/chat/conversation/save?xiaomichatbot_ph=${encodedPh}`;
            const titleUrl = `https://aistudio.xiaomimimo.com/open-apis/chat/conversation/genTitle?xiaomichatbot_ph=${encodedPh}`;
            
            const savePayload = {
                conversationId: safeConvId,
                title: query.substring(0, 30) || "新对话",
                type: "chat",
                multiMedias: payload.multiMedias // 🌟 必须同步透传图片 ID
            };

            const titlePayload = {
                conversationId: safeConvId,
                content: query
            };

            let retryCount = 0;
            const maxRetries = 3;
            let currentQuery = finalQuery; 
            let finalSuccess = false;
            let nativeUsage: any = null; 
            let fullResponseText = ""; 
            let isThinking = false; 
            let searchReferences: { title: string, url: string }[] = []; 
            let postThinkBuffer = ""; 

            while (retryCount <= maxRetries && !finalSuccess) {
                payload.query = currentQuery;
                payload.msgId = uuidv4().replace(/-/g, ''); // 每次重试更新 msgId

                fullResponseText = ""; // 重置单轮变量
                isThinking = false; 
                searchReferences = []; 
                postThinkBuffer = ""; 
                let citationBuffer = "";

                // 判断是否为非原生工具调用格式
                const isNonNativeToolCall = !req?.body?.tools && 
                    messages.some((m: any) => typeof m.content === 'string' && m.content.includes("Available Tools:") && m.content.includes("tool_calls"));
                let inToolCallTag = false;
                const flushCitations = (newText: string, isFinal = false) => {
                    const cleanText = newText.replace(/\u0000/g, "");
                    
                    // 🌟 核心拦截：检测并屏蔽 <tool_call> 标签内的内容流出
                    if (!isFinal) {
                        if (cleanText.includes("<tool_call>")) inToolCallTag = true;
                        if (inToolCallTag) {
                            if (cleanText.includes("</tool_call>")) inToolCallTag = false;
                            return ""; // 拦截流式输出
                        }
                    }

                    // 🌟 物理闪电路径：如果 buffer 为空且新内容不含引文敏感符号，直接原样下发，不走任何处理逻辑
                    if (citationBuffer === "" && !isFinal && !/[\(\[（\]]/.test(cleanText)) {
                        return cleanText;
                    }

                    citationBuffer += cleanText;
                    
                    // 1. 全能正则转换 (仅在包含敏感字符时运行)
                    const citationRegex = /[\(\[（]citation\s*:?\s*(\d+)[\)\]）]/gi;
                    citationBuffer = citationBuffer.replace(citationRegex, "[$1]");
                    
                    if (isFinal) {
                        // 终极补丁：修复未闭合引文
                        citationBuffer = citationBuffer.replace(/[\(\[（]citation\s*:?\s*(\d+)/gi, "[^$1]");
                        const remaining = citationBuffer;
                        citationBuffer = "";
                        return remaining;
                    }

                    // 2. 引文模式识别 (Aggressive Merging)
                    // 检查 buffer 末尾是否为：
                    // A. 截断的引文标记 (如 "(cit")
                    // B. 已包裹的完整引文及其连接符 (如 "[1][2] ,")
                    
                    // 情况 A：处理明显的截断截断
                    const lastPotentialIdx = Math.max(
                        citationBuffer.lastIndexOf("("),
                        citationBuffer.lastIndexOf("["),
                        citationBuffer.lastIndexOf("（")
                    );
                    if (lastPotentialIdx !== -1) {
                        const potential = citationBuffer.substring(lastPotentialIdx);
                        // 🌟 广谱前缀检测：匹配以括号开头，且后续仅包含引文零件（字母、数字、冒号、括号、空格）的片段
                        // 且长度控制在 30 字符以内
                        if (potential.length < 30 && /^[\(\[（][\s\w:\[\]\d\)\(（）]*$/i.test(potential)) {
                            const out = citationBuffer.substring(0, lastPotentialIdx);
                            citationBuffer = potential;
                            return out;
                        }
                    }

                    // 情况 B：引文链粘合。如果末尾是引文 [N] 或 [N] 加逗号/空格
                    const citationChainMatch = citationBuffer.match(/^(.*?)([\s,，、；;]*\[(\d+)\][\s,，、；;]*)+$/);
                    if (citationChainMatch) {
                        const out = citationChainMatch[1];
                        citationBuffer = citationBuffer.substring(out.length);
                        if (citationBuffer.length > 100) {
                            const fullOut = citationBuffer;
                            citationBuffer = "";
                            return out + fullOut;
                        }
                        return out;
                    }
                    
                    const out = citationBuffer;
                    citationBuffer = "";
                    return out;
                };


                const parser = createParser((event) => {
                    if (event.type === "event") {
                        // 🌟 核心拦截: 捕获搜索结果、用法数据
                        if (event.event === "web_search") {
                            try {
                                const items = JSON.parse(event.data);
                                if (Array.isArray(items)) {
                                    searchReferences = items.map((item: any) => ({
                                        title: item.name || item.title,
                                        url: item.url
                                    }));
                                    return;
                                }
                            } catch (e) {}
                        }
                        if (event.event === "usage") {
                            try { nativeUsage = JSON.parse(event.data); } catch (e) {}
                            return;
                        }
                        
                        // 🌟 核心 ID 追踪：捕获 Mimo 为最后一条 AI 消息分配的真实 ID
                        if (event.id) {
                            lastMsgId = event.id;
                        }
                        // 🌟 STATION 协议核心：捕获数据内容并提取文本
                        try {
                            const data = JSON.parse(event.data);
                            
                            let content = data.content || "";
                            content = content.replace("[DONE]", "");
                            
                            // 过滤掉内部信号
                            if (content === "webSearch" || /^\d+$/.test(content)) {
                                return;
                            }
                            
                            // 处理思维链逻辑 (<think> 标签)
                            if (content.includes("<think>")) {
                                const parts = content.split("<think>");
                                if (parts[0]) {
                                    const out = flushCitations(parts[0]);
                                    if (out) transStream.write(formatOpenAIChunk(out, model)); 
                                }
                                isThinking = true;
                                if (parts[1]) {
                                    const subParts = parts[1].split("</think>");
                                    transStream.write(formatOpenAIChunk("", model, null, subParts[0]));
                                    if (subParts.length > 1) { 
                                        isThinking = false; 
                                        if (subParts[1]) {
                                            const out = flushCitations(subParts[1]);
                                            if (out) transStream.write(formatOpenAIChunk(out, model));
                                        }
                                    }
                                }
                                fullResponseText += content.replace("<think>", "").replace("</think>", "");
                                return;
                            }

                            if (content.includes("</think>")) {
                                const parts = content.split("</think>");
                                if (parts[0]) transStream.write(formatOpenAIChunk("", model, null, parts[0]));
                                isThinking = false;
                                const postThink = (parts[1] || "");
                                if (postThink) {
                                    const out = flushCitations(postThink);
                                    if (out) transStream.write(formatOpenAIChunk(out, model));
                                    postThinkBuffer += postThink;
                                    fullResponseText += postThink;
                                }
                                return;
                            }

                            fullResponseText += content;
                            if (!isThinking) postThinkBuffer += content;

                            if (content) {
                                if (isThinking) { 
                                    transStream.write(formatOpenAIChunk(null, model, null, content)); 
                                } else { 
                                    const out = flushCitations(content);
                                    if (out) transStream.write(formatOpenAIChunk(out, model)); 
                                }
                            }
                        } catch (e) {
                            // 非 JSON 数据（如 [DONE]）会被忽略
                        }
                    }
                });

                try {
                    logger.info(`[Marker] 4. Launching bot/chat POST request...`);
                    const response = await axios.post(url, payload, { headers, responseType: "stream", timeout: 60000, validateStatus: () => true });

                    if (response.status !== 200) {
                        let errBody = "";
                        try {
                            const chunks: Buffer[] = [];
                            for await (const chunk of response.data) chunks.push(chunk);
                            errBody = Buffer.concat(chunks).toString("utf8").substring(0, 500);
                        } catch (_) {}
                        
                        logger.error(`[Mimo Edge Error] HTTP Status: ${response.status} | Body: ${errBody}`);
                        
                        // 🌟 核心改进：如果是 400 且包含“文本超长”，触发自适应降级
                        if (response.status === 400 && (errBody.includes("超长") || errBody.includes("too long"))) {
                            logger.warn(`[Adaptive fallback] 400 detected. Updating threshold and retrying with split...`);
                            updateSafeThreshold(tokenizer.encode(currentQuery).length);
                            
                            // 如果之前没拆分过，现在尝试拆分并重启本轮 payload
                            if (!isAlreadySplit) {
                                logger.info(`[Adaptive fallback] Performing emergency split...`);
                                await checkAndTriggerSplit(tokenizer.encode(query).length);
                                currentQuery = query; // 更新为拆分后的最后一段
                                payload.conversationId = crypto.createHash("md5").update(currentConvId || "").digest("hex");
                                payload.parentId = currentParentId;
                                retryCount++;
                                continue;
                            }
                        }

                        if (response.status === 400) throw new Error(`Mimo API 400: ${errBody}`);
                        
                        retryCount++;
                        continue; // 继续下一轮重试 (针对 500 等)
                    }

                    if (!response.data || typeof response.data.on !== 'function') {
                         logger.error(`[Fatal] response.data is not a stream! Type: ${typeof response.data}`);
                         throw new Error(`Mimo Server returned invalid response type: ${response.status}`);
                    }

                    const isSuccess = await new Promise((resolve) => {
                        let streamError = false;
                        response.data.on("data", (chunk: Buffer) => {
                            const text = chunk.toString("utf8");
                            // 🌟 终极调试：打印从小米收到的原始每一行（脱敏后）
                            logger.debug(`[RAW MIMIO] ${text.substring(0, 200)}${text.length > 200 ? '...' : ''}`);
                            parser.feed(text);
                        });
                        response.data.on("error", (err: any) => {
                            logger.error(`[Stream] Error: ${err.message}`);
                            streamError = true;
                            resolve(false);
                        });

                        response.data.on("end", () => {
                            if (streamError) return;
                            logger.info("[Parser] Stream end");

                            const finalOut = flushCitations("", true);
                            if (finalOut) transStream.write(formatOpenAIChunk(finalOut, model, null, null, null, null));

                            if (searchReferences.length > 0) {
                                const uniqueRefs = _.uniqBy(searchReferences, 'url');
                                const citations = uniqueRefs.map(ref => ({ title: ref.title, url: ref.url, source: "Mimo Web Search" }));
                                const refItems = searchReferences.map((ref, idx) => `[${idx + 1}] [${ref.title}](${ref.url})`).join("\n\n");
                                const referenceFooter = `\n\n<details>\n<summary>🌐 联网搜索参考资料 (${searchReferences.length} 条来源)</summary>\n\n${refItems}\n</details>\n\n`;
                                logger.info(`[Search] Emitting ${uniqueRefs.length} references/citations to client.`);
                                transStream.write(formatOpenAIChunk(referenceFooter, model, null, null, null, citations, null));
                            }

                            // 🌟 兜底：发送常规正文 (如果它不是工具调用)
                            if (fullResponseText.length > 0 && !fullResponseText.includes("<tool_call>")) {
                                logger.info(`[Response] Emitting standard text (${postThinkBuffer.length} chars)`);
                                // 注意：此处可能与流式输出重复，仅作为极其罕见的流式中断兜底
                                // transStream.write(formatOpenAIChunk(postThinkBuffer, model));
                            }

                            // 🌟 核心：多态工具解析与内容分发 (Tag 模式)
                            const toolCallTagRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
                            let match;
                            let foundAnyTool = false;

                            while ((match = toolCallTagRegex.exec(fullResponseText)) !== null) {
                                try {
                                    const jsonStr = match[1].trim()
                                        .replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/：/g, ':').replace(/，/g, ',');
                                    
                                    // 容错处理：有时模型会输出 ```json ... ``` 包裹在标签内
                                    const cleanJsonStr = jsonStr.replace(/```json\n?/, "").replace(/```/, "").trim();
                                    const rawObj = JSON.parse(cleanJsonStr);
                                    let toolCalls: any[] = [];

                                    if (Array.isArray(rawObj.tool_calls)) {
                                        toolCalls = rawObj.tool_calls;
                                    } else if (rawObj.name || (req?.body?.tools?.[0]?.function?.name)) {
                                        const funcName = rawObj.name || req.body.tools[0].function.name;
                                        toolCalls = [{ id: `call_${uuidv4().substring(0, 8)}`, type: "function", function: { name: funcName, arguments: JSON.stringify(rawObj) } }];
                                    }

                                    if (toolCalls.length > 0) {
                                        const mappedToolCalls = toolCalls.map((tc: any, idx: number) => {
                                            const funcName = tc.function?.name || tc.name || "unknown_function";
                                            let funcArgs = tc.function?.arguments || tc.arguments || tc;
                                            if (typeof funcArgs !== 'string') {
                                                if (funcArgs.name && funcArgs.arguments && Object.keys(funcArgs).length <= 2) funcArgs = funcArgs.arguments;
                                                funcArgs = JSON.stringify(funcArgs);
                                            }
                                            return { index: idx, id: tc.id || `call_${uuidv4().substring(0, 8)}`, type: "function", function: { name: funcName, arguments: funcArgs } };
                                        });

                                        logger.info(`[Tools Detect] Found ${mappedToolCalls.length} tool calls via Tag.`);
                                        transStream.write(formatOpenAIChunk(null, model, "tool_calls", null, null, null, mappedToolCalls));
                                        foundAnyTool = true;
                                    }
                                } catch (e) { 
                                    logger.warn(`[Tools] Tag Parse error: ${e.message}`); 
                                }
                            }

                            if (foundAnyTool) {
                                resolve(true); return;
                            }
                            
                            // 🌟 核心：确保非工具调用时也能正常 resolve 进入持久化阶段
                            resolve(true); 
                        });
                    });

                    if (isSuccess) {
                        finalSuccess = true;
                    } else {
                        retryCount++;
                        if (retryCount <= maxRetries && req?.body?.tools) {
                            currentQuery += `\n\n[系统追问]\n你刚才输出的格式有误，请确保输出标准的 JSON 指导。`;
                            fullResponseText = ""; 
                        } else {
                            transStream.write(formatOpenAIChunk(fullResponseText, model));
                            finalSuccess = true;
                        }
                    }
                } catch (err: any) {
                    logger.error(`[Mimo Stream Inner Err] ${err.message}`);
                    retryCount++;
                    if (retryCount > maxRetries) {
                        // 🌟 核心修正：超过重试次数应彻底抛出错误，不再误认为是成功
                        throw err;
                    }
                }
            } // 🌟 闭合 while 循环
            
            // 🌟 核心同步：只有在非 400 且有流产出的情况下才同步至官网
            if (fullResponseText.length > 0) {
                const finalSavePayload = {
                    ...savePayload,
                    title: query.substring(0, 32) || "New Mimo Chat",
                    type: "chat",
                    parentId: currentParentId // 使用当前计算出的 parentId 进行同步，实现 UI 链路对齐
                };

                // 更新全局缓存供下一轮使用
                if (lastMsgId && lastMsgId !== "0") {
                    saveSessionParent(safeConvId, lastMsgId);
                    // 🌟 同步更新 SQLite 语义索引：将当前全量历史、用户 ID 与产出的 ID 绑定
                    upsertSession(processedMessages, safeConvId, lastMsgId, userId);
                }

                axios.post(saveUrl, finalSavePayload, { headers, timeout: 5000, validateStatus: () => true })
                    .then(res => {
                        if (res.data.code === 0) {
                            logger.info(`[Sidebar Sync] Successfully SAVED turn to Mimo UI (Conv: ${safeConvId})`);
                            // 继续同步标题
                            const finalTitlePayload = { ...titlePayload, content: query };
                            return axios.post(titleUrl, finalTitlePayload, { headers, timeout: 5000, validateStatus: () => true });
                        } else {
                            logger.warn(`[Sidebar Sync] Save Rejected by Mimo: ${JSON.stringify(res.data)}`);
                        }
                    })
                    .then(res => {
                        if (res && res.data.code === 0) logger.info(`[Sidebar Sync] Title generated locally.`);
                    })
                    .catch(e => logger.warn(`[Sidebar Sync] Network error during persistence: ${e.message}`));
            }

            transStream.write(formatOpenAIChunk("", model, "stop", "", nativeUsage));
            transStream.write(`data: [DONE]\n\n`);
            transStream.end();

        } catch (err: any) {
            logger.error(`[Mimo Stream Global Error] ${err.stack || err.message}`);
            transStream.write(formatOpenAIChunk(`[Internal Connection Error] ${err.message}`, model));
            transStream.write(`data: [DONE]\n\n`);
            transStream.end();
        }
    })();

    return transStream;
}

export async function createCompletion(model: string, messages: any[], convId?: string, req?: any) {
    const stream = createCompletionStream(model, messages, convId, req);
    let fullContent = "";
    let toolCalls: any[] = [];
    let reasoningContent = "";
    let finishReason = "stop";
    let nativeUsage: any = null;

    const { createParser } = await import("eventsource-parser");

    return new Promise((resolve, reject) => {
        const parser = createParser((event) => {
            if (event.type !== "event" || !event.data || event.data === "[DONE]") return;
            
            try {
                const data = JSON.parse(event.data);
                
                // 🌟 增强检测：无论事件名称是什么，只要包含 token 计数就捕获
                if (data.promptTokens || data.prompt_tokens) {
                    nativeUsage = data;
                    if (!data.choices) return; // 如果只是纯 usage 事件，在这里返回
                }

                if (!data.choices || data.choices.length === 0) return;

                const delta = data.choices[0].delta || data.choices[0].message || {};
                if (delta.content) fullContent += delta.content;
                if (delta.reasoning_content) reasoningContent += delta.reasoning_content;
                if (delta.tool_calls) {
                    toolCalls = delta.tool_calls;
                    finishReason = "tool_calls";
                }
                if (data.choices[0].finish_reason) finishReason = data.choices[0].finish_reason;
            } catch (e) {
                // 有些 event 数据可能不是 JSON (比如纯文本)，忽略报错
            }
        });

        stream.on("data", (chunk: Buffer) => {
            parser.feed(chunk.toString());
        });

        stream.on("end", () => {
            const response = {
                id: `chatcmpl-${uuidv4().replace(/-/g, '')}`,
                object: "chat.completion",
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                    index: 0,
                    message: {
                        role: "assistant",
                        content: fullContent,
                        ...(reasoningContent ? { reasoning_content: reasoningContent } : {}),
                        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
                    },
                    finish_reason: finishReason
                }],
                usage: nativeUsage ? {
                    prompt_tokens: nativeUsage.promptTokens || nativeUsage.prompt_tokens,
                    completion_tokens: nativeUsage.completionTokens || nativeUsage.completion_tokens,
                    total_tokens: nativeUsage.totalTokens || nativeUsage.total_tokens
                } : undefined
            };
            resolve(response);
        });

        stream.on("error", (err) => reject(err));
    });
}

export async function performSearch(query: string, req?: any) {
    const creds = await getCredentials(req);
    const { cookie, xiaomichatbot_ph } = creds;
    const encodedPh = encodeURIComponent(xiaomichatbot_ph);
    const url = `https://aistudio.xiaomimimo.com/open-apis/bot/chat?xiaomichatbot_ph=${encodedPh}`;
    
    logger.info(`[Search Request] Query: ${query}`);

    const payload: any = {
        msgId: uuidv4().replace(/-/g, ''),
        conversationId: uuidv4().replace(/-/g, '').substring(0, 32),
        query: query,
        messages: [],
        parentId: "0",
        save: false,
        source: 'STATION',
        scene: 'STATION',
        atMsgId: '',
        modelConfig: {
            enableThinking: false,
            enableReference: true, 
            webSearchStatus: "enabled",
            model: "mimo-v2-pro", // 🌟 搜索专供模型
        },
        multiMedias: []
    };

    const headers: any = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://aistudio.xiaomimimo.com/",
        "Origin": "https://aistudio.xiaomimimo.com"
    };

    const controller = new AbortController();
    
    return new Promise((resolve, reject) => {
        let results: any[] = [];
        let resolved = false;

        const parser = createParser((event) => {
            if (event.type === "event") {
                if (event.event === "web_search") {
                    try {
                        const data = JSON.parse(event.data);
                        if (Array.isArray(data)) {
                            results = data.map((item: any) => ({
                                title: item.name || item.title,
                                url: item.url,
                                snippet: item.snippet || ""
                            }));
                            resolved = true;
                            controller.abort(); 
                            resolve({
                                base_resp: { status_code: 0, status_msg: "success" },
                                data: { results }
                            });
                        }
                    } catch (e) {
                        logger.error(`[Search Parse Error] ${e.message}`);
                    }
                } else if (event.event === "error") {
                    // 如果后端直接报错文本超长或其他
                    logger.error(`[Search API Error Payload] ${event.data}`);
                    resolved = true;
                    controller.abort();
                    resolve({ results: [], error: event.data });
                }
            }
        });

        axios.post(url, payload, { 
            headers, 
            responseType: "stream", 
            signal: controller.signal,
            validateStatus: () => true 
        }).then(async response => {
            if (response.status !== 200) {
                let errBody = "";
                try {
                    // 尝试读取一小段错误体
                    const chunks: any[] = [];
                    for await (const chunk of response.data) {
                        chunks.push(chunk);
                        if (Buffer.concat(chunks).length > 1000) break;
                    }
                    errBody = Buffer.concat(chunks).toString("utf8");
                } catch (e) {}
                
                logger.error(`[Search API Error] HTTP ${response.status} | Body: ${errBody}`);
                resolve({ results: [], error: `Mimo API Error: ${response.status}`, details: errBody });
                return;
            }

            response.data.on("data", (chunk: Buffer) => {
                parser.feed(chunk.toString("utf8"));
            });

            response.data.on("end", () => {
                if (!resolved) {
                    logger.warn(`[Search End] No search results found for: ${query}`);
                    resolve({
                        base_resp: { status_code: 0, status_msg: "success" },
                        data: { results: [] }
                    });
                }
            });

            response.data.on("error", (err: any) => {
                if (err.name === 'AbortError' || axios.isCancel(err)) {
                    // Normal termination
                } else {
                    logger.error(`[Search Stream Error] ${err.message}`);
                    if (!resolved) resolve({ results: [], error: err.message });
                }
            });
        }).catch(err => {
            if (err.name === 'AbortError' || axios.isCancel(err)) {
                // Normal termination
            } else {
                logger.error(`[Search POST Error] ${err.message}`);
                resolve({ results: [], error: err.message });
            }
        });

        // 20秒超时保护
        setTimeout(() => {
            if (!resolved) {
                controller.abort();
                logger.warn(`[Search Timeout] No results for: ${query}`);
                resolve({
                    base_resp: { status_code: 1, status_msg: "Search timeout" },
                    data: { results: [] }
                });
            }
        }, 20000);
    });
}
/**
 * 🌟 全模态识别接口 (Agent Tool 模式)
 * 支持图像、视频、音频、PDF
 */
export async function performVision(query: string, medias: any[], req?: any) {
    const creds = await getCredentials(req);
    const { cookie, xiaomichatbot_ph } = creds;
    const encodedPh = encodeURIComponent(xiaomichatbot_ph);
    const url = `https://aistudio.xiaomimimo.com/open-apis/bot/chat?xiaomichatbot_ph=${encodedPh}`;
    
    logger.info(`[Vision Request] Query: ${query} | Medias: ${medias.length}`);

    // 1. 处理媒体上传
    const multiMedias: any[] = [];
    let isAnyNewMedia = false; 

    for (const mediaSource of medias) {
        let base64 = "";
        let mimeType = "image/jpeg";
        
        if (typeof mediaSource === 'string') {
            if (mediaSource.startsWith('data:')) {
                base64 = mediaSource.split(",")[1];
                mimeType = mediaSource.split(";")[0].split(":")[1];
            } else if (mediaSource.startsWith('http')) {
                try {
                    const res = await axios.get(mediaSource, { responseType: 'arraybuffer' });
                    base64 = Buffer.from(res.data, 'binary').toString('base64');
                    mimeType = res.headers['content-type'] || 'image/jpeg';
                } catch (e) {
                    logger.error(`[Vision Download Error] ${mediaSource}: ${e.message}`);
                    continue;
                }
            } else {
                base64 = mediaSource; 
            }
        }

        if (base64) {
            const buffer = Buffer.from(base64, "base64");
            const md5 = crypto.createHash("md5").update(buffer).digest("hex");
            if (!mediaCache.has(md5)) isAnyNewMedia = true;
            
            const dataUrl = `data:${mimeType};base64,${base64}`;
            const mediaObj = await uploadMediaToMimo(dataUrl, cookie, xiaomichatbot_ph, "mimo-v2-omni");
            
            if (mediaObj) {
                let mediaType = "image";
                if (mimeType.startsWith("video/")) mediaType = "video";
                else if (mimeType.startsWith("audio/")) mediaType = "audio";
                else if (mimeType.includes("pdf")) mediaType = "file";

                multiMedias.push({
                    mediaType: mediaType,
                    fileUrl: mediaObj.fileUrl,
                    compressedVideoUrl: mediaType === "video" ? mediaObj.fileUrl : "",
                    audioTrackUrl: mediaType === "audio" ? mediaObj.fileUrl : "",
                    name: mediaObj.name || `vision_media_${md5.substring(0, 6)}`,
                    size: mediaObj.size || buffer.length,
                    status: "completed",
                    objectName: mediaObj.objectName,
                    tokenUsage: mediaObj.tokenUsage, 
                    url: mediaObj.url 
                });
            }
        }
    }

    if (isAnyNewMedia) {
        logger.info(`[Vision] New media, waiting 3s...`);
        await new Promise(resolve => setTimeout(resolve, 3000));
    }

    const payload: any = {
        msgId: uuidv4().replace(/-/g, ''),
        conversationId: uuidv4().replace(/-/g, '').substring(0, 32),
        query: query,
        messages: [],
        parentId: "0",
        save: false,
        source: 'STATION',
        scene: 'STATION',
        atMsgId: '',
        modelConfig: {
            enableThinking: false,
            webSearchStatus: "disabled",
            model: "mimo-v2-omni", 
        },
        multiMedias: multiMedias
    };

    const headers: any = {
        "Content-Type": "application/json",
        "Accept": "text/event-stream",
        "Cookie": cookie,
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://aistudio.xiaomimimo.com/",
        "Origin": "https://aistudio.xiaomimimo.com"
    };

    return new Promise((resolve, reject) => {
        let fullContent = "";
        let resolved = false;

        const parser = createParser((event) => {
            if (event.type === "event") {
                if (event.event === "message") {
                    try {
                        const data = JSON.parse(event.data);
                        if (data.content) fullContent += data.content;
                    } catch (e) {}
                } else if (event.event === "error") {
                    logger.error(`[Vision API Error Payload] ${event.data}`);
                    resolved = true;
                    resolve({
                        base_resp: { status_code: 2, status_msg: event.data },
                        data: { content: fullContent }
                    });
                }
            }
        });

        axios.post(url, payload, { 
            headers, 
            responseType: "stream",
            validateStatus: () => true 
        }).then(async response => {
            if (response.status !== 200) {
                let errBody = "";
                try {
                    const chunks: any[] = [];
                    for await (const chunk of response.data) {
                        chunks.push(chunk);
                        if (Buffer.concat(chunks).length > 1000) break;
                    }
                    errBody = Buffer.concat(chunks).toString("utf8");
                } catch (e) {}
                logger.error(`[Vision API Error] HTTP ${response.status} | Body: ${errBody}`);
                resolve({
                    base_resp: { status_code: 3, status_msg: `HTTP ${response.status}` },
                    data: { content: fullContent, details: errBody }
                });
                return;
            }

            response.data.on("data", (chunk: Buffer) => {
                parser.feed(chunk.toString("utf8"));
            });

            response.data.on("end", () => {
                if (!resolved) {
                    // 🌟 核心清理：剥离隐藏的思维链标签
                    const cleanContent = fullContent.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
                    resolve({
                        base_resp: { status_code: 0, status_msg: "success" },
                        data: { content: cleanContent }
                    });
                }
            });

            response.data.on("error", (err: any) => {
                logger.error(`[Vision Stream Error] ${err.message}`);
                if (!resolved) resolve({
                    base_resp: { status_code: 4, status_msg: err.message },
                    data: { content: fullContent.trim() }
                });
            });
        }).catch(err => {
            logger.error(`[Vision POST Error] ${err.message}`);
            resolve({
                base_resp: { status_code: 5, status_msg: err.message },
                data: { content: fullContent.trim() }
            });
        });
    });
}

export default {
    createCompletionStream,
    createCompletion,
    performSearch,
    performVision
};

/**
 * 🌟 智能分段工具：按 Token 数量对超长文本进行物理切分
 */
function smartSplitText(text: string, maxTokens: number): string[] {
    const chunks: string[] = [];
    const tokens = tokenizer.encode(text);
    
    let currentPos = 0;
    while (currentPos < tokens.length) {
        let endPos = currentPos + maxTokens;
        if (endPos > tokens.length) endPos = tokens.length;
        
        const chunkTokens = tokens.slice(currentPos, endPos);
        chunks.push(tokenizer.decode(chunkTokens));
        currentPos = endPos;
    }
    return chunks;
}

/**
 * 🌟 内部请求启动器：用于在工作流中串行发送背景段落 (通过解析流来获取 ID)
 */
async function performMimoRequest(options: any) {
    const { query, model, conversationId, parentId, xiaomichatbot_ph, cookie, temperature, top_p } = options;
    const encodedPh = encodeURIComponent(xiaomichatbot_ph);
    const url = `https://aistudio.xiaomimimo.com/open-apis/bot/chat?xiaomichatbot_ph=${encodedPh}`;
    
    const readyModelWithStudio = model.toLowerCase().includes("flash") && !model.endsWith("-studio") 
                                ? `${model}-studio` 
                                : model;

    const payload = {
        msgId: uuidv4().replace(/-/g, ''),
        conversationId: conversationId || uuidv4().replace(/-/g, '').substring(0, 32),
        query,
        messages: [],
        parentId,
        save: true,
        source: 'STATION',
        scene: 'STATION',
        modelConfig: {
            enableThinking: false,
            model: readyModelWithStudio,
            temperature,
            topP: top_p
        },
        multiMedias: []
    };

    const headers = {
        "User-Agent": "MimoStation/2.1.0",
        "Cookie": cookie
    };

    const response = await axios.post(url, payload, { headers, timeout: 60000, responseType: 'stream' });
    
    let lastMsgId = "0";
    let returnedConvId = conversationId || payload.conversationId;

    return new Promise((resolve, reject) => {
        response.data.on("data", (chunk: Buffer) => {
            const lines = chunk.toString("utf8").split('\n');
            for (const line of lines) {
                if (line.startsWith('id:')) {
                    lastMsgId = line.replace('id:', '').trim();
                }
                if (line.startsWith('data:')) {
                    try {
                        const dataStr = line.replace('data:', '').trim();
                        if (dataStr === '[DONE]') continue;
                        const d = JSON.parse(dataStr);
                        if (d.conversationId) returnedConvId = d.conversationId;
                        // 也可以从 data.msgId 获取最后一条消息 ID
                        if (d.id) lastMsgId = d.id;
                    } catch(e) {}
                }
            }
        });

        response.data.on("end", () => {
            resolve({ lastMsgId, conversationId: returnedConvId });
        });

        response.data.on("error", (err: any) => {
            logger.error(`[Internal Chunk Request Error] ${err.message}`);
            reject(err);
        });
    });
}
