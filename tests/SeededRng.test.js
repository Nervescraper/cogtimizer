const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SeededRng } = require('../SeededRng.js');

describe('SeededRng', () => {
  it('produces deterministic sequence from same seed', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      assert.strictEqual(rng1.random(), rng2.random());
    }
  });

  it('produces different sequences from different seeds', () => {
    const rng1 = new SeededRng(42);
    const rng2 = new SeededRng(99);
    let same = 0;
    for (let i = 0; i < 100; i++) {
      if (rng1.random() === rng2.random()) same++;
    }
    assert.ok(same < 5, 'Should produce mostly different values');
  });

  it('returns values in [0, 1) range', () => {
    const rng = new SeededRng(123);
    for (let i = 0; i < 1000; i++) {
      const v = rng.random();
      assert.ok(v >= 0 && v < 1, `Value ${v} out of range`);
    }
  });

  it('randInt returns values in [0, max) range', () => {
    const rng = new SeededRng(456);
    for (let i = 0; i < 1000; i++) {
      const v = rng.randInt(10);
      assert.ok(v >= 0 && v < 10 && Number.isInteger(v), `Value ${v} out of range`);
    }
  });

  it('pick selects a random element from array', () => {
    const rng = new SeededRng(789);
    const arr = ['a', 'b', 'c'];
    const picked = new Set();
    for (let i = 0; i < 100; i++) {
      picked.add(rng.pick(arr));
    }
    assert.strictEqual(picked.size, 3);
  });
});
