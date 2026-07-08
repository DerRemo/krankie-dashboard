export type AccessType = "ONGOING" | "ONE_TIME_SNAPSHOT";
export type SyncStatus = "running" | "success" | "partial" | "failed";
export type SyncTrigger = "cron" | "manual";

export type AnalyticsCategory =
  | "APP_STORE_ENGAGEMENT"
  | "APP_STORE_COMMERCE"
  | "APP_USAGE"
  | "FRAMEWORKS_USAGE"
  | "COMMERCE"
  | "PERFORMANCE";

export interface AscApp {
  appStoreId: string;
  appleId: string;
  name: string | null;
  bundleId: string | null;
  sku: string | null;
  fetchedAt: string;
}

export interface SalesRow {
  appStoreId: string;
  date: string;
  territory: string;
  units: number;
  redownloads: number;
  updates: number;
  /** Original-currency developer proceeds (sum across rows in the bucket). */
  proceedsLocal: number;
  /** Original-currency IAP developer proceeds. */
  iapProceedsLocal: number;
  /** ISO 4217 code of the bucket's currency; null only for legacy rows. */
  proceedsCurrency: string | null;
  /** USD-converted proceeds; null until FX pass runs for non-USD buckets. */
  proceedsUsd: number | null;
  iapUnits: number;
  /** USD-converted IAP proceeds; null until FX pass runs for non-USD buckets. */
  iapProceedsUsd: number | null;
}

export interface PurchaseRow {
  appStoreId: string;
  date: string;
  territory: string;
  purchases: number;
  proceedsUsd: number;
  salesUsd: number;
  payingUsers: number;
}

export interface ReviewRow {
  appStoreId: string;
  reviewId: string;
  territory: string;
  rating: number;
  title: string | null;
  body: string | null;
  reviewerNickname: string | null;
  createdAt: string;
}

export interface RatingSnapshotRow {
  appStoreId: string;
  territory: string;
  average: number;
  count: number;
  stars1: number;
  stars2: number;
  stars3: number;
  stars4: number;
  stars5: number;
}

export interface ReviewSummarizationRow {
  appStoreId: string;
  territory: string;
  summaryText: string;
}

export interface AnalyticsRow {
  appStoreId: string;
  date: string;
  territory: string;
  impressions?: number | null;
  productPageViews?: number | null;
  firstTimeDownloads?: number | null;
  sessions?: number | null;
  activeDevices?: number | null;
  crashes?: number | null;
}

export interface ReportRequest {
  id: number;
  appleId: string;
  accessType: AccessType;
  requestId: string;
  createdAt: string;
}

export interface SyncRun {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  trigger: SyncTrigger;
  status: SyncStatus;
  summaryJson: string | null;
  error: string | null;
}

export interface SyncSummary {
  apps: number;
  salesRows: number;
  salesDaysFetched: number;
  analyticsRows: number;
  purchasesRows?: number;
  reviewRows?: number;
  ratingSnapshotRows?: number;
  summarizationRows?: number;
  analyticsCategoryCounts: Partial<Record<AnalyticsCategory, number>>;
  analyticsReportCategoryCounts?: Partial<Record<AnalyticsCategory, number>>;
  analyticsDailyInstanceCategoryCounts?: Partial<Record<AnalyticsCategory, number>>;
  analyticsSegmentCategoryCounts?: Partial<Record<AnalyticsCategory, number>>;
  analyticsFetchedSegmentCategoryCounts?: Partial<Record<AnalyticsCategory, number>>;
  analyticsReportSamples?: string[];
  analyticsErrorSamples?: string[];
  queuedSegments: number;
  errors: number;
}
