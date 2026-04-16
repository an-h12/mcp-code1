import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
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

export class RoslynBridge {
  private daemon: ChildProcess | null = null;
  private readonly TIMEOUT_MS = 30_000;
  private _cleanupRegistered = false;

  private ensureDaemon(): ChildProcess | null {
    if (this.daemon && !this.daemon.killed) return this.daemon;

    const binPath = getRoslynBinaryPath();
    if (!binPath) return null;

    this.daemon = spawn(binPath, [], { stdio: ['pipe', 'pipe', 'pipe'] });

    this.daemon.stderr?.on('data', (d: Buffer) => {
      process.stderr.write(`[RoslynBridge] ${d.toString()}`);
    });

    this.daemon.on('exit', (code: number | null) => {
      process.stderr.write(
        `[RoslynBridge] daemon exited code=${code} — will respawn on next request\n`,
      );
      this.daemon = null;
    });

    if (!this._cleanupRegistered) {
      this._cleanupRegistered = true;
      const cleanup = () => this.daemon?.kill();
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

  private sendRequest(daemon: ChildProcess, req: RoslynRequest): Promise<RoslynResponse> {
    return new Promise((resolve, reject) => {
      let buffer = '';

      const cleanup = () => {
        daemon.stdout!.off('data', onData);
        daemon.stdout!.off('error', onError);
        daemon.stdout!.off('close', onClose);
      };

      const onData = (chunk: Buffer) => {
        buffer += chunk.toString();
        const newlineIdx = buffer.indexOf('\n');
        if (newlineIdx === -1) return;
        const line = buffer.slice(0, newlineIdx);
        cleanup();
        try {
          resolve(JSON.parse(line) as RoslynResponse);
        } catch (e) {
          reject(
            new Error(`Roslyn response JSON parse failed: ${e}. Raw: ${line.slice(0, 200)}`),
          );
        }
      };

      const onError = (err: Error) => {
        cleanup();
        reject(err);
      };

      const onClose = () => {
        cleanup();
        reject(
          new Error(`Roslyn daemon stdout closed before response (partial: ${buffer.slice(0, 100)})`),
        );
      };

      daemon.stdout!.on('data', onData);
      daemon.stdout!.once('error', onError);
      daemon.stdout!.once('close', onClose);

      daemon.stdin!.write(JSON.stringify(req) + '\n');
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
      return null;
    });
  }

  close(): void {
    this.daemon?.kill();
    this.daemon = null;
  }
}
