import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('Watcher', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
    dirs.length = 0;
  });

  it('emits change event when a file is written', async () => {
    const { Watcher } = await import('../../src/watcher/watcher.js');
    const dir = mkdtempSync(join(tmpdir(), 'mcp-watch-'));
    dirs.push(dir);
    const file = join(dir, 'test.ts');
    writeFileSync(file, 'const x = 1;');

    const watcher = new Watcher({ debounceMs: 50 });
    const seen: string[] = [];

    watcher.on('change', (path: string) => seen.push(path));
    await watcher.watch(dir);

    await new Promise((r) => setTimeout(r, 200));
    writeFileSync(file, 'const x = 2;');
    await new Promise((r) => setTimeout(r, 600));

    await watcher.close();
    expect(seen.some((p) => p.includes('test.ts'))).toBe(true);
  }, 5000);
});
