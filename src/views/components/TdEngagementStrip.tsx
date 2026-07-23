import { KpiTile } from "./KpiTile";
import type { TdEngagementSummary } from "../../data/td";
import { fmtNum, fmtPct } from "../formatting";

export interface TdEngagementStripProps {
  summary: TdEngagementSummary;
}

export function TdEngagementStrip({ summary }: TdEngagementStripProps) {
  const { dau, mau, sessions, stickiness, asOfDate } = summary;
  return (
    <div class="kpi-grid td-engagement-strip">
      <KpiTile label="DAU" value={fmtNum(dau)} hint={asOfDate ?? "—"} />
      <KpiTile label="MAU (28d)" value={fmtNum(mau)} />
      <KpiTile label="Sessions / day" value={fmtNum(sessions)} hint={asOfDate ?? "—"} />
      <KpiTile label="Stickiness" value={fmtPct(stickiness)} hint="DAU / MAU" />
    </div>
  );
}
