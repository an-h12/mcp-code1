export enum ErrorCode {
  // Repository errors
  REPO_NOT_FOUND = 'REPO_NOT_FOUND',
  REPO_ALREADY_EXISTS = 'REPO_ALREADY_EXISTS',
  REPO_INVALID_PATH = 'REPO_INVALID_PATH',

  // Database errors
  DB_ERROR = 'DB_ERROR',
  DB_MIGRATION_ERROR = 'DB_MIGRATION_ERROR',

  // Indexing errors
  INDEX_PARSE_ERROR = 'INDEX_PARSE_ERROR',
  INDEX_FILE_NOT_FOUND = 'INDEX_FILE_NOT_FOUND',
  INDEX_NOT_READY = 'INDEX_NOT_READY',

  // MCP / tool errors
  TOOL_INVALID_PARAMS = 'TOOL_INVALID_PARAMS',
  TOOL_NOT_FOUND = 'TOOL_NOT_FOUND',

  // Internal
  INTERNAL = 'INTERNAL',
}

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'AppError';
    this.code = code;
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

export function toAppError(value: unknown): AppError {
  if (isAppError(value)) return value;
  const msg = value instanceof Error ? value.message : String(value);
  return new AppError(ErrorCode.INTERNAL, msg, value);
}
