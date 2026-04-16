import { describe, it, expect } from 'vitest';

describe('parseGitRenames', () => {
  it('extracts rename pairs from git diff output', async () => {
    const { parseGitRenames } = await import('../../src/indexer/git-renames.js');
    const gitOutput = `
R100\tsrc/old-name.ts\tsrc/new-name.ts
M\tsrc/unchanged.ts
R075\tlib/foo.ts\tlib/bar.ts
`.trim();
    const renames = parseGitRenames(gitOutput);
    expect(renames).toHaveLength(2);
    expect(renames[0]).toEqual({ from: 'src/old-name.ts', to: 'src/new-name.ts' });
    expect(renames[1]).toEqual({ from: 'lib/foo.ts', to: 'lib/bar.ts' });
  });

  it('returns empty array when no renames', async () => {
    const { parseGitRenames } = await import('../../src/indexer/git-renames.js');
    expect(parseGitRenames('M\tsrc/foo.ts\nA\tsrc/bar.ts')).toEqual([]);
  });
});
