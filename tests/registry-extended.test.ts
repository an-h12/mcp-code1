/**
 * Bổ sung test cho RepoRegistry — các method chưa được test:
 * getByName(), update()
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDb } from '../src/db/index.js';
import { RepoRegistry } from '../src/registry.js';

type Db = ReturnType<typeof openDb>;

describe('RepoRegistry — bổ sung', () => {
  let db: Db;
  let registry: RepoRegistry;

  beforeEach(() => {
    db = openDb(':memory:');
    registry = new RepoRegistry(db);
  });

  afterEach(() => db.close());

  it('getByName tìm được repo đã đăng ký', () => {
    registry.register({ name: 'my-project', rootPath: '/code/my-project' });
    const repo = registry.getByName('my-project');
    expect(repo).toBeDefined();
    expect(repo!.name).toBe('my-project');
    expect(repo!.rootPath).toBe('/code/my-project');
  });

  it('getByName trả về undefined cho tên không tồn tại', () => {
    expect(registry.getByName('nonexistent')).toBeUndefined();
  });

  it('update cập nhật indexedAt', () => {
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    const now = new Date().toISOString();
    registry.update(repo.id, { indexedAt: now });
    const updated = registry.getById(repo.id);
    expect(updated!.indexedAt).toBe(now);
  });

  it('update cập nhật fileCount và symbolCount', () => {
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    registry.update(repo.id, { fileCount: 42, symbolCount: 200 });
    const updated = registry.getById(repo.id);
    expect(updated!.fileCount).toBe(42);
    expect(updated!.symbolCount).toBe(200);
  });

  it('update cập nhật language', () => {
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    registry.update(repo.id, { language: 'typescript' });
    const updated = registry.getById(repo.id);
    expect(updated!.language).toBe('typescript');
  });

  it('update partial — chỉ cập nhật field được truyền vào', () => {
    const repo = registry.register({ name: 'r', rootPath: '/r' });
    registry.update(repo.id, { fileCount: 10 });
    const updated = registry.getById(repo.id);
    expect(updated!.fileCount).toBe(10);
    expect(updated!.symbolCount).toBe(0); // không thay đổi
    expect(updated!.language).toBe('');    // không thay đổi
  });
});
