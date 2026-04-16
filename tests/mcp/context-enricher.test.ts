import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/index.js';
import { InMemoryGraph } from '../../src/graph/in-memory-graph.js';
import { ContextEnricher } from '../../src/mcp/context-enricher.js';

describe('ContextEnricher', () => {
  it('extractMentions finds backtick symbols', () => {
    const db = openDb(':memory:');
    const graph = new InMemoryGraph(db);
    const ce = new ContextEnricher('r1', db, graph);
    const mentions = ce.extractMentions('Can you explain `processOrder` and `validateCart`?');
    expect(mentions).toContain('processOrder');
    expect(mentions).toContain('validateCart');
    db.close();
  });

  it('extractMentions finds PascalCase symbols', () => {
    const db = openDb(':memory:');
    const graph = new InMemoryGraph(db);
    const ce = new ContextEnricher('r1', db, graph);
    const mentions = ce.extractMentions('How does OrderProcessor interact with PaymentGateway?');
    expect(mentions).toContain('OrderProcessor');
    expect(mentions).toContain('PaymentGateway');
    db.close();
  });

  it('extractMentions deduplicates', () => {
    const db = openDb(':memory:');
    const graph = new InMemoryGraph(db);
    const ce = new ContextEnricher('r1', db, graph);
    const mentions = ce.extractMentions('`foo` and `foo` again');
    expect(mentions.filter((m) => m === 'foo').length).toBe(1);
    db.close();
  });

  it('extractMentions caps at 5 symbols', () => {
    const db = openDb(':memory:');
    const graph = new InMemoryGraph(db);
    const ce = new ContextEnricher('r1', db, graph);
    const msg = '`a` `b` `c` `d` `e` `f` `g`';
    const mentions = ce.extractMentions(msg);
    expect(mentions.length).toBeLessThanOrEqual(5);
    db.close();
  });

  it('enrich returns enrichedPrompt containing original message', async () => {
    const db = openDb(':memory:');
    db.prepare(`INSERT INTO repos(id, name, root_path) VALUES ('r1','t','/t')`).run();
    const graph = new InMemoryGraph(db);
    const ce = new ContextEnricher('r1', db, graph);
    const result = await ce.enrich('How does foo work?');
    expect(result.enrichedPrompt).toContain('How does foo work?');
    db.close();
  });
});
