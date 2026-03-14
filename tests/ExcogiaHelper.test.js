'use strict';

const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const { isYinPiece, getYinQuadrant, findExcogiaBlocks, EXCOGIA_BOOST } = require('../ExcogiaHelper.js');
const { Cog } = require('../CogInventory.js');

function makeCog(key, opts = {}) {
  return new Cog({ key, initialKey: key, icon: opts.icon || { path: 'icons/cogs/Cog_Nooby.png' }, ...opts });
}

function boardFromCogs(cogMap) {
  return function(key) { return cogMap[key]; };
}

const ALL_BOARD_KEYS = Array.from({ length: 96 }, (_, i) => i);

// ──────────────────────────────────────────────
// isYinPiece
// ──────────────────────────────────────────────
describe('isYinPiece', () => {
  it('returns true for Yin_Top_Left_Cog.png (object icon)', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } });
    assert.equal(isYinPiece(cog), true);
  });

  it('returns true for Yin_Top_Right_Cog.png', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } });
    assert.equal(isYinPiece(cog), true);
  });

  it('returns true for Yin_Bottom_Left_Cog.png', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } });
    assert.equal(isYinPiece(cog), true);
  });

  it('returns true for Yin_Bottom_Right_Cog.png', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } });
    assert.equal(isYinPiece(cog), true);
  });

  it('returns false for Yang_Cog.png', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yang_Cog.png' } });
    assert.equal(isYinPiece(cog), false);
  });

  it('returns false for a regular cog (Cog_Nooby.png)', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Cog_Nooby.png' } });
    assert.equal(isYinPiece(cog), false);
  });

  it('returns false for string icon "Blank"', () => {
    const cog = makeCog(0, { icon: 'Blank' });
    assert.equal(isYinPiece(cog), false);
  });

  it('returns false for null cog', () => {
    assert.equal(isYinPiece(null), false);
  });

  it('returns false for cog with no icon', () => {
    const cog = makeCog(0, { icon: null });
    assert.equal(isYinPiece(cog), false);
  });
});

// ──────────────────────────────────────────────
// getYinQuadrant
// ──────────────────────────────────────────────
describe('getYinQuadrant', () => {
  it('returns TL for Yin_Top_Left_Cog.png', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } });
    assert.equal(getYinQuadrant(cog), 'TL');
  });

  it('returns TR for Yin_Top_Right_Cog.png', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } });
    assert.equal(getYinQuadrant(cog), 'TR');
  });

  it('returns BL for Yin_Bottom_Left_Cog.png', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } });
    assert.equal(getYinQuadrant(cog), 'BL');
  });

  it('returns BR for Yin_Bottom_Right_Cog.png', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } });
    assert.equal(getYinQuadrant(cog), 'BR');
  });

  it('returns null for a non-Yin cog', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Cog_Nooby.png' } });
    assert.equal(getYinQuadrant(cog), null);
  });

  it('returns null for Yang_Cog.png', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yang_Cog.png' } });
    assert.equal(getYinQuadrant(cog), null);
  });

  it('returns null for null cog', () => {
    assert.equal(getYinQuadrant(null), null);
  });
});

// ──────────────────────────────────────────────
// EXCOGIA_BOOST constants
// ──────────────────────────────────────────────
describe('EXCOGIA_BOOST', () => {
  it('has boostRadius "everything"', () => {
    assert.equal(EXCOGIA_BOOST.boostRadius, 'everything');
  });

  it('has buildRadiusBoost 1.25', () => {
    assert.equal(EXCOGIA_BOOST.buildRadiusBoost, 1.25);
  });

  it('has expRadiusBoost 20', () => {
    assert.equal(EXCOGIA_BOOST.expRadiusBoost, 20);
  });
});

// ──────────────────────────────────────────────
// findExcogiaBlocks
// ──────────────────────────────────────────────
describe('findExcogiaBlocks', () => {
  it('finds a valid 2x2 block at top-left corner (keys 0,1,12,13)', () => {
    // Board row 0: cols 0,1 → keys 0,1
    // Board row 1: cols 0,1 → keys 12,13
    const cogMap = {
      0:  makeCog(0,  { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } }),
      1:  makeCog(1,  { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } }),
      12: makeCog(12, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } }),
      13: makeCog(13, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } }),
    };
    const blocks = findExcogiaBlocks(boardFromCogs(cogMap), ALL_BOARD_KEYS);
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0], { tlKey: 0, trKey: 1, blKey: 12, brKey: 13 });
  });

  it('returns empty when pieces are split apart (not adjacent)', () => {
    // TL at 0, TR at 3 (skipped a column), BL at 12, BR at 15
    const cogMap = {
      0:  makeCog(0,  { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } }),
      3:  makeCog(3,  { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } }),
      12: makeCog(12, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } }),
      15: makeCog(15, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } }),
    };
    const blocks = findExcogiaBlocks(boardFromCogs(cogMap), ALL_BOARD_KEYS);
    assert.equal(blocks.length, 0);
  });

  it('returns empty when wrong quadrant order (TR where TL should be)', () => {
    // Position 0 has TR instead of TL
    const cogMap = {
      0:  makeCog(0,  { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } }),
      1:  makeCog(1,  { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } }),
      12: makeCog(12, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } }),
      13: makeCog(13, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } }),
    };
    const blocks = findExcogiaBlocks(boardFromCogs(cogMap), ALL_BOARD_KEYS);
    assert.equal(blocks.length, 0);
  });

  it('returns empty when only 3 of 4 quadrants are present', () => {
    const cogMap = {
      0:  makeCog(0,  { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } }),
      1:  makeCog(1,  { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } }),
      12: makeCog(12, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } }),
      // BR missing
    };
    const blocks = findExcogiaBlocks(boardFromCogs(cogMap), ALL_BOARD_KEYS);
    assert.equal(blocks.length, 0);
  });

  it('finds two non-overlapping blocks on the board', () => {
    // Block 1: keys 0,1,12,13 (row 0-1, col 0-1)
    // Block 2: keys 4,5,16,17 (row 0-1, col 4-5)
    const cogMap = {
      0:  makeCog(0,  { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } }),
      1:  makeCog(1,  { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } }),
      12: makeCog(12, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } }),
      13: makeCog(13, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } }),

      4:  makeCog(4,  { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } }),
      5:  makeCog(5,  { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } }),
      16: makeCog(16, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } }),
      17: makeCog(17, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } }),
    };
    const blocks = findExcogiaBlocks(boardFromCogs(cogMap), ALL_BOARD_KEYS);
    assert.equal(blocks.length, 2);
    const keys = blocks.map(b => b.tlKey).sort((a, b) => a - b);
    assert.deepEqual(keys, [0, 4]);
  });

  it('ignores non-Yin cogs mixed in with Yin pieces', () => {
    // Valid block at 0,1,12,13 plus non-Yin cogs at adjacent positions
    const cogMap = {
      0:  makeCog(0,  { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } }),
      1:  makeCog(1,  { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } }),
      2:  makeCog(2,  { icon: { path: 'icons/cogs/Cog_Nooby.png' } }),
      12: makeCog(12, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } }),
      13: makeCog(13, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } }),
      14: makeCog(14, { icon: { path: 'icons/cogs/Cog_Decent.png' } }),
    };
    const blocks = findExcogiaBlocks(boardFromCogs(cogMap), ALL_BOARD_KEYS);
    assert.equal(blocks.length, 1);
    assert.deepEqual(blocks[0], { tlKey: 0, trKey: 1, blKey: 12, brKey: 13 });
  });

  it('returns empty array when board has no Yin pieces', () => {
    const cogMap = {
      0: makeCog(0, { icon: { path: 'icons/cogs/Cog_Nooby.png' } }),
      1: makeCog(1, { icon: { path: 'icons/cogs/Cog_Decent.png' } }),
    };
    const blocks = findExcogiaBlocks(boardFromCogs(cogMap), ALL_BOARD_KEYS);
    assert.equal(blocks.length, 0);
  });

  it('returns empty array when getCog always returns null', () => {
    const blocks = findExcogiaBlocks(() => null, ALL_BOARD_KEYS);
    assert.equal(blocks.length, 0);
  });

  it('does not find a block when TL is at the last column (no room for TR)', () => {
    // col 11 is the last column; col 11 + 1 = 12 which is >= INV_COLUMNS
    const cogMap = {
      11: makeCog(11, { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } }),
      // key 12 is row 1 col 0, not row 0 col 12
      12: makeCog(12, { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } }),
      23: makeCog(23, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } }),
      24: makeCog(24, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } }),
    };
    const blocks = findExcogiaBlocks(boardFromCogs(cogMap), ALL_BOARD_KEYS);
    assert.equal(blocks.length, 0);
  });
});
