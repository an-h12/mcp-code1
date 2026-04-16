import { describe, it, expect } from 'vitest';
import { ModuleMap } from '../../src/indexer/module-map.js';

describe('ModuleMap', () => {
  it('findSymbol returns first match for registered name', () => {
    const m = new ModuleMap();
    m.register('/a.ts', [{ id: 'id1', name: 'foo' }, { id: 'id2', name: 'bar' }]);
    expect(m.findSymbol('foo')).toBe('id1');
    expect(m.findSymbol('bar')).toBe('id2');
  });

  it('getSymbolId looks up by file + name', () => {
    const m = new ModuleMap();
    m.register('/a.ts', [{ id: 'id1', name: 'foo' }]);
    expect(m.getSymbolId('/a.ts', 'foo')).toBe('id1');
    expect(m.getSymbolId('/a.ts', 'missing')).toBeNull();
  });

  it('returns null for unknown name', () => {
    const m = new ModuleMap();
    expect(m.findSymbol('unknown')).toBeNull();
  });

  it('handles multiple files with same symbol name', () => {
    const m = new ModuleMap();
    m.register('/a.ts', [{ id: 'id1', name: 'process' }]);
    m.register('/b.ts', [{ id: 'id2', name: 'process' }]);
    expect(m.findSymbol('process')).toBe('id1');
    expect(m.getSymbolId('/b.ts', 'process')).toBe('id2');
  });
});
