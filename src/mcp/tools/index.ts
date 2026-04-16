import type { Server as McpSdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
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
import { createAiAdapter } from '../ai-adapter.js';
import { isAppError } from '../../errors.js';

type JsonSchema = {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
};

const TOOL_DEFINITIONS: Array<{ name: string; description: string; inputSchema: JsonSchema }> = [
  {
    name: 'search_symbols',
    description: 'Search for code symbols using FTS5 (with LIKE fallback).',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Symbol name or keyword to search for' },
        repo_id: { type: ['string', 'null'], description: 'Optional repo filter' },
        kind: { type: ['string', 'null'], description: 'Symbol kind filter (function, class, ...)' },
        limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_symbol_detail',
    description: 'Get details of a symbol by ID.',
    inputSchema: {
      type: 'object',
      properties: { symbol_id: { type: 'string' } },
      required: ['symbol_id'],
    },
  },
  {
    name: 'list_repos',
    description: 'List all registered repositories.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'register_repo',
    description: 'Register a new repository for indexing.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string' },
        root_path: { type: 'string' },
        language: { type: 'string' },
      },
      required: ['name', 'root_path'],
    },
  },
  {
    name: 'index_repo',
    description: 'Trigger indexing of a repository.',
    inputSchema: {
      type: 'object',
      properties: { repo_id: { type: 'string' } },
      required: ['repo_id'],
    },
  },
  {
    name: 'find_references',
    description: 'Find all occurrences of a symbol name across indexed repos.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol_name: { type: 'string' },
        repo_id: { type: ['string', 'null'] },
      },
      required: ['symbol_name'],
    },
  },
  {
    name: 'search_files',
    description: 'Search for files by path fragment.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string' },
        repo_id: { type: ['string', 'null'] },
        limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
      },
      required: ['query'],
    },
  },
  {
    name: 'get_file_symbols',
    description: 'Get all symbols in a specific file.',
    inputSchema: {
      type: 'object',
      properties: {
        repo_id: { type: 'string' },
        rel_path: { type: 'string' },
      },
      required: ['repo_id', 'rel_path'],
    },
  },
  {
    name: 'explain_symbol',
    description: 'Get an explanation of a symbol (AI-enhanced when AI_API_KEY is configured).',
    inputSchema: {
      type: 'object',
      properties: { symbol_id: { type: 'string' } },
      required: ['symbol_id'],
    },
  },
  {
    name: 'get_repo_stats',
    description: 'Get indexing statistics for a repository.',
    inputSchema: {
      type: 'object',
      properties: { repo_id: { type: 'string' } },
      required: ['repo_id'],
    },
  },
  {
    name: 'remove_repo',
    description: 'Remove a repository from the registry.',
    inputSchema: {
      type: 'object',
      properties: { repo_id: { type: 'string' } },
      required: ['repo_id'],
    },
  },
];

export function registerToolHandlers(server: McpSdkServer, opts: McpServerOptions): void {
  const ai = opts.aiConfig ? createAiAdapter(opts.aiConfig) : null;

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOL_DEFINITIONS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;

    try {
      switch (name) {
        case 'search_symbols': {
          const p = SearchSymbolsSchema.parse(args);
          const results = searchSymbols(opts.db, {
            query: p.query,
            repoId: p.repo_id ?? null,
            kind: p.kind ?? null,
            limit: p.limit,
          });
          return { content: [{ type: 'text', text: JSON.stringify(results, null, 2) }] };
        }
        case 'get_symbol_detail': {
          const p = GetSymbolDetailSchema.parse(args);
          const detail = getSymbolDetail(opts.db, p.symbol_id);
          return { content: [{ type: 'text', text: JSON.stringify(detail, null, 2) }] };
        }
        case 'list_repos': {
          const repos = listRepos(opts.registry);
          return { content: [{ type: 'text', text: JSON.stringify(repos, null, 2) }] };
        }
        case 'register_repo': {
          const p = RegisterRepoSchema.parse(args);
          const repo = registerRepo(opts.registry, {
            name: p.name,
            rootPath: p.root_path,
            ...(p.language ? { language: p.language } : {}),
          });
          return { content: [{ type: 'text', text: JSON.stringify(repo, null, 2) }] };
        }
        case 'index_repo': {
          const p = IndexRepoSchema.parse(args);
          const result = await indexRepo(opts.registry, opts.indexer, p.repo_id);
          return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
        }
        case 'find_references': {
          const p = FindReferencesSchema.parse(args);
          const refs = findReferences(opts.db, {
            symbolName: p.symbol_name,
            repoId: p.repo_id ?? null,
          });
          return { content: [{ type: 'text', text: JSON.stringify(refs, null, 2) }] };
        }
        case 'search_files': {
          const p = SearchFilesSchema.parse(args);
          const files = searchFiles(opts.db, {
            query: p.query,
            repoId: p.repo_id ?? null,
            limit: p.limit,
          });
          return { content: [{ type: 'text', text: JSON.stringify(files, null, 2) }] };
        }
        case 'get_file_symbols': {
          const p = GetFileSymbolsSchema.parse(args);
          const symbols = getFileSymbols(opts.db, { repoId: p.repo_id, relPath: p.rel_path });
          return { content: [{ type: 'text', text: JSON.stringify(symbols, null, 2) }] };
        }
        case 'explain_symbol': {
          const p = ExplainSymbolSchema.parse(args);
          const explanation = await explainSymbol(opts.db, p.symbol_id, ai);
          return { content: [{ type: 'text', text: explanation }] };
        }
        case 'get_repo_stats': {
          const p = GetRepoStatsSchema.parse(args);
          const stats = getRepoStats(opts.db, p.repo_id);
          return { content: [{ type: 'text', text: JSON.stringify(stats, null, 2) }] };
        }
        case 'remove_repo': {
          const p = RemoveRepoSchema.parse(args);
          removeRepo(opts.registry, p.repo_id);
          return { content: [{ type: 'text', text: `Repo ${p.repo_id} removed.` }] };
        }
        default:
          return { content: [{ type: 'text', text: `Unknown tool: ${name}` }], isError: true };
      }
    } catch (e) {
      const msg = isAppError(e) ? `[${e.code}] ${e.message}` : String(e);
      return { content: [{ type: 'text', text: msg }], isError: true };
    }
  });
}
