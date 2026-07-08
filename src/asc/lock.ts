import { mkdirSync, readFileSync, writeFileSync, unlinkSync, existsSync } from "fs";
import { dirname } from "path";

export interface LockInfo {
  pid: number;
  startedAt: string;
}

export class LockBusyError extends Error {
  constructor(public readonly current: LockInfo) {
    super(`asc sync already running (pid ${current.pid}, started ${current.startedAt})`);
    this.name = "LockBusyError";
  }
}

function isPidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    return e.code === "EPERM";
  }
}

/**
 * Acquire an exclusive lock at `path`. Throws LockBusyError if another live process holds it.
 * A stale lock (PID dead) is silently overwritten. Caller must call release() on clean exit.
 */
export function acquire(path: string): { release: () => void; info: LockInfo } {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const existing = readLock(path);
    if (existing && isPidAlive(existing.pid)) {
      throw new LockBusyError(existing);
    }
  }
  const info: LockInfo = { pid: process.pid, startedAt: new Date().toISOString() };
  writeFileSync(path, JSON.stringify(info), { flag: "w" });
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    try {
      const current = readLock(path);
      if (current && current.pid === process.pid) unlinkSync(path);
    } catch {
      // best-effort
    }
  };
  return { release, info };
}

export function readLock(path: string): LockInfo | null {
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    const obj = JSON.parse(text) as Partial<LockInfo>;
    if (typeof obj.pid !== "number" || typeof obj.startedAt !== "string") return null;
    return { pid: obj.pid, startedAt: obj.startedAt };
  } catch {
    return null;
  }
}

/** True if a *live* lock is currently held (returns false for stale-PID locks). */
export function isLocked(path: string): boolean {
  const info = readLock(path);
  return info !== null && isPidAlive(info.pid);
}

export { isPidAlive };
