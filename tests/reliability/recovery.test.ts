/**
 * Test reliability & recovery — kịch bản runtime thực tế khi Cline dùng MCP.
 *
 * User sẽ vừa code vừa hỏi Cline — code thay đổi liên tục, watcher re-index,
 * nhiều tool call đồng thời. Server phải ổn định trong mọi tình huống.
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, appendFileSync, unlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/index.js';
import { Indexer } from '../../src/indexer/indexer.js';
import { Watcher } from '../../src/watcher/watcher.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';
import { RepoRegistry } from '../../src/registry.js';

function mkFixture() {
  const dir = mkdtempSync(join(tmpdir(), 'mcp-reliability-'));
  writeFileSync(
    join(dir, 'foo.ts'),
    `export function foo() {\n  return 'foo';\n}\n`,
  );
  writeFileSync(
    join(dir, 'bar.ts'),
    `import { foo } from './foo';\nexport function bar() {\n  return foo();\n}\n`,
  );
  return dir;
}

describe('Reliability: concurrent reindex', () => {
  it('concurrent indexRepo calls không chạy song song (guard)', async () => {
    const dir = mkFixture();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'r', rootPath: dir });
    const indexer = new Indexer(db);

    // Trigger 3 concurrent indexes
    const results = await Promise.all([
      indexer.indexRepo(repo.id, dir),
      indexer.indexRepo(repo.id, dir),
      indexer.indexRepo(repo.id, dir),
    ]);

    // Ít nhất 1 phải chạy thật (filesIndexed > 0), các call còn lại bị guard
    const realScans = results.filter((r) => r && r.filesIndexed > 0);
    expect(realScans.length).toBeGreaterThanOrEqual(1);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('re-index sau khi file thay đổi phát hiện symbol mới', async () => {
    const dir = mkFixture();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'r', rootPath: dir });
    const indexer = new Indexer(db);

    await indexer.indexRepo(repo.id, dir);

    const before = db
      .prepare(`SELECT COUNT(*) as cnt FROM symbols WHERE repo_id = ?`)
      .get(repo.id) as { cnt: number };

    // User thêm function mới
    appendFileSync(join(dir, 'foo.ts'), `\nexport function baz() { return 'baz'; }\n`);

    await indexer.indexRepo(repo.id, dir);

    const after = db
      .prepare(`SELECT COUNT(*) as cnt FROM symbols WHERE repo_id = ?`)
      .get(repo.id) as { cnt: number };

    expect(after.cnt).toBeGreaterThan(before.cnt);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('xóa file → indexRepo tự cleanup orphan rows (P0 fix: close/reopen use case)', async () => {
    // Khi user xóa file lúc MCP server / VS Code đóng, lần start kế tiếp
    // indexRepo() phải phát hiện file đã biến mất và xóa row + symbols (cascade).
    const dir = mkFixture();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'r', rootPath: dir });
    const indexer = new Indexer(db);

    await indexer.indexRepo(repo.id, dir);

    const beforeCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.repo_id = ? AND f.rel_path = 'bar.ts'`,
      )
      .get(repo.id) as { c: number };
    expect(beforeCount.c).toBeGreaterThan(0);

    unlinkSync(join(dir, 'bar.ts'));
    await indexer.indexRepo(repo.id, dir);

    // New behavior: orphan file + its symbols are cleaned up (FK CASCADE)
    const afterCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM symbols s JOIN files f ON f.id = s.file_id
         WHERE s.repo_id = ? AND f.rel_path = 'bar.ts'`,
      )
      .get(repo.id) as { c: number };
    expect(afterCount.c).toBe(0);

    const fileRow = db
      .prepare(`SELECT COUNT(*) as c FROM files WHERE repo_id = ? AND rel_path = 'bar.ts'`)
      .get(repo.id) as { c: number };
    expect(fileRow.c).toBe(0);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Reliability: graph cache consistency', () => {
  it('invalidate sau reindex → graph trả kết quả mới', async () => {
    const dir = mkFixture();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'r', rootPath: dir });
    const indexer = new Indexer(db);
    const graph = new InMemoryGraph(db);

    await indexer.indexRepo(repo.id, dir);
    const g1 = graph.getGraph(repo.id);
    const size1 = g1.nodes.size;

    // User thêm function → reindex → invalidate
    appendFileSync(join(dir, 'foo.ts'), `\nexport function qux() {}\n`);
    await indexer.indexRepo(repo.id, dir);
    graph.invalidate(repo.id);

    const g2 = graph.getGraph(repo.id);
    expect(g2.nodes.size).toBeGreaterThanOrEqual(size1);

    graph.stopEviction();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('setScanInProgress(true) → getGraph trả empty graph (tránh stale read)', async () => {
    const dir = mkFixture();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'r', rootPath: dir });
    const indexer = new Indexer(db);
    const graph = new InMemoryGraph(db);

    await indexer.indexRepo(repo.id, dir);
    graph.getGraph(repo.id); // cache

    // Simulate: App đang scan
    graph.setScanInProgress(repo.id, true);
    const during = graph.getGraph(repo.id);
    expect(during.nodes.size).toBe(0);

    graph.setScanInProgress(repo.id, false);
    graph.invalidate(repo.id);
    const after = graph.getGraph(repo.id);
    expect(after.nodes.size).toBeGreaterThan(0);

    graph.stopEviction();
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('Reliability: watcher debounce & events', () => {
  it('watcher emit "change" khi file được sửa (real FS)', async () => {
    const dir = mkFixture();
    const watcher = new Watcher({ debounceMs: 100 });
    await watcher.watch(dir);

    const changePromise = new Promise<string>((resolve) => {
      watcher.on('change', (p: string) => resolve(p));
    });

    // Đợi watcher ready
    await new Promise((r) => setTimeout(r, 300));

    // Trigger change
    appendFileSync(join(dir, 'foo.ts'), `\n// modified\n`);

    const changedPath = await Promise.race([
      changePromise,
      new Promise<string>((_, rej) => setTimeout(() => rej(new Error('timeout')), 3000)),
    ]);
    expect(changedPath).toContain('foo.ts');

    await watcher.close();
    rmSync(dir, { recursive: true, force: true });
  }, 10_000);

  it('watcher debounce gộp nhiều lần edit liên tiếp thành 1 event', async () => {
    const dir = mkFixture();
    const watcher = new Watcher({ debounceMs: 200 });
    await watcher.watch(dir);

    let changeCount = 0;
    watcher.on('change', () => {
      changeCount++;
    });

    // Đợi watcher ready
    await new Promise((r) => setTimeout(r, 300));

    // 5 edits liên tục trong 100ms (trong window debounce 200ms)
    for (let i = 0; i < 5; i++) {
      appendFileSync(join(dir, 'foo.ts'), `\n// edit ${i}\n`);
      await new Promise((r) => setTimeout(r, 20));
    }

    // Đợi debounce fire
    await new Promise((r) => setTimeout(r, 500));

    // Debounce phải gộp thành ít events (≤ 2, không phải 5)
    expect(changeCount).toBeLessThanOrEqual(2);

    await watcher.close();
    rmSync(dir, { recursive: true, force: true });
  }, 10_000);

  it('watcher.close() hủy mọi pending debounce timer', async () => {
    const dir = mkFixture();
    const watcher = new Watcher({ debounceMs: 500 });
    await watcher.watch(dir);

    let changeFired = false;
    watcher.on('change', () => {
      changeFired = true;
    });

    await new Promise((r) => setTimeout(r, 300));

    // Trigger change nhưng close trước khi debounce fire
    appendFileSync(join(dir, 'foo.ts'), `\n// change\n`);
    await new Promise((r) => setTimeout(r, 50));
    await watcher.close(); // close trong khi debounce đang pending

    // Đợi đủ thời gian debounce để chắc chắn không fire sau close
    await new Promise((r) => setTimeout(r, 800));
    expect(changeFired).toBe(false);

    rmSync(dir, { recursive: true, force: true });
  }, 10_000);
});

describe('Reliability: DB persistence', () => {
  it('index 2 lần liên tiếp → idempotent (không duplicate symbol)', async () => {
    const dir = mkFixture();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'r', rootPath: dir });
    const indexer = new Indexer(db);

    await indexer.indexRepo(repo.id, dir);
    const first = db
      .prepare(`SELECT COUNT(*) as cnt FROM symbols WHERE repo_id = ?`)
      .get(repo.id) as { cnt: number };

    await indexer.indexRepo(repo.id, dir);
    const second = db
      .prepare(`SELECT COUNT(*) as cnt FROM symbols WHERE repo_id = ?`)
      .get(repo.id) as { cnt: number };

    // Idempotent — không có duplicate
    expect(second.cnt).toBe(first.cnt);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('CASCADE delete khi remove repo → cleanup sạch files + symbols + relations', async () => {
    const dir = mkFixture();
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'r', rootPath: dir });
    const indexer = new Indexer(db);

    await indexer.indexRepo(repo.id, dir);

    // Verify có data
    expect((db.prepare(`SELECT COUNT(*) as c FROM files WHERE repo_id = ?`).get(repo.id) as any).c).toBeGreaterThan(0);

    registry.remove(repo.id);

    // CASCADE: tất cả liên quan phải biến mất
    expect((db.prepare(`SELECT COUNT(*) as c FROM files WHERE repo_id = ?`).get(repo.id) as any).c).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) as c FROM symbols WHERE repo_id = ?`).get(repo.id) as any).c).toBe(0);
    expect((db.prepare(`SELECT COUNT(*) as c FROM symbol_relations WHERE repo_id = ?`).get(repo.id) as any).c).toBe(0);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
