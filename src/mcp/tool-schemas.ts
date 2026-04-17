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
  repo_id: z.string().optional().nullable(),
});

export const SearchFilesSchema = z.object({
  query: z.string().min(1).describe('Partial file path to search'),
  repo_id: z.string().optional().nullable(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0).describe('Pagination offset. Use next_offset from previous response.'),
});

export const GetFileSymbolsSchema = z.object({
  repo_id: z.string().min(1),
  rel_path: z.string().min(1).describe('Relative file path within the repo'),
});

export const ExplainSymbolSchema = z.object({
  symbol_id: z.string().min(1),
});

export const GetRepoStatsSchema = z.object({
  repo_id: z.string().min(1),
});

export const RemoveRepoSchema = z.object({
  repo_id: z.string().min(1),
});

export const ListReposSchema = z.object({});

export const GetSymbolContextSchema = z.object({
  symbol_name: z.string().min(1),
  depth: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional().default(2),
});

export const GetImportChainSchema = z.object({
  file_path: z.string().min(1),
  depth: z.number().int().min(1).max(5).optional().default(3),
});
