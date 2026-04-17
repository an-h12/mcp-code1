import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpServerOptions } from '../server.js';
import { getRepoStats } from '../tools/get-repo-stats.js';
import { searchSymbols } from '../tools/search-symbols.js';

export function registerResources(server: McpServer, opts: McpServerOptions): void {
  server.resource('repos-list', 'repos://list', { description: 'All registered repositories' }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(opts.registry.list(), null, 2) }],
  }));

  server.resource('repos-stats', 'repos://stats', { description: 'Indexing stats for all repos' }, async (uri) => {
    const repos = opts.registry.list();
    const stats = repos.map((r) => getRepoStats(opts.db, r.id));
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(stats, null, 2) }],
    };
  });

  server.resource('symbols-recent', 'symbols://recent', { description: 'Most recently indexed symbols (limit 50)' }, async (uri) => {
    const rows = opts.db
      .prepare(
        `SELECT s.id, s.name, s.kind, f.rel_path
         FROM symbols s JOIN files f ON f.id = s.file_id
         ORDER BY s.rowid DESC LIMIT 50`,
      )
      .all();
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(rows, null, 2) }],
    };
  });

  const searchTemplate = new ResourceTemplate('symbols://search{?q}', { list: undefined });
  server.resource('symbols-search', searchTemplate, { description: 'Search symbols by keyword (use ?q=)' }, async (uri, variables) => {
    const q = typeof variables.q === 'string' ? variables.q : '';
    const results = q ? searchSymbols(opts.db, { query: q, repoId: null, limit: 50 }).items : [];
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(results, null, 2) }],
    };
  });

  server.resource('files-list', 'files://list', { description: 'All indexed files' }, async (uri) => {
    const rows = opts.db
      .prepare(
        `SELECT id, repo_id, rel_path, language, size_bytes FROM files ORDER BY rel_path LIMIT 500`,
      )
      .all();
    return {
      contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(rows, null, 2) }],
    };
  });
}
