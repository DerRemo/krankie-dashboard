type State = "idle" | "running" | "success" | "error";

const COLOR: Record<State, string> = {
  idle: "var(--text-muted)",
  running: "var(--accent)",
  success: "var(--success)",
  error: "var(--danger)",
};

export function StatusDot({ state }: { state: State }) {
  return (
    <span
      class="status-dot"
      data-state={state}
      aria-hidden="true"
      style={`display:inline-block;width:8px;height:8px;border-radius:50%;background:${COLOR[state]};vertical-align:middle;`}
    />
  );
}
