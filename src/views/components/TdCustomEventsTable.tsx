import type { TdCustomEventSummary } from "../../data/td";
import { MetricSparkline } from "./Sparkline";

export interface TdCustomEventsTableProps {
  events: TdCustomEventSummary[];
}

export function TdCustomEventsTable({ events }: TdCustomEventsTableProps) {
  if (events.length === 0) {
    return <p class="empty-block">No custom events discovered yet.</p>;
  }
  return (
    <table class="data-table td-custom-events-table">
      <thead>
        <tr>
          <th>Event</th>
          <th>Trend (7d)</th>
          <th class="num">Count</th>
          <th class="num">Unique users</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr>
            <td class="event-name">{e.eventType}</td>
            <td class="event-spark">
              <MetricSparkline values={e.series.map((s) => s.count)} />
            </td>
            <td class="num">{e.totalCount.toLocaleString("en-US")}</td>
            <td class="num">{e.uniqueUsers != null ? e.uniqueUsers.toLocaleString("en-US") : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
