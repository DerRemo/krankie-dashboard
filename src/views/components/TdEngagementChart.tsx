import type { TdEngagementPoint } from "../../data/td";

export interface TdEngagementChartProps {
  appId: string;
  points: TdEngagementPoint[];
}

export function TdEngagementChart({ appId, points }: TdEngagementChartProps) {
  const payload = JSON.stringify({
    dates: points.map((p) => p.date),
    sessions: points.map((p) => p.sessions ?? null),
    dau: points.map((p) => p.dau ?? null),
  });
  return (
    <div class="td-engagement-chart" data-td-engagement-chart={appId}>
      <div class="chart-host" data-td-engagement data-series={payload} />
    </div>
  );
}
