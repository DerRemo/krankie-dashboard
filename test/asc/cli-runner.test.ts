import { test, expect, beforeEach, afterEach } from "bun:test";
import { mockAscBin } from "../seed";
import { AscCliRunner, AscCliRunnerError } from "../../src/asc/cli-runner";

let runner: AscCliRunner;
beforeEach(() => {
  runner = new AscCliRunner({
    binary: mockAscBin(),
    credentials: { issuerId: "iss", keyId: "key", privateKeyPath: "/tmp/x.p8" },
    timeoutMs: 2000,
  });
});
afterEach(() => {
  delete process.env.ASC_MOCK_FAIL;
  delete process.env.ASC_MOCK_HANG;
  delete process.env.ASC_MOCK_BAD_JSON;
  delete process.env.ASC_MOCK_ECHO_ENV;
  delete process.env.ASC_MOCK_STDOUT;
});

test("runJson parses stdout as JSON", async () => {
  process.env.ASC_MOCK_STDOUT = JSON.stringify({ data: [{ id: "1" }] });
  const out = await runner.runJson<{ data: Array<{ id: string }> }>(["reviews", "--app", "111"]);
  expect(out.data[0]!.id).toBe("1");
});

test("runJson passes credentials as env vars + bypasses keychain", async () => {
  process.env.ASC_MOCK_ECHO_ENV = "1";
  const out = await runner.runJson<{ issuerId: string; keyId: string; privateKeyPath: string; bypassKeychain: string }>(["reviews"]);
  expect(out.issuerId).toBe("iss");
  expect(out.keyId).toBe("key");
  expect(out.privateKeyPath).toBe("/tmp/x.p8");
  expect(out.bypassKeychain).toBe("1");
});

test("runJson throws AscCliRunnerError with stderr tail on non-zero exit", async () => {
  process.env.ASC_MOCK_FAIL = "1";
  await expect(runner.runJson(["reviews"])).rejects.toBeInstanceOf(AscCliRunnerError);
  try {
    await runner.runJson(["reviews"]);
    throw new Error("expected rejection");
  } catch (err) {
    expect((err as AscCliRunnerError).stderrTail).toContain("boom");
  }
});

test("runJson throws on non-JSON stdout", async () => {
  process.env.ASC_MOCK_BAD_JSON = "1";
  await expect(runner.runJson(["reviews"])).rejects.toBeInstanceOf(AscCliRunnerError);
});

test("runJson times out a hanging process", async () => {
  process.env.ASC_MOCK_HANG = "1";
  const fast = new AscCliRunner({
    binary: mockAscBin(),
    credentials: { issuerId: "iss", keyId: "key", privateKeyPath: "/tmp/x.p8" },
    timeoutMs: 100,
  });
  await expect(fast.runJson(["reviews"])).rejects.toBeInstanceOf(AscCliRunnerError);
});
