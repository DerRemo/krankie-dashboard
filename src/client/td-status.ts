interface TdStatusResponse {
  latest: { status: string } | null;
}

export function initTdStatusPolling(intervalMs = 10_000): void {
  const card = document.querySelector<HTMLElement>(".td-sync-card");
  if (!card) return;

  async function tick() {
    try {
      const res = await fetch("/api/td/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as TdStatusResponse;
      const dot = card!.querySelector<HTMLElement>(".status-dot");
      // data-state is set by StatusDot component
      const wasRunning = dot?.dataset.state === "running";
      const status = json.latest?.status;
      if (wasRunning && status && status !== "running") {
        window.location.reload();
      }
    } catch {
      // Ignore network failures
    }
  }

  setInterval(tick, intervalMs);
}
