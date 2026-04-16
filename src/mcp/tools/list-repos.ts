import type { RepoRegistry, Repo } from '../../registry.js';

export function listRepos(registry: RepoRegistry): Repo[] {
  return registry.list();
}
