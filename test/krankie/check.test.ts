import { test, expect, beforeEach } from "bun:test";
import { mockKrankieBin } from "../seed";
import { CheckRunner } from "../../src/krankie/check";

let runner: CheckRunner;
beforeEach(() => {
  runner = new CheckRunner({ binary: mockKrankieBin(), timeoutMs: 30_000 });
});

test("checkStatus parses krankie's --json output", async () => {
  const status = await runner.checkStatus();
  expect(status.running).toBe(false);
  expect(status.lastFinishedAt).toBe("2026-05-06T10:00:00Z");
});

test("triggerCheck spawns and resolves on exit", async () => {
  const { runId, startedAt } = await runner.triggerCheck();
  expect(runId).toMatch(/^run-/);
  expect(startedAt).toBeInstanceOf(Date);

  await runner.waitForIdle(2000);
  expect(runner.isRunning()).toBe(false);
});

test("triggerCheck enforces single-flight lock", async () => {
  await runner.triggerCheck();
  await expect(runner.triggerCheck()).rejects.toMatchObject({ code: "ALREADY_RUNNING" });
  await runner.waitForIdle(2000);
});

test("triggerCheck captures stderr on failure", async () => {
  process.env.KRANKIE_MOCK_FAIL = "1";
  await runner.triggerCheck();
  await runner.waitForIdle(2000);
  const status = runner.lastRun();
  expect(status?.exitCode).toBe(1);
  expect(status?.stderrTail).toContain("boom");
  delete process.env.KRANKIE_MOCK_FAIL;
});
