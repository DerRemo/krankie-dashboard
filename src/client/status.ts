import { showToast } from "./toast";

type State = "idle" | "running" | "success" | "error";

interface Status {
  running: boolean;
  progress?: { done: number; total: number };
  lastFinishedAt?: string;
  exitCode?: number;
}

export function initStatus(): void {
  const capsule = document.getElementById("check-status");
  const sysTrigger = document.getElementById("system-run-check") as HTMLButtonElement | null;
  if (!capsule) return;

  const onClick = async () => {
    setState(capsule, "running", "starting…");
    if (sysTrigger) sysTrigger.disabled = true;
    try {
      const res = await fetch("/api/check/run", { method: "POST" });
      if (res.status === 409) {
        showToast("a check is already running", "info");
        poll(capsule, sysTrigger);
        return;
      }
      if (!res.ok) throw new Error(await res.text());
      poll(capsule, sysTrigger);
    } catch (err) {
      setState(capsule, "error", "failed");
      if (sysTrigger) sysTrigger.disabled = false;
      showToast(`check failed to start: ${err}`, "error");
    }
  };

  sysTrigger?.addEventListener("click", onClick);

  // On page load: if a check is already running on the server, start polling.
  fetch("/api/check/status")
    .then((r) => r.json() as Promise<Status>)
    .then((s) => {
      if (s.running) {
        if (sysTrigger) sysTrigger.disabled = true;
        poll(capsule, sysTrigger);
      }
    })
    .catch(() => {});
}

function setState(el: HTMLElement, state: State, label: string) {
  el.dataset.state = state;
  const dot = el.querySelector(".status-dot") as HTMLElement | null;
  if (dot) dot.dataset.state = state;
  const text = el.querySelector(".status-label") as HTMLElement | null;
  if (text) text.textContent = label;
}

function poll(capsule: HTMLElement, trigger: HTMLButtonElement | null): void {
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const res = await fetch("/api/check/status");
      const s = (await res.json()) as Status;
      if (s.running) {
        const label = s.progress ? `running (${s.progress.done}/${s.progress.total})` : "running…";
        setState(capsule, "running", label);
        setTimeout(tick, 2000);
        return;
      }
      stopped = true;
      if (s.exitCode === 0) {
        setState(capsule, "success", "done");
        setTimeout(() => location.reload(), 3000);
      } else {
        setState(capsule, "error", "failed");
        if (trigger) trigger.disabled = false;
        showToast("check failed — see /system for details", "error");
      }
    } catch {
      setTimeout(tick, 4000);
    }
  };
  tick();
}
