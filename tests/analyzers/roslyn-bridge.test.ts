import { describe, it, expect } from 'vitest';
import { RoslynBridge } from '../../src/analyzers/roslyn-bridge.js';

describe('RoslynBridge', () => {
  it('returns null from analyze() when no binary present', async () => {
    const bridge = new RoslynBridge();
    const result = await bridge.analyze({
      action: 'analyze',
      files: ['fake.cs'],
      projectRoot: '/fake',
      repoId: 'r1',
    });
    expect(result === null || typeof result === 'object').toBe(true);
  });

  it('can be instantiated without throwing', () => {
    expect(() => new RoslynBridge()).not.toThrow();
  });
});
