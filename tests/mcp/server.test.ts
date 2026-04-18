import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { RepoRegistry } from '../../src/registry.js';
import { Indexer } from '../../src/indexer/indexer.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';

describe('McpServer', () => {
  it('can be instantiated without throwing', async () => {
    const { McpServer } = await import('../../src/mcp/server.js');
    const db = openDb(':memory:');
    const registry = new RepoRegistry(db);
    const indexer = new Indexer(db);
    const graph = new InMemoryGraph(db);
    expect(() => new McpServer({ db, registry, indexer, aiConfig: null, graph, repoId: '' })).not.toThrow();
    db.close();
  });

  it('exposes expected tool names', async () => {
    const { TOOL_NAMES } = await import('../../src/mcp/server.js');
    expect(TOOL_NAMES).toContain('code_search_symbols');
    expect(TOOL_NAMES).toContain('code_get_symbol_detail');
    expect(TOOL_NAMES).toContain('code_list_repos');
    expect(TOOL_NAMES).toContain('code_register_repo');
    expect(TOOL_NAMES).toContain('code_index_repo');
    expect(TOOL_NAMES).toContain('code_find_references');
    expect(TOOL_NAMES).toContain('code_search_files');
    expect(TOOL_NAMES).toContain('code_get_file_symbols');
    expect(TOOL_NAMES).toContain('code_explain_symbol');
    expect(TOOL_NAMES).toContain('code_get_repo_stats');
    expect(TOOL_NAMES).toContain('code_remove_repo');
    expect(TOOL_NAMES).toContain('code_get_symbol_context');
    expect(TOOL_NAMES).toContain('code_get_import_chain');
    expect(TOOL_NAMES).toContain('code_find_callers');
    expect(TOOL_NAMES).toContain('code_find_callees');
    expect(TOOL_NAMES).toContain('code_get_impact_analysis');
    expect(TOOL_NAMES).toHaveLength(16);
  });
});
