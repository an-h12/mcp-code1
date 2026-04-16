import { describe, it, expect, beforeEach } from 'vitest';
import { openDb } from '../src/db/index.js';
import type { Db } from '../src/db/index.js';

describe('RepoRegistry', () => {
  let db: Db;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  it('registers a new repo', async () => {
    const { RepoRegistry } = await import('../src/registry.js');
    const registry = new RepoRegistry(db);
    const repo = registry.register({ name: 'my-app', rootPath: '/home/user/my-app' });
    expect(repo.id).toBeTruthy();
    expect(repo.name).toBe('my-app');
    expect(repo.rootPath).toBe('/home/user/my-app');
  });

  it('lists all repos', async () => {
    const { RepoRegistry } = await import('../src/registry.js');
    const registry = new RepoRegistry(db);
    registry.register({ name: 'a', rootPath: '/a' });
    registry.register({ name: 'b', rootPath: '/b' });
    const all = registry.list();
    expect(all).toHaveLength(2);
  });

  it('throws REPO_ALREADY_EXISTS on duplicate name', async () => {
    const { RepoRegistry } = await import('../src/registry.js');
    const { AppError, ErrorCode } = await import('../src/errors.js');
    const registry = new RepoRegistry(db);
    registry.register({ name: 'dup', rootPath: '/dup' });
    expect(() => registry.register({ name: 'dup', rootPath: '/dup2' })).toThrow(AppError);
    try {
      registry.register({ name: 'dup', rootPath: '/dup3' });
    } catch (e) {
      expect((e as InstanceType<typeof AppError>).code).toBe(ErrorCode.REPO_ALREADY_EXISTS);
    }
  });

  it('gets a repo by id', async () => {
    const { RepoRegistry } = await import('../src/registry.js');
    const registry = new RepoRegistry(db);
    const created = registry.register({ name: 'find-me', rootPath: '/find' });
    const found = registry.getById(created.id);
    expect(found?.name).toBe('find-me');
  });

  it('removes a repo', async () => {
    const { RepoRegistry } = await import('../src/registry.js');
    const registry = new RepoRegistry(db);
    const r = registry.register({ name: 'rm-me', rootPath: '/rm' });
    registry.remove(r.id);
    expect(registry.getById(r.id)).toBeUndefined();
  });
});
