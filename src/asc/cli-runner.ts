const MAX_STDERR = 2 * 1024;

export interface AscCliRunnerOpts {
  binary: string;
  credentials: { issuerId: string; keyId: string; privateKeyPath: string };
  timeoutMs?: number;
}

export class AscCliRunnerError extends Error {
  constructor(message: string, public readonly stderrTail: string) {
    super(message);
    this.name = "AscCliRunnerError";
  }
}

export class AscCliRunner {
  private opts: Required<AscCliRunnerOpts>;

  constructor(opts: AscCliRunnerOpts) {
    this.opts = { timeoutMs: 60_000, ...opts };
  }

  async runJson<T>(args: string[]): Promise<T> {
    const proc = Bun.spawn([this.opts.binary, ...args, "--output", "json"], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ASC_ISSUER_ID: this.opts.credentials.issuerId,
        ASC_KEY_ID: this.opts.credentials.keyId,
        ASC_PRIVATE_KEY_PATH: this.opts.credentials.privateKeyPath,
        ASC_BYPASS_KEYCHAIN: "1",
      } as Record<string, string>,
    });

    // The spawned `asc` process can hang indefinitely (e.g. an interactive Keychain
    // prompt with no TTY to answer it) — this race + kill() is the only thing standing
    // between that and a wedged server process.
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => {
        try { proc.kill(); } catch {}
        reject(new AscCliRunnerError(`asc ${args.join(" ")} timed out after ${this.opts.timeoutMs}ms`, ""));
      }, this.opts.timeoutMs),
    );

    const run = (async (): Promise<T> => {
      const [stdout, stderr, exitCode] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
        proc.exited,
      ]);
      if (exitCode !== 0) {
        throw new AscCliRunnerError(
          `asc ${args.join(" ")} exited with code ${exitCode}`,
          stderr.slice(-MAX_STDERR),
        );
      }
      try {
        return JSON.parse(stdout) as T;
      } catch (err) {
        throw new AscCliRunnerError(
          `asc ${args.join(" ")} produced non-JSON output: ${String(err)}`,
          stdout.slice(-MAX_STDERR),
        );
      }
    })();

    return Promise.race([run, timeout]);
  }
}
