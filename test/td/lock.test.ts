import { describe, it, expect } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, writeFileSync, unlinkSync } from "fs";
import { acquire, LockBusyError, readLock, isLocked } from "../../src/td/lock";

function tmpLock() {
  return join(tmpdir(), `td-lock-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`);
}

describe("td lock", () => {
  it("acquire writes a JSON file with current pid", () => {
    const p = tmpLock();
    const lk = acquire(p);
    expect(existsSync(p)).toBe(true);
    const info = readLock(p);
    expect(info?.pid).toBe(process.pid);
    lk.release();
    expect(existsSync(p)).toBe(false);
  });

  it("throws LockBusyError when a live process holds the lock", () => {
    const p = tmpLock();
    const lk = acquire(p);
    try {
      acquire(p);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LockBusyError);
    }
    lk.release();
  });

  it("overwrites a stale lock whose PID is dead", () => {
    const p = tmpLock();
    writeFileSync(p, JSON.stringify({ pid: 2_147_483_640, startedAt: "2020-01-01T00:00:00Z" }));
    const lk = acquire(p);
    expect(readLock(p)?.pid).toBe(process.pid);
    lk.release();
  });

  it("isLocked returns false for stale lock files", () => {
    const p = tmpLock();
    writeFileSync(p, JSON.stringify({ pid: 2_147_483_640, startedAt: "x" }));
    expect(isLocked(p)).toBe(false);
    unlinkSync(p);
  });
});
