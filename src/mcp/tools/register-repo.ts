import { existsSync } from 'node:fs';
import type { RepoRegistry, Repo } from '../../registry.js';
import { AppError, ErrorCode } from '../../errors.js';

export type RegisterRepoParams = {
  name: string;
  rootPath: string;
  language?: string;
};

export function registerRepo(registry: RepoRegistry, params: RegisterRepoParams): Repo {
  if (!existsSync(params.rootPath)) {
    throw new AppError(
      ErrorCode.REPO_INVALID_PATH,
      `Path does not exist: ${params.rootPath}`,
    );
  }
  return registry.register(params);
}
