import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export type RoslynRequest = {
  action: 'analyze';
  files: string[];
  projectRoot: string;
  repoId: string;
};

// Wire format: each request carries a correlation id; the daemon must echo it
// back on the matching response line. New-format daemons include `id`; older
// daemons don't, in which case we fall back to FIFO ordering.
type RoslynWireRequest = RoslynRequest & { id: string };
type RoslynWireResponse = RoslynResponse & { id?: string };

export type RoslynSymbol = {
  name: string;
  kind: 'class' | 'method' | 'interface' | 'property' | 'field' | 'enum';
  filePath: string;
  line: number;
  column: number;
  partialClassGroup?: string;
};

export type RoslynRelation = {
  sourceFile: string;
  sourceName: string;
  targetName: string;
  targetFile: string | null;
  type: 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS';
  confidence: number;
};

export type PartialMerge = {
  className: string;
  files: string[];
  mergedSymbolId?: string;
};

export type RoslynResponse = {
  symbols: RoslynSymbol[];
  relations: RoslynRelation[];
  partialMerges: PartialMerge[];
  errors: string[];
};

function getRoslynBinaryPath(): string | null {
  const platform = process.platform;
  const arch = process.arch;
  const platformDir = platform === 'win32' ? 'win' : platform;
  const name = platform === 'win32' ? 'roslyn-analyzer.exe' : 'roslyn-analyzer';
  const p = path.join(__dirname, '..', '..', 'bin', 'roslyn', `${platformDir}-${arch}`, name);
  return existsSync(p) ? p : null;
}

type Pending = {
  resolve: (value: RoslynResponse) => void;
  reject: (err: Error) => void;
};

export class RoslynBridge {
  private daemon: ChildProcess | null = null;
  private readonly TIMEOUT_MS = 30_000;
  private _cleanupRegistered = false;

  /**
   * Outstanding requests keyed by correlation id. Each response line from the
   * daemon matches one entry here. FIFO fallback is used if the daemon doesn't
   * echo ids (older binary).
   */
  private pending = new Map<string, Pending>();
  private pendingOrder: string[] = []; // FIFO fallback
  private stdoutBuffer = '';

  private ensureDaemon(): ChildProcess | null {
    if (this.daemon && !this.daemon.killed) return this.daemon;

    const binPath = getRoslynBinaryPath();
    if (!binPath) return null;

    this.daemon = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.daemon.stderr?.on('data', (d: Buffer) => {
      process.stderr.write(`[RoslynBridge] ${d.toString()}`);
    });

    // Persistent line-oriented stdout reader. Dispatches each response to its
    // matching pending request by id (or FIFO as a fallback).
    this.daemon.stdout?.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString();
      let newlineIdx = this.stdoutBuffer.indexOf('\n');
      while (newlineIdx !== -1) {
        const line = this.stdoutBuffer.slice(0, newlineIdx);
        this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);
        this.dispatchResponseLine(line);
        newlineIdx = this.stdoutBuffer.indexOf('\n');
      }
    });

    this.daemon.stdout?.on('error', (err: Error) => {
      this.failAllPending(err);
    });

    this.daemon.on('exit', (code: number | null) => {
      process.stderr.write(
        `[RoslynBridge] daemon exited code=${code} — will respawn on next request\n`,
      );
      this.failAllPending(new Error(`Roslyn daemon exited code=${code}`));
      this.daemon = null;
      this.stdoutBuffer = '';
    });

    if (!this._cleanupRegistered) {
      this._cleanupRegistered = true;
      const cleanup = (): void => {
        this.daemon?.kill();
      };
      process.once('exit', cleanup);
      process.once('SIGTERM', () => {
        cleanup();
        process.exit(0);
      });
      process.once('SIGINT', () => {
        cleanup();
        process.exit(0);
      });
    }

    return this.daemon;
  }

  private dispatchResponseLine(line: string): void {
    if (!line) return;
    let parsed: RoslynWireResponse;
    try {
      parsed = JSON.parse(line) as RoslynWireResponse;
    } catch (e) {
      const err = new Error(
        `Roslyn response JSON parse failed: ${e}. Raw: ${line.slice(0, 200)}`,
      );
      // We don't know which pending request this belongs to — fail the oldest.
      this.failOldest(err);
      return;
    }

    let target: Pending | undefined;
    if (parsed.id && this.pending.has(parsed.id)) {
      target = this.pending.get(parsed.id);
      this.pending.delete(parsed.id);
      this.pendingOrder = this.pendingOrder.filter((x) => x !== parsed.id);
    } else {
      // FIFO fallback for legacy daemons that don't echo ids.
      const oldestId = this.pendingOrder.shift();
      if (oldestId) {
        target = this.pending.get(oldestId);
        this.pending.delete(oldestId);
      }
    }

    target?.resolve(parsed);
  }

  private failOldest(err: Error): void {
    const oldestId = this.pendingOrder.shift();
    if (!oldestId) return;
    const p = this.pending.get(oldestId);
    this.pending.delete(oldestId);
    p?.reject(err);
  }

  private failAllPending(err: Error): void {
    for (const id of this.pendingOrder) {
      this.pending.get(id)?.reject(err);
    }
    this.pending.clear();
    this.pendingOrder = [];
  }

  private sendRequest(daemon: ChildProcess, req: RoslynRequest): Promise<RoslynResponse> {
    return new Promise((resolve, reject) => {
      const id = randomUUID();
      const wire: RoslynWireRequest = { ...req, id };
      this.pending.set(id, { resolve, reject });
      this.pendingOrder.push(id);

      const onStdinError = (err: Error): void => {
        this.pending.delete(id);
        this.pendingOrder = this.pendingOrder.filter((x) => x !== id);
        reject(err);
      };

      daemon.stdin!.once('error', onStdinError);
      const ok = daemon.stdin!.write(JSON.stringify(wire) + '\n', (err) => {
        daemon.stdin!.off('error', onStdinError);
        if (err) {
          this.pending.delete(id);
          this.pendingOrder = this.pendingOrder.filter((x) => x !== id);
          reject(err);
        }
      });
      if (!ok) {
        // Backpressure: wait for drain. The drain listener is a no-op here;
        // stdin 'error' or write callback covers failure modes.
        daemon.stdin!.once('drain', () => {
          // noop
        });
      }
    });
  }

  async analyze(req: RoslynRequest): Promise<RoslynResponse | null> {
    const daemon = this.ensureDaemon();
    if (!daemon) return null;

    return Promise.race([
      this.sendRequest(daemon, req),
      new Promise<null>((_, reject) =>
        setTimeout(() => reject(new Error('Roslyn timeout')), this.TIMEOUT_MS),
      ),
    ]).catch((err) => {
      process.stderr.write(`[RoslynBridge] analysis failed: ${err} — falling back to Tier 1\n`);
      this.daemon?.kill();
      this.daemon = null;
      this.failAllPending(err instanceof Error ? err : new Error(String(err)));
      return null;
    });
  }

  close(): void {
    this.daemon?.kill();
    this.daemon = null;
    this.failAllPending(new Error('Roslyn bridge closed'));
  }
}
