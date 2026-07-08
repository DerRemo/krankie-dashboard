type Level = "debug" | "info" | "warn" | "error";
const LEVEL_RANK: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };

let threshold: Level = "info";

export function setLogLevel(level: Level): void {
  threshold = level;
}

function emit(level: Level, ctx: Record<string, unknown> | string, msg?: string) {
  if (LEVEL_RANK[level] < LEVEL_RANK[threshold]) return;
  const base = typeof ctx === "string" ? { msg: ctx } : { ...ctx, msg };
  const line = JSON.stringify({ ts: new Date().toISOString(), level, ...base });
  if (level === "error" || level === "warn") {
    process.stderr.write(line + "\n");
  } else {
    process.stdout.write(line + "\n");
  }
}

export const logger = {
  debug: (ctx: Record<string, unknown> | string, msg?: string) => emit("debug", ctx, msg),
  info:  (ctx: Record<string, unknown> | string, msg?: string) => emit("info",  ctx, msg),
  warn:  (ctx: Record<string, unknown> | string, msg?: string) => emit("warn",  ctx, msg),
  error: (ctx: Record<string, unknown> | string, msg?: string) => emit("error", ctx, msg),
};
