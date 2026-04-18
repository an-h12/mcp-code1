import { z } from 'zod';

export const SearchSymbolsSchema = z.object({
  query: z.string().min(1).describe('Symbol name or keyword to search for'),
  repo_id: z.string().optional().nullable().describe('Filter to a specific repo ID. Get IDs from list_repos.'),
  kind: z.string().optional().nullable().describe('Symbol kind filter: function, class, interface, method, type, enum, variable, const'),
  limit: z.number().int().min(1).max(100).default(20),
  offset: z.number().int().min(0).default(0).describe('Pagination offset. Use next_offset from previous response.'),
});

export const GetSymbolDetailSchema = z.object({
  symbol_id: z.string().min(1).describe('UUID of the symbol'),
});

export const RegisterRepoSchema = z.object({
  name: z.string().min(1).describe('Unique human-readable repo name'),
  root_path: z.string().min(1).describe('Absolute path to the repository root'),
  language: z.string().optional().describe('Primary language hint'),
});

export const IndexRepoSchema = z.object({
  repo_id: z.string().min(1).describe('UUID of the repo to (re)index'),
});

export const FindReferencesSchema = z.object({
  symbol_name: z.string().min(1).describe('Exact symbol name to find'),
  repo_id: z.string().optional().nullable().describe('Filter by repo. Get IDs from code_list_repos.'),
});

export const SearchFilesSchema = z.object({
  query: z.string().min(1).describe('Partial file path to search'),
  repo_id: z.string().optional().nullable().describe('Filter by repo. Get IDs from code_list_repos.'),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0).describe('Pagination offset. Use next_offset from previous response.'),
});

export const GetFileSymbolsSchema = z.object({
  repo_id: z.string().min(1),
  rel_path: z.string().min(1).describe('Relative file path within the repo'),
});

export const ExplainSymbolSchema = z.object({
  symbol_id: z.string().min(1).describe('UUID from code_search_symbols or code_find_references'),
});

export const GetRepoStatsSchema = z.object({
  repo_id: z.string().min(1),
});

export const RemoveRepoSchema = z.object({
  repo_id: z.string().min(1),
});

export const ListReposSchema = z.object({});

export const GetSymbolContextSchema = z.object({
  symbol_name: z.string().min(1).describe('Exact or partial symbol name to look up'),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(2),
});

export const GetImportChainSchema = z.object({
  file_path: z.string().min(1),
  depth: z.number().int().min(1).max(5).optional().default(3),
});

// ── Output schemas ─────────────────────────────────────────────────────────

const SymbolResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  repoId: z.string(),
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  signature: z.string(),
});

const PaginatedSymbolsSchema = z.object({
  items: z.array(SymbolResultSchema),
  total_count: z.number(),
  has_more: z.boolean(),
  next_offset: z.number(),
});

export const SearchSymbolsOutputSchema = PaginatedSymbolsSchema;

export const GetSymbolDetailOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  filePath: z.string(),
  startLine: z.number(),
  endLine: z.number(),
  signature: z.string(),
});

const ReferenceResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  repoId: z.string(),
  filePath: z.string(),
  startLine: z.number(),
  referenceType: z.enum(['definition', 'caller']),
});

export const FindReferencesOutputSchema = z.array(ReferenceResultSchema);

const GraphNodeSchema = z.object({
  symbolId: z.string(),
  name: z.string(),
  filePath: z.string(),
  line: z.number(),
  depth: z.number(),
  via: z.string(),
});

export const GetSymbolContextOutputSchema = z.object({
  symbol: z.object({ id: z.string(), name: z.string(), kind: z.string(), filePath: z.string(), line: z.number() }),
  callers: z.array(GraphNodeSchema),
  callees: z.array(GraphNodeSchema),
  blastRadius: z.number(),
  impactCount: z.number(),
  resolvedAs: z.string(),
});

const ImportChainEntrySchema = z.object({
  file: z.string(),
  imports: z.array(z.string()),
});

export const GetImportChainOutputSchema = z.object({
  chain: z.array(ImportChainEntrySchema),
  resolvedAs: z.string(),
});

const FileResultSchema = z.object({
  id: z.string(),
  repo_id: z.string(),
  rel_path: z.string(),
  language: z.string().nullable(),
  size_bytes: z.number().nullable(),
});

export const SearchFilesOutputSchema = z.object({
  items: z.array(FileResultSchema),
  total_count: z.number(),
  has_more: z.boolean(),
  next_offset: z.number(),
});

export const GetFileSymbolsOutputSchema = z.array(SymbolResultSchema);

const RepoResultSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  language: z.string().optional(),
});

export const ListReposOutputSchema = z.array(RepoResultSchema);

export const GetRepoStatsOutputSchema = z.object({
  repoId: z.string(),
  fileCount: z.number(),
  symbolCount: z.number(),
  languages: z.array(z.object({ language: z.string().nullable(), count: z.number() })),
});

export const ExplainSymbolOutputSchema = z.object({
  symbolId: z.string(),
  explanation: z.string(),
});

export const RegisterRepoOutputSchema = z.object({
  id: z.string(),
  name: z.string(),
  rootPath: z.string(),
  language: z.string().optional(),
});

export const IndexRepoOutputSchema = z.object({
  repoId: z.string(),
  fileCount: z.number(),
  symbolCount: z.number(),
  durationMs: z.number(),
});

export const RemoveRepoOutputSchema = z.object({
  repoId: z.string(),
  removed: z.boolean(),
});
