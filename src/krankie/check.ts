import { logger } from "../logger";

export interface CheckRunnerOpts {
  binary: string;
  timeoutMs?: number;
}

export interface LiveStatus {
  running: boolean;
  progress?: { done: number; total: number };
  lastFinishedAt?: string;
  exitCode?: number;
}

export interface LastRun {
  runId: string;
  startedAt: Date;
  finishedAt: Date;
  exitCode: number;
  stderrTail: string;
}

const MAX_STDERR = 2 * 1024;

export class CheckRunner {
  private opts: Required<CheckRunnerOpts>;
  private active: { runId: string; startedAt: Date; promise: Promise<void> } | null = null;
  private last: LastRun | null = null;

  constructor(opts: CheckRunnerOpts) {
    this.opts = { timeoutMs: 10 * 60 * 1000, ...opts };
  }

  isRunning(): boolean {
    return this.active !== null;
  }

  lastRun(): LastRun | null {
    return this.last;
  }

  async triggerCheck(): Promise<{ runId: string; startedAt: Date }> {
    if (this.active) {
      const err = Object.assign(new Error("a check is already running"), { code: "ALREADY_RUNNING" as const });
      throw err;
    }
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const startedAt = new Date();

    const proc = Bun.spawn([this.opts.binary, "check", "run"], {
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env } as Record<string, string>,
    });

    let stderrTail = "";
    const collector = (async () => {
      const reader = proc.stderr;
      if (reader instanceof ReadableStream) {
        const chunks: Uint8Array[] = [];
        let total = 0;
        const streamReader = reader.getReader();
        while (true) {
          const { value: chunk, done } = await streamReader.read();
          if (done) break;
          if (!chunk) continue;
          chunks.push(chunk);
          total += chunk.byteLength;
          if (total > MAX_STDERR * 2) {
            while (total > MAX_STDERR && chunks.length > 1) {
              total -= chunks[0]!.byteLength;
              chunks.shift();
            }
          }
        }
        stderrTail = new TextDecoder().decode(Buffer.concat(chunks.map((c) => Buffer.from(c)))).slice(-MAX_STDERR);
      }
    })();

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => {
        try { proc.kill(); } catch {}
        reject(Object.assign(new Error("check timed out"), { code: "TIMEOUT" as const }));
      }, this.opts.timeoutMs),
    );

    const promise = (async () => {
      try {
        const exitCode = await Promise.race([proc.exited, timeout]);
        await collector;
        this.last = { runId, startedAt, finishedAt: new Date(), exitCode, stderrTail };
        if (exitCode !== 0) {
          logger.warn({ runId, exitCode, stderrTail }, "krankie check failed");
        } else {
          logger.info({ runId, exitCode }, "krankie check completed");
        }
      } catch (err) {
        this.last = {
          runId,
          startedAt,
          finishedAt: new Date(),
          exitCode: -1,
          stderrTail: err instanceof Error ? err.message : String(err),
        };
      } finally {
        this.active = null;
      }
    })();

    this.active = { runId, startedAt, promise };
    return { runId, startedAt };
  }

  async waitForIdle(timeoutMs: number): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (this.active && Date.now() < deadline) {
      await this.active.promise.catch(() => {});
    }
  }

  async checkStatus(): Promise<LiveStatus> {
    if (this.active) {
      const fromCli = await this.spawnStatus();
      return { ...fromCli, running: true };
    }
    const fromCli = await this.spawnStatus();
    if (this.last && (!fromCli.lastFinishedAt || new Date(fromCli.lastFinishedAt) < this.last.finishedAt)) {
      return {
        running: false,
        lastFinishedAt: this.last.finishedAt.toISOString(),
        exitCode: this.last.exitCode,
      };
    }
    return fromCli;
  }

  private async spawnStatus(): Promise<LiveStatus> {
    const proc = Bun.spawn([this.opts.binary, "check", "status", "--json"], {
      stdout: "pipe",
      stderr: "ignore",
      env: { ...process.env } as Record<string, string>,
    });
    const text = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) {
      return { running: false };
    }
    try {
      const parsed = JSON.parse(text);
      return {
        running: Boolean(parsed.running),
        progress: parsed.progress,
        lastFinishedAt: parsed.lastFinishedAt,
        exitCode: parsed.exitCode,
      };
    } catch {
      return { running: false };
    }
  }
}
