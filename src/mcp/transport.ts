import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export type TransportMode = 'stdio' | 'sse';

export function createStdioTransport(): StdioServerTransport {
  return new StdioServerTransport();
}
