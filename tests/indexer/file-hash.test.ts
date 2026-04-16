import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('hashFile', () => {
  it('returns same hash for same content', async () => {
    const { hashFile } = await import('../../src/indexer/file-hash.js');
    const dir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
    const file = join(dir, 'test.ts');
    writeFileSync(file, 'const x = 1;');
    const h1 = hashFile(file);
    const h2 = hashFile(file);
    expect(h1).toBe(h2);
    rmSync(dir, { recursive: true });
  });

  it('returns different hash for different content', async () => {
    const { hashFile } = await import('../../src/indexer/file-hash.js');
    const dir = mkdtempSync(join(tmpdir(), 'mcp-test-'));
    const f1 = join(dir, 'a.ts');
    const f2 = join(dir, 'b.ts');
    writeFileSync(f1, 'const x = 1;');
    writeFileSync(f2, 'const x = 2;');
    expect(hashFile(f1)).not.toBe(hashFile(f2));
    rmSync(dir, { recursive: true });
  });
});
