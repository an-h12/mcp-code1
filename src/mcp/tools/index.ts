import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerOptions } from '../server.js';
import {
  SearchSymbolsSchema,
  GetSymbolDetailSchema,
  RegisterRepoSchema,
  IndexRepoSchema,
  FindReferencesSchema,
  SearchFilesSchema,
  GetFileSymbolsSchema,
  ExplainSymbolSchema,
  GetRepoStatsSchema,
  RemoveRepoSchema,
  GetSymbolContextSchema,
  GetImportChainSchema,
} from '../tool-schemas.js';
import { searchSymbols } from './search-symbols.js';
import { getSymbolDetail } from './get-symbol-detail.js';
import { listRepos } from './list-repos.js';
import { registerRepo } from './register-repo.js';
import { indexRepo } from './index-repo.js';
import { findReferences } from './find-references.js';
import { searchFiles } from './search-files.js';
import { getFileSymbols } from './get-file-symbols.js';
import { explainSymbol } from './explain-symbol.js';
import { getRepoStats } from './get-repo-stats.js';
import { removeRepo } from './remove-repo.js';
import { getSymbolContext } from './get-symbol-context.js';
import { getImportChain } from './get-import-chain.js';
import { createAiAdapter } from '../ai-adapter.js';
import { isAppError } from '../../errors.js';

function errText(e: unknown): string {
  return isAppError(e) ? `[${e.code}] ${e.message}` : String(e);
}

export function registerTools(server: McpServer, opts: McpServerOptions): void {
  const ai = opts.aiConfig ? createAiAdapter(opts.aiConfig) : null;

  // ── Read-only tools ──────────────────────────────────────────

  server.registerTool('search_symbols', {
    description:
      'Fuzzy/FTS5 search for symbols by keyword or partial name. Returns multiple ranked matches. Use when you do NOT know the exact name; use find_references for exact lookup.',
    inputSchema: SearchSymbolsSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query, repo_id, kind, limit, offset }) => {
    try {
      const results = searchSymbols(opts.db, { query, repoId: repo_id ?? null, kind: kind ?? null, limit, offset });
      return { content: [{ type: 'text' as const, text: JSON.stringify(results, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  server.registerTool('get_symbol_detail', {
    description:
      'Metadata-only lookup by symbol UUID: file path, line range, signature, kind. Does NOT include callers/callees (use get_symbol_context for graph). Does NOT call AI (use explain_symbol for AI summary).',
    inputSchema: GetSymbolDetailSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ symbol_id }) => {
    try {
      const detail = getSymbolDetail(opts.db, symbol_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(detail, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  server.registerTool('list_repos', {
    description: 'List all registered repositories with their IDs, names, and root paths.',
    inputSchema: {},
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async () => {
    try {
      const repos = listRepos(opts.registry);
      return { content: [{ type: 'text' as const, text: JSON.stringify(repos, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  server.registerTool('find_references', {
    description:
      'Exact-name lookup: returns every symbol definition matching the exact name, plus callers from the call graph (depth=1). Use search_symbols for fuzzy/keyword search.',
    inputSchema: FindReferencesSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ symbol_name, repo_id }) => {
    try {
      const refs = findReferences(opts.db, { symbolName: symbol_name, repoId: repo_id ?? null }, opts.graph, opts.repoId);
      return { content: [{ type: 'text' as const, text: JSON.stringify(refs, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  server.registerTool('search_files', {
    description: 'Search for indexed files by partial path fragment. Returns file metadata (path, language, size).',
    inputSchema: SearchFilesSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ query, repo_id, limit, offset }) => {
    try {
      const files = searchFiles(opts.db, { query, repoId: repo_id ?? null, limit, offset });
      return { content: [{ type: 'text' as const, text: JSON.stringify(files, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  server.registerTool('get_file_symbols', {
    description: 'Get all symbols defined in a specific file, ordered by line number.',
    inputSchema: GetFileSymbolsSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ repo_id, rel_path }) => {
    try {
      const symbols = getFileSymbols(opts.db, { repoId: repo_id, relPath: rel_path });
      return { content: [{ type: 'text' as const, text: JSON.stringify(symbols, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  server.registerTool('explain_symbol', {
    description:
      'AI-generated natural-language explanation of a symbol. Requires AI_API_KEY env var (local LLM via AI_API_BASE_URL); falls back to raw metadata if not configured. Prefer get_symbol_detail for pure metadata.',
    inputSchema: ExplainSymbolSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: false, openWorldHint: true },
  }, async ({ symbol_id }) => {
    try {
      const explanation = await explainSymbol(opts.db, symbol_id, ai);
      return { content: [{ type: 'text' as const, text: explanation }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  server.registerTool('get_repo_stats', {
    description: 'Get indexing statistics for a repository: file count, symbol count, language breakdown.',
    inputSchema: GetRepoStatsSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ repo_id }) => {
    try {
      const stats = getRepoStats(opts.db, repo_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(stats, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  server.registerTool('get_symbol_context', {
    description:
      'Graph view of a symbol: who calls it (callers, incoming) and what it calls (callees, outgoing), up to BFS depth 3. Use depth=1 for direct only. Response includes blastRadius = callers.length (who breaks if you change this) and impactCount = callers+callees total.',
    inputSchema: GetSymbolContextSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ symbol_name, depth }) => {
    try {
      const result = getSymbolContext(opts.db, opts.graph, opts.repoId, symbol_name, depth);
      if (!result) return { content: [{ type: 'text' as const, text: `Symbol not found: ${symbol_name}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  server.registerTool('get_import_chain', {
    description: 'Get the import dependency chain starting from a file (IMPORTS edges, BFS). Shows what a file depends on transitively.',
    inputSchema: GetImportChainSchema,
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ file_path, depth }) => {
    try {
      const result = getImportChain(opts.db, opts.graph, opts.repoId, file_path, depth);
      if (!result) return { content: [{ type: 'text' as const, text: `File not found: ${file_path}` }], isError: true };
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  // ── Mutating tools ───────────────────────────────────────────

  server.registerTool('register_repo', {
    description: 'Register a new repository for indexing. Returns the repo ID for use with other tools.',
    inputSchema: RegisterRepoSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ name, root_path, language }) => {
    try {
      const repo = registerRepo(opts.registry, { name, rootPath: root_path, ...(language ? { language } : {}) });
      return { content: [{ type: 'text' as const, text: JSON.stringify(repo, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  server.registerTool('index_repo', {
    description: 'Trigger full indexing of a repository. This may take a while for large repos.',
    inputSchema: IndexRepoSchema,
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, async ({ repo_id }) => {
    try {
      const result = await indexRepo(opts.registry, opts.indexer, repo_id);
      return { content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });

  // ── Destructive tools ────────────────────────────────────────

  server.registerTool('remove_repo', {
    description: 'Remove a repository and all its indexed data from the registry. This action is irreversible.',
    inputSchema: RemoveRepoSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
  }, async ({ repo_id }) => {
    try {
      removeRepo(opts.registry, repo_id);
      return { content: [{ type: 'text' as const, text: `Repo ${repo_id} removed.` }] };
    } catch (e) {
      return { content: [{ type: 'text' as const, text: errText(e) }], isError: true };
    }
  });
}
