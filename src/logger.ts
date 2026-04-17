import pino, { type LoggerOptions } from 'pino';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export function createLogger(level: LogLevel = 'info') {
  const opts: LoggerOptions = { level };
  if (process.env['NODE_ENV'] !== 'production') {
    opts.transport = {
      target: 'pino-pretty',
      options: { colorize: true, destination: 2 }, // 2 = stderr, tránh làm hỏng stdio MCP
    };
  } else {
    // production: ghi thẳng ra stderr dạng JSON
    return pino(opts, pino.destination(2));
  }
  return pino(opts);
}

export type Logger = ReturnType<typeof createLogger>;
