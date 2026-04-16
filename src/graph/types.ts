import type { IdMapper } from './id-mapper.js';

export type EdgeType = 'CALLS' | 'IMPORTS' | 'EXTENDS' | 'IMPLEMENTS';

export type IntId = number;

export type Edge = {
  targetId: IntId;
  type: EdgeType;
  confidence: number;
};

export type GraphNode = {
  outgoing: Edge[];
  incoming: Edge[];
};

export type RepoGraph = {
  nodes: Map<IntId, GraphNode>;
  mapper: IdMapper;
  fileIndex: Map<string, IntId[]>;
};

export type TraversalResult = {
  symbolId: IntId;
  depth: number;
  via: EdgeType;
};

export type SymbolContext = {
  symbolUuid: string;
  name: string;
  kind: string;
  filePath: string;
  line: number;
  callers: Array<{ symbolId: string; name: string; depth: number; via: EdgeType }>;
  callees: Array<{ symbolId: string; name: string; depth: number; via: EdgeType }>;
};

export type EnrichedContext = {
  enrichedPrompt: string;
  symbolCount: number;
  tokenCount: number;
};

export type { IdMapper };
