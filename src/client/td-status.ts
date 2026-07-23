interface TdStatusResponse {
  latest: { status: string } | null;
}

export function initTdStatusPolling(intervalMs = 10_000): void {
  // Only poll when the TD sync card is on the page (TD configured + /system).
  const card = document.getElementById("td-sync-card");
  if (!card) return;

  // Track running state across ticks in a closure — the previous version read a
  // `.td-sync-card`/`.status-dot` pair that the unified SyncCard never renders,
  // so polling was dead. Seed from the server-rendered data-running attribute.
  let prevRunning = card.dataset.running === "true";

  async function tick() {
    try {
      const res = await fetch("/api/td/status", { cache: "no-store" });
      if (!res.ok) return;
      const json = (await res.json()) as TdStatusResponse;
      const running = json.latest?.status === "running";
      if (prevRunning && !running) {
        window.location.reload();
        return;
      }
      prevRunning = running;
    } catch {
      // Ignore network failures — next tick retries.
    }
  }

  setInterval(tick, intervalMs);
}
