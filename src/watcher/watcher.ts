import chokidar, { type FSWatcher } from 'chokidar';
import { EventEmitter } from 'node:events';
import { extname } from 'node:path';
import { supportedExtensions } from '../parser/grammars.js';

export type WatcherOptions = {
  debounceMs?: number;
};

export type WatcherEvent = 'change' | 'add' | 'unlink' | 'error';

export class Watcher extends EventEmitter {
  private fsWatcher: FSWatcher | null = null;
  private debounceMs: number;
  private pending = new Map<string, ReturnType<typeof setTimeout>>();
  private supportedExts: Set<string>;

  constructor(opts: WatcherOptions = {}) {
    super();
    this.debounceMs = opts.debounceMs ?? 300;
    this.supportedExts = new Set(supportedExtensions());
  }

  async watch(directory: string): Promise<void> {
    return new Promise((resolve) => {
      this.fsWatcher = chokidar.watch(directory, {
        ignored: /(^|[/\\])\..|(node_modules|dist|build)/,
        persistent: true,
        ignoreInitial: true,
        usePolling: false,
        awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
      });

      this.fsWatcher.on('ready', () => resolve());

      for (const event of ['add', 'change', 'unlink'] as const) {
        this.fsWatcher.on(event, (path: string) => {
          if (!this.supportedExts.has(extname(path))) return;
          this.debounce(event, path);
        });
      }

      this.fsWatcher.on('error', (err: unknown) => this.emit('error', err));
    });
  }

  private debounce(event: string, path: string): void {
    const key = `${event}:${path}`;
    const existing = this.pending.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.emit(event, path);
    }, this.debounceMs);
    this.pending.set(key, timer);
  }

  async close(): Promise<void> {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
    if (this.fsWatcher) {
      await this.fsWatcher.close();
      this.fsWatcher = null;
    }
  }
}
