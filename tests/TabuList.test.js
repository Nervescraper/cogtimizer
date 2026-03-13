const { describe, it } = require('node:test');
const assert = require('node:assert');
const { TabuList } = require('../TabuList.js');

describe('TabuList', () => {
  it('is empty on construction', () => {
    const tl = new TabuList(5);
    assert.strictEqual(tl.has(2, 7), false);
  });

  it('reports a move as tabu after adding it', () => {
    const tl = new TabuList(5);
    tl.add(2, 7);
    assert.strictEqual(tl.has(2, 7), true);
  });

  it('normalizes (a,b) and (b,a) to the same entry', () => {
    const tl = new TabuList(5);
    tl.add(7, 2);
    assert.strictEqual(tl.has(2, 7), true);
    assert.strictEqual(tl.has(7, 2), true);
  });

  it('evicts oldest entry when ring buffer is full', () => {
    const tl = new TabuList(3);
    tl.add(1, 2); // slot 0
    tl.add(3, 4); // slot 1
    tl.add(5, 6); // slot 2
    // All three present
    assert.strictEqual(tl.has(1, 2), true);
    assert.strictEqual(tl.has(3, 4), true);
    assert.strictEqual(tl.has(5, 6), true);
    // Adding a 4th evicts slot 0 (move 1,2)
    tl.add(7, 8);
    assert.strictEqual(tl.has(1, 2), false);
    assert.strictEqual(tl.has(3, 4), true);
    assert.strictEqual(tl.has(5, 6), true);
    assert.strictEqual(tl.has(7, 8), true);
  });

  it('evicts in FIFO order across multiple wraps', () => {
    const tl = new TabuList(2);
    tl.add(1, 2); // slot 0
    tl.add(3, 4); // slot 1
    tl.add(5, 6); // evicts (1,2), slot 0
    tl.add(7, 8); // evicts (3,4), slot 1
    assert.strictEqual(tl.has(1, 2), false);
    assert.strictEqual(tl.has(3, 4), false);
    assert.strictEqual(tl.has(5, 6), true);
    assert.strictEqual(tl.has(7, 8), true);
  });

  it('clears all entries', () => {
    const tl = new TabuList(5);
    tl.add(1, 2);
    tl.add(3, 4);
    tl.clear();
    assert.strictEqual(tl.has(1, 2), false);
    assert.strictEqual(tl.has(3, 4), false);
  });

  it('can re-add a move after it has been evicted', () => {
    const tl = new TabuList(2);
    tl.add(1, 2);
    tl.add(3, 4);
    tl.add(5, 6); // evicts (1,2)
    tl.add(1, 2); // re-add
    assert.strictEqual(tl.has(1, 2), true);
  });

  it('handles adding the same move twice (counts as two slots)', () => {
    const tl = new TabuList(3);
    tl.add(1, 2); // slot 0
    tl.add(1, 2); // slot 1 — duplicate allowed in ring
    tl.add(3, 4); // slot 2
    tl.add(5, 6); // evicts slot 0: (1,2) — but slot 1 still holds (1,2)
    assert.strictEqual(tl.has(1, 2), true); // still present via slot 1
    tl.add(7, 8); // evicts slot 1: (1,2) — now fully gone
    assert.strictEqual(tl.has(1, 2), false);
  });

  it('size property returns tenure', () => {
    const tl = new TabuList(50);
    assert.strictEqual(tl.tenure, 50);
  });
});
