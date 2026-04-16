import type { Indexer, IndexRepoResult } from '../../indexer/indexer.js';
import type { RepoRegistry } from '../../registry.js';
import { AppError, ErrorCode } from '../../errors.js';

export async function indexRepo(
  registry: RepoRegistry,
  indexer: Indexer,
  repoId: string,
): Promise<IndexRepoResult> {
  const repo = registry.getById(repoId);
  if (!repo) throw new AppError(ErrorCode.REPO_NOT_FOUND, `Repo ${repoId} not found`);
  const result = await indexer.indexRepo(repoId, repo.rootPath);
  registry.update(repoId, {
    indexedAt: new Date().toISOString(),
    fileCount: result.filesIndexed + result.filesSkipped,
    symbolCount: result.symbolsAdded,
  });
  return result;
}
