import { homedir } from "os";
import { join } from "path";

export interface AscConfig {
  issuerId: string;
  keyId: string;
  privateKeyPath: string;
  vendorNumber: string;
  apiBase: string;
  dbPath: string;
}

export interface TdConfig {
  apiToken: string;
  apiBase: string;
  dbPath: string;
}

export interface Config {
  port: number;
  krankieBin: string;
  krankieDb: string;
  logLevel: "debug" | "info" | "warn" | "error";
  hostname: string;
  ascCliBin: string;
  asc: AscConfig;
  ascConfigured: boolean;
  td: TdConfig;
  tdConfigured: boolean;
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const port = Number(env.PORT ?? 3737);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${env.PORT}`);
  }
  const level = (env.LOG_LEVEL ?? "info").toLowerCase();
  if (!["debug", "info", "warn", "error"].includes(level)) {
    throw new Error(`Invalid LOG_LEVEL: ${env.LOG_LEVEL}`);
  }

  const root = join(homedir(), ".krankie-dashboard");
  // Treat empty-string env vars as unset (avoids surprises when .env has bare `ASC_DB=` lines).
  const orDefault = (v: string | undefined, fallback: string) => (v && v.length > 0 ? v : fallback);
  const asc: AscConfig = {
    issuerId: env.ASC_ISSUER_ID ?? "",
    keyId: env.ASC_KEY_ID ?? "",
    privateKeyPath: expandHome(env.ASC_PRIVATE_KEY_PATH ?? ""),
    vendorNumber: env.ASC_VENDOR_NUMBER ?? "",
    apiBase: orDefault(env.ASC_API_BASE, "https://api.appstoreconnect.apple.com"),
    dbPath: expandHome(orDefault(env.ASC_DB, join(root, "asc.db"))),
  };
  const ascConfigured = Boolean(
    asc.issuerId && asc.keyId && asc.privateKeyPath && asc.vendorNumber,
  );

  const td: TdConfig = {
    apiToken: env.TELEMETRYDECK_API_TOKEN ?? "",
    apiBase: orDefault(env.TELEMETRYDECK_API_BASE, "https://api.telemetrydeck.com"),
    dbPath: expandHome(orDefault(env.TD_DB, join(root, "td.db"))),
  };
  const tdConfigured = Boolean(td.apiToken);

  return {
    port,
    krankieBin: env.KRANKIE_BIN ?? "krankie",
    krankieDb: env.KRANKIE_DB ?? join(homedir(), ".krankie", "krankie.db"),
    logLevel: level as Config["logLevel"],
    hostname: env.HOSTNAME ?? "krankie.local",
    ascCliBin: env.ASC_CLI_BIN ?? "asc",
    asc,
    ascConfigured,
    td,
    tdConfigured,
  };
}
