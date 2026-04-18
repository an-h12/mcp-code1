import 'dotenv/config';
import { z } from 'zod';

const EnvSchema = z.object({
  DB_PATH: z.string().min(1),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  MCP_PORT: z.coerce.number().int().min(1024).max(65535).default(3000),
  UI_PORT: z.coerce.number().int().min(1024).max(65535).default(3001),
  AI_API_KEY: z.string().default(''),
  AI_API_BASE_URL: z.string().default(''),
  AI_MODEL: z.string().default(''),
});

export type Config = {
  dbPath: string;
  logLevel: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
  mcpPort: number;
  uiPort: number;
  aiApiKey: string;
  aiApiBaseUrl: string;
  aiModel: string;
};

export function loadConfig(): Config {
  const parsed = EnvSchema.parse(process.env);
  // Zod's `.default('')` treats explicit '' as valid; require user to set AI_MODEL explicitly
  const aiModel = parsed.AI_MODEL;
  return {
    dbPath: parsed.DB_PATH,
    logLevel: parsed.LOG_LEVEL,
    mcpPort: parsed.MCP_PORT,
    uiPort: parsed.UI_PORT,
    aiApiKey: parsed.AI_API_KEY,
    aiApiBaseUrl: parsed.AI_API_BASE_URL,
    aiModel,
  };
}
