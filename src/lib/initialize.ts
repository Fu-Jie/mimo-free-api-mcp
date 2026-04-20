import logger from './logger.js';
import environment from "./environment.ts";

process.setMaxListeners(Infinity);

process.on("uncaughtException", (err, origin) => {
    logger.error(`An unhandled error occurred: ${origin}`, err);
});
process.on("unhandledRejection", (_, promise) => {
    promise.catch(err => logger.error("An unhandled rejection occurred:", err));
});
process.on("warning", warning => logger.warn("System warning: ", warning));
process.on("exit", () => { logger.info("Service exit"); logger.footer(); });
process.on("SIGTERM", () => { logger.warn("received kill signal"); process.exit(2); });
process.on("SIGINT", () => { process.exit(0); });

// 2026 Mimo Heartbeat 纯 API 自动续签续租保鲜 (已由动态 Token 接管，停止本地静态保活)
import { startMimoHeartbeat } from "./mimo_heartbeat.ts";
startMimoHeartbeat(2 * 60 * 60 * 1000);