import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { tmpdir } from "os";
import { join } from "path";
import { existsSync, rmSync, writeFileSync } from "fs";
import { acquire, readLock, isLocked, LockBusyError } from "../../src/asc/lock";

let path: string;

beforeEach(() => {
  path = join(tmpdir(), `asc-lock-${Date.now()}-${Math.random().toString(36).slice(2)}.lock`);
});
afterEach(() => {
  if (existsSync(path)) rmSync(path);
});

describe("lock.acquire", () => {
  test("creates the lock file and returns info matching this process", () => {
    const { release, info } = acquire(path);
    try {
      expect(info.pid).toBe(process.pid);
      expect(existsSync(path)).toBe(true);
      const onDisk = readLock(path);
      expect(onDisk?.pid).toBe(process.pid);
    } finally {
      release();
    }
  });

  test("release() removes the lock file", () => {
    const { release } = acquire(path);
    release();
    expect(existsSync(path)).toBe(false);
  });

  test("release() is idempotent", () => {
    const { release } = acquire(path);
    release();
    expect(() => release()).not.toThrow();
  });

  test("throws LockBusyError when a live PID already holds the lock", () => {
    writeFileSync(path, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    expect(() => acquire(path)).toThrow(LockBusyError);
  });

  test("overwrites a stale lock (dead PID)", () => {
    writeFileSync(path, JSON.stringify({ pid: 99999999, startedAt: new Date().toISOString() }));
    const { release, info } = acquire(path);
    try {
      expect(info.pid).toBe(process.pid);
    } finally {
      release();
    }
  });

  test("treats a malformed lock file as stale", () => {
    writeFileSync(path, "not json");
    const { release } = acquire(path);
    try {
      expect(existsSync(path)).toBe(true);
      const fresh = readLock(path);
      expect(fresh?.pid).toBe(process.pid);
    } finally {
      release();
    }
  });
});

describe("isLocked", () => {
  test("returns false when no lock file exists", () => {
    expect(isLocked(path)).toBe(false);
  });
  test("returns true when a live process holds the lock", () => {
    const { release } = acquire(path);
    try {
      expect(isLocked(path)).toBe(true);
    } finally {
      release();
    }
  });
  test("returns false for stale lock files", () => {
    writeFileSync(path, JSON.stringify({ pid: 99999999, startedAt: new Date().toISOString() }));
    expect(isLocked(path)).toBe(false);
  });
});
