import type { Server as McpSdkServer } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import type { McpServerOptions } from '../server.js';
import { getRepoStats } from '../tools/get-repo-stats.js';
import { searchSymbols } from '../tools/search-symbols.js';

export function registerResourceHandlers(server: McpSdkServer, opts: McpServerOptions): void {
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: [
      { uri: 'repos://list', name: 'All Repositories', mimeType: 'application/json' },
      { uri: 'repos://stats', name: 'All Repo Stats', mimeType: 'application/json' },
      { uri: 'symbols://recent', name: 'Recent Symbols', mimeType: 'application/json' },
      { uri: 'symbols://search', name: 'Symbol Search (use ?q=)', mimeType: 'application/json' },
      { uri: 'files://list', name: 'All Indexed Files', mimeType: 'application/json' },
    ],
  }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const uri = req.params.uri;

    if (uri === 'repos://list') {
      const repos = opts.registry.list();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(repos, null, 2) }],
      };
    }

    if (uri === 'repos://stats') {
      const repos = opts.registry.list();
      const stats = repos.map((r) => getRepoStats(opts.db, r.id));
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }],
      };
    }

    if (uri === 'symbols://recent') {
      const rows = opts.db
        .prepare(
          `SELECT s.id, s.name, s.kind, f.rel_path
           FROM symbols s JOIN files f ON f.id = s.file_id
           ORDER BY s.rowid DESC LIMIT 50`,
        )
        .all();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(rows, null, 2) }],
      };
    }

    if (uri.startsWith('symbols://search')) {
      const parsed = new URL(uri.replace('symbols://', 'http://x/'));
      const q = parsed.searchParams.get('q') ?? '';
      const results = q
        ? searchSymbols(opts.db, { query: q, repoId: null, limit: 50 })
        : [];
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(results, null, 2) }],
      };
    }

    if (uri === 'files://list') {
      const rows = opts.db
        .prepare(
          `SELECT id, repo_id, rel_path, language, size_bytes FROM files ORDER BY rel_path LIMIT 500`,
        )
        .all();
      return {
        contents: [{ uri, mimeType: 'application/json', text: JSON.stringify(rows, null, 2) }],
      };
    }

    return {
      contents: [{ uri, mimeType: 'text/plain', text: `Unknown resource: ${uri}` }],
    };
  });
}
