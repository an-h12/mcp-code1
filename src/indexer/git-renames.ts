import { execSync } from 'node:child_process';
import type { Db } from '../db/index.js';

export type RenamePair = { from: string; to: string };

export function parseGitRenames(gitOutput: string): RenamePair[] {
  const renames: RenamePair[] = [];
  for (const line of gitOutput.split('\n')) {
    const parts = line.split('\t');
    if (parts.length === 3 && parts[0]?.startsWith('R')) {
      const from = parts[1];
      const to = parts[2];
      if (from && to) renames.push({ from, to });
    }
  }
  return renames;
}

export function detectAndApplyRenames(
  db: Db,
  repoId: string,
  repoRoot: string,
  fromRef = 'HEAD~1',
  toRef = 'HEAD',
): RenamePair[] {
  let output: string;
  try {
    output = execSync(`git diff --name-status -M ${fromRef} ${toRef}`, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10_000,
    });
  } catch {
    return [];
  }

  const renames = parseGitRenames(output);
  if (renames.length === 0) return [];

  const applyRenames = db.transaction(() => {
    for (const { from, to } of renames) {
      db.prepare(`UPDATE files SET rel_path = ? WHERE repo_id = ? AND rel_path = ?`).run(
        to,
        repoId,
        from,
      );
    }
  });
  applyRenames();

  return renames;
}
