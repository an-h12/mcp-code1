import type { RepoRegistry } from '../../registry.js';
import { AppError, ErrorCode } from '../../errors.js';

export function removeRepo(registry: RepoRegistry, repoId: string): void {
  const repo = registry.getById(repoId);
  if (!repo) throw new AppError(ErrorCode.REPO_NOT_FOUND, `Repo ${repoId} not found`);
  registry.remove(repoId);
}
