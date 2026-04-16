import { describe, it, expect } from 'vitest';

describe('AppError', () => {
  it('carries an error code', async () => {
    const { AppError, ErrorCode } = await import('../src/errors.js');
    const err = new AppError(ErrorCode.REPO_NOT_FOUND, 'repo "x" not found');
    expect(err.code).toBe(ErrorCode.REPO_NOT_FOUND);
    expect(err.message).toBe('repo "x" not found');
    expect(err instanceof Error).toBe(true);
  });

  it('isAppError returns true for AppError', async () => {
    const { AppError, isAppError, ErrorCode } = await import('../src/errors.js');
    const err = new AppError(ErrorCode.DB_ERROR, 'db fail');
    expect(isAppError(err)).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });
});
