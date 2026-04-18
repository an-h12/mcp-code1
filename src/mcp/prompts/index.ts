import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { McpServerOptions } from '../server.js';

export function registerPrompts(server: McpServer, opts: McpServerOptions): void {
  // Prompt 1: Analyze symbol impact
  server.prompt(
    'code_analyze_symbol_impact',
    { symbol_name: z.string().min(1).describe('Name of the symbol to analyze') },
    ({ symbol_name }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Analyze the blast radius of changing the symbol \`${symbol_name}\`:

1. Call \`code_get_impact_analysis\` with symbol_name="${symbol_name}"
2. Report the risk level (LOW/MEDIUM/HIGH) and explain what it means
3. List the d=1 "direct" symbols that WILL BREAK if \`${symbol_name}\` changes — these must be updated
4. List the d=2 "indirect" symbols that are LIKELY AFFECTED and should be tested
5. Suggest specific safe refactoring steps based on the blast radius size`,
          },
        },
      ],
    }),
  );

  // Prompt 2: Onboard a new repository
  server.prompt(
    'code_onboard_repo',
    {
      name: z.string().min(1).describe('Human-readable name for the repository'),
      root_path: z.string().min(1).describe('Absolute path to the repository root directory'),
      language: z.string().optional().describe('Primary language hint (e.g. typescript, python)'),
    },
    ({ name, root_path, language }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Onboard the repository at \`${root_path}\`:

1. Call \`code_register_repo\` with name="${name}", root_path="${root_path}"${language ? `, language="${language}"` : ''}
   — save the returned repo_id for subsequent calls
2. Call \`code_index_repo\` with the returned repo_id (this may take a moment for large repos)
3. Call \`code_get_repo_stats\` with the repo_id
4. Present a summary showing:
   - Total files indexed
   - Symbol count
   - Language breakdown
   - Any warnings from the indexing process`,
          },
        },
      ],
    }),
  );

  // Prompt 3: Explain codebase architecture (repo_id embedded at registration time)
  const repoId = opts.repoId;

  server.prompt(
    'code_explain_codebase',
    {},
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: `Provide an architecture overview of the indexed codebase (repo: ${repoId}):

1. Call \`code_get_repo_stats\` with repo_id="${repoId}" to get file count, symbol count, and language breakdown
2. Call \`code_search_symbols\` with query="class", repo_id="${repoId}", limit=20 to find top-level classes
3. Call \`code_search_symbols\` with query="service", repo_id="${repoId}", limit=20 to find service layers
4. Call \`code_search_symbols\` with query="handler", repo_id="${repoId}", limit=20 to find request handlers
5. Call \`code_search_files\` with query="index", repo_id="${repoId}", limit=10 to find entry points
6. Synthesize a markdown architecture overview covering:
   - Tech stack and languages
   - Main modules/layers discovered
   - Key entry points
   - Notable patterns observed`,
          },
        },
      ],
    }),
  );
}
