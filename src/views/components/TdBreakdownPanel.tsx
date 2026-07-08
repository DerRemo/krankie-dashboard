import type { TdBreakdownEntry } from "../../data/td";

export interface TdBreakdownPanelProps {
  panels: Array<{
    label: string;
    dimension: "appVersion" | "systemVersion" | "modelName";
    entries: TdBreakdownEntry[];
  }>;
}

export function TdBreakdownPanel({ panels }: TdBreakdownPanelProps) {
  return (
    <div class="td-breakdown-panel" data-td-breakdown>
      <div class="breakdown-tabs" role="tablist">
        {panels.map((p, i) => (
          <button
            type="button"
            role="tab"
            data-breakdown-tab={p.dimension}
            aria-selected={i === 0 ? "true" : "false"}
            class={`tab ${i === 0 ? "is-active" : ""}`}
          >
            {p.label}
          </button>
        ))}
      </div>
      {panels.map((p, i) => {
        const max = Math.max(1, ...p.entries.map((e) => e.users));
        return (
          <div
            data-breakdown-panel={p.dimension}
            hidden={i !== 0}
            class="breakdown-list"
          >
            {p.entries.length === 0 && <p class="empty-block">No data.</p>}
            {p.entries.map((e) => (
              <div class="breakdown-row">
                <div class="row-label">{e.value}</div>
                <div class="row-bar" style={`width: ${(e.users / max) * 100}%`} />
                <div class="row-value">{e.users.toLocaleString("en-US")}</div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}
