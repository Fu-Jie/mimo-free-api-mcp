import axios from "axios";
import logger from "./logger.ts";

/**
 * Token 存储结构
 */
interface TokenStore {
    cookie: string;
    lastSeen: number;
}

/** 
 * 在线 Token 缓存池 (内存管理)
 * 记录所有通过 API 传入的有效 Token
 */
const activeTokens = new Map<string, TokenStore>();

/**
 * 提取 xiaomichatbot_ph
 */
function extractXiaomichatbotPh(cookie: string): string | null {
    const match = cookie.match(/xiaomichatbot_ph="?([^";\s]+)"?/);
    return match ? match[1] : null;
}

/**
 * 更新 Cookie (合并 Set-Cookie)
 */
function updateCookieWithSetCookie(currentCookie: string, setCookieHeaders: string[]): string {
    const cookieMap = new Map<string, string>();

    currentCookie.split(';').forEach(c => {
        const [name, ...value] = c.trim().split('=');
        if (name) cookieMap.set(name, value.join('='));
    });

    setCookieHeaders.forEach(setCookieStr => {
        const [cookiePart] = setCookieStr.split(';');
        const [name, ...value] = cookiePart.trim().split('=');
        if (name) cookieMap.set(name, value.join('='));
    });

    const newCookies: string[] = [];
    cookieMap.forEach((v, k) => newCookies.push(`${k}=${v}`));
    return newCookies.join('; ');
}

/**
 * 注册或更新一个 Token
 */
export function registerToken(cookie: string) {
    const ph = extractXiaomichatbotPh(cookie);
    if (!ph) return;
    
    // 如果是新 Token，打印日志方便调试
    if (!activeTokens.has(ph)) {
        logger.info(`[Auth Pool] New token registered: [${ph.substring(0, 8)}...]`);
    }

    activeTokens.set(ph, {
        cookie: cookie,
        lastSeen: Date.now()
    });
}

/**
 * 获取目前缓存的所有有效 Token
 */
export function getActiveTokens() {
    return Array.from(activeTokens.values());
}

/**
 * 对池中所有有效 Token 执行保活握手
 */
export async function heartbeatMimo() {
    const tokens = getActiveTokens();
    if (tokens.length === 0) return;

    logger.info(`Starting heartbeat for ${tokens.length} active tokens...`);

    for (const token of tokens) {
        try {
            const ph = extractXiaomichatbotPh(token.cookie);
            if (!ph) continue;

            const url = `https://aistudio.xiaomimimo.com/open-apis/user/mi/get?xiaomichatbot_ph=${ph}`;
            const response = await axios.get(url, {
                headers: { "Cookie": token.cookie, "Referer": "https://aistudio.xiaomimimo.com/" },
                timeout: 10000,
                validateStatus: () => true
            });

            if (response.status === 200) {
                const setCookie = response.headers['set-cookie'];
                if (setCookie && Array.isArray(setCookie) && setCookie.length > 0) {
                    const newCookie = updateCookieWithSetCookie(token.cookie, setCookie);
                    // 更新缓存池
                    token.cookie = newCookie;
                    token.lastSeen = Date.now();
                    logger.success(`[Heartbeat] Token [${ph.substring(0, 10)}...] extended successfully via Set-Cookie.`);
                } else {
                    logger.info(`[Heartbeat] Token [${ph.substring(0, 10)}...] is still valid (No Set-Cookie needed).`);
                }
            } else if (response.status === 401) {
                // Token 已彻底失效，移除池
                activeTokens.delete(ph);
                logger.warn(`Token [${ph.substring(0, 8)}...] expired and removed from pool.`);
            }
        } catch (err: any) {
            logger.error(`Heartbeat error for token: ${err.message}`);
        }
    }
}

/**
 * 启动全局心跳任务
 */
export function startMimoHeartbeat(intervalMs = 30 * 60 * 1000) {
    logger.info(`Starting Dynamic Token Heartbeat (Interval: ${intervalMs} ms)`);
    setInterval(heartbeatMimo, intervalMs);
}
