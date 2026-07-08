interface AscStatus {
  configured: boolean;
  running: boolean;
  currentRunId: number | null;
  lastRun: { id: number; status: string; finishedAt: string | null } | null;
  coverage: { salesBackfillPct: number; analyticsBackfillPct: number };
}

export function initAscSyncButton(): void {
  const btn = document.getElementById("asc-sync-now") as HTMLButtonElement | null;
  if (!btn) return;
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    btn.textContent = "Starting…";
    try {
      const res = await fetch("/api/asc/sync", { method: "POST" });
      if (res.status === 409) {
        btn.textContent = "Already running";
        startPolling(btn);
        return;
      }
      if (!res.ok) {
        btn.textContent = "Failed (see console)";
        console.error("ASC sync trigger failed:", await res.text());
        return;
      }
      btn.textContent = "Sync running…";
      startPolling(btn);
    } catch (err) {
      btn.textContent = "Error";
      console.error(err);
    }
  });

  // If page loads while a sync is already running, start polling immediately.
  fetch("/api/asc/status").then((r) => r.json()).then((s: AscStatus) => {
    if (s.running) {
      btn.disabled = true;
      btn.textContent = "Sync running…";
      startPolling(btn);
    }
  }).catch(() => {});
}

function startPolling(btn: HTMLButtonElement): void {
  const interval = setInterval(async () => {
    try {
      const r = await fetch("/api/asc/status");
      if (!r.ok) return;
      const s = await r.json() as AscStatus;
      if (!s.running) {
        clearInterval(interval);
        btn.disabled = false;
        btn.textContent = "Sync now";
        location.reload();
      }
    } catch {
      // network blips ignored
    }
  }, 5000);
}
