export type MappingSource = "auto-bundle" | "auto-name" | "manual";

export interface TdApp {
  tdAppId: string;
  name: string;
  bundleId: string | null;
  ascAppStoreId: string | null;
  mappingSource: MappingSource | null;
  fetchedAt: string;
  bundleFetchedAt: string | null;
}

export interface TdDailyEngagement {
  tdAppId: string;
  date: string;
  sessions: number | null;
  dau: number | null;
  fetchedAt: string;
}

export interface TdMauCache {
  tdAppId: string;
  asOfDate: string;
  mau: number;
  fetchedAt: string;
}

export interface TdCustomEventRow {
  tdAppId: string;
  date: string;
  eventType: string;
  count: number;
  uniqueUsers: number | null;
  fetchedAt: string;
}

export interface TdBreakdownRow {
  tdAppId: string;
  date: string;
  dimension: "appVersion" | "systemVersion" | "modelName";
  value: string;
  users: number;
  sessions: number;
  fetchedAt: string;
}

export type TdSyncTrigger = "cron" | "cli" | "web";
export type TdSyncStatus = "success" | "partial" | "error" | "running";

export interface TdSyncSummary {
  apps: number;
  bundlesDiscovered: number;
  unmatched: number;
  engagementRows: number;
  customEventTypes: number;
  customEventRows: number;
  breakdownRows: number;
  mauRows: number;
  errors: number;
}
