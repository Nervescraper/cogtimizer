const { describe, it } = require('node:test');
const assert = require('node:assert');
const { getBoostPositions } = require('../BoostPositions.js');

describe('getBoostPositions', () => {
  it('returns 4 diagonal positions for center cog', () => {
    const positions = getBoostPositions('diagonal', 3, 5);
    assert.deepStrictEqual(positions.sort((a,b) => a[0]-b[0] || a[1]-b[1]), [
      [2, 4], [2, 6], [4, 4], [4, 6]
    ]);
  });

  it('returns 4 adjacent positions for center cog', () => {
    const positions = getBoostPositions('adjacent', 3, 5);
    assert.deepStrictEqual(positions.sort((a,b) => a[0]-b[0] || a[1]-b[1]), [
      [2, 5], [3, 4], [3, 6], [4, 5]
    ]);
  });

  it('returns 6 positions for up radius', () => {
    const positions = getBoostPositions('up', 4, 5);
    assert.strictEqual(positions.length, 6);
    for (const [r] of positions) {
      assert.ok(r < 4, `row ${r} should be above 4`);
    }
  });

  it('returns 6 positions for down radius', () => {
    const positions = getBoostPositions('down', 3, 5);
    assert.strictEqual(positions.length, 6);
    for (const [r] of positions) {
      assert.ok(r > 3, `row ${r} should be below 3`);
    }
  });

  it('returns 6 positions for left radius', () => {
    const positions = getBoostPositions('left', 3, 5);
    assert.strictEqual(positions.length, 6);
    for (const [, c] of positions) {
      assert.ok(c < 5, `col ${c} should be left of 5`);
    }
  });

  it('returns 6 positions for right radius', () => {
    const positions = getBoostPositions('right', 3, 5);
    assert.strictEqual(positions.length, 6);
    for (const [, c] of positions) {
      assert.ok(c > 5, `col ${c} should be right of 5`);
    }
  });

  it('returns 11 positions for row radius (excludes self)', () => {
    const positions = getBoostPositions('row', 3, 5);
    assert.strictEqual(positions.length, 11);
    for (const [r, c] of positions) {
      assert.strictEqual(r, 3);
      assert.notStrictEqual(c, 5);
    }
  });

  it('returns 7 positions for column radius (excludes self)', () => {
    const positions = getBoostPositions('column', 3, 5);
    assert.strictEqual(positions.length, 7);
    for (const [r, c] of positions) {
      assert.strictEqual(c, 5);
      assert.notStrictEqual(r, 3);
    }
  });

  it('returns 4 positions for corners radius', () => {
    const positions = getBoostPositions('corners', 3, 5);
    assert.deepStrictEqual(positions.sort((a,b) => a[0]-b[0] || a[1]-b[1]), [
      [1, 3], [1, 7], [5, 3], [5, 7]
    ]);
  });

  it('returns 12 positions for around radius', () => {
    const positions = getBoostPositions('around', 4, 6);
    assert.strictEqual(positions.length, 12);
  });

  it('returns 95 positions for everything radius (excludes self)', () => {
    const positions = getBoostPositions('everything', 3, 5);
    assert.strictEqual(positions.length, 95);
    const hasSelf = positions.some(([r, c]) => r === 3 && c === 5);
    assert.strictEqual(hasSelf, false);
  });

  it('returns empty array for unknown radius type', () => {
    const positions = getBoostPositions('unknown', 3, 5);
    assert.deepStrictEqual(positions, []);
  });

  it('returns out-of-bounds positions unfiltered (caller filters)', () => {
    const positions = getBoostPositions('diagonal', 0, 0);
    assert.strictEqual(positions.length, 4);
    const inBounds = positions.filter(([r, c]) => r >= 0 && r < 8 && c >= 0 && c < 12);
    assert.strictEqual(inBounds.length, 1);
  });
});
