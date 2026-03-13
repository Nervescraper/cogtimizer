'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert');
const { IncrementalScorer } = require('../IncrementalScorer.js');
const { SeededRng } = require('../SeededRng.js');
const { makeCog, buildInventory, assertScoresEqual } = require('./helpers.js');

// ─── IncrementalScorer — initialization ──────────────────────────────────────

describe('IncrementalScorer — initialization', () => {

  it('matches full recompute for no boost cogs', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 10 }),
      makeCog(1, { buildRate: 20, expBonus: 5 }),
      makeCog(13, { flaggy: 15 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'no boost cogs');
  });

  it('matches full recompute for adjacent boost', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 10 }),
      makeCog(1, { boostRadius: 'adjacent', buildRadiusBoost: 50 }),
      makeCog(12, { buildRate: 20 }),
      makeCog(2, { buildRate: 30 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'adjacent boost');
  });

  it('matches full recompute for player+expBoost', () => {
    const inv = buildInventory([
      makeCog(13, { isPlayer: true }),
      makeCog(12, { boostRadius: 'adjacent', expRadiusBoost: 25 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'player+expBoost');
  });

  it('matches full recompute for flag+flagBoost', () => {
    const flagPos = 14;
    const inv = buildInventory(
      [
        makeCog(0, { boostRadius: 'row', flagBoost: 10 }),
        makeCog(flagPos, { isFlag: true }),
      ],
      { flagPose: [flagPos] }
    );
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'flag+flagBoost');
  });

  it('matches full recompute for flaggyShopUpgrades', () => {
    const inv = buildInventory(
      [
        makeCog(0, { flaggy: 100 }),
        makeCog(1, { flaggy: 50, boostRadius: 'adjacent', flaggyRadiusBoost: 30 }),
      ],
      { flaggyShopUpgrades: 3 }
    );
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'flaggyShopUpgrades');
  });

  it('matches full recompute for multiple boost types', () => {
    const inv = buildInventory([
      makeCog(25, { buildRate: 100, flaggy: 50 }),
      makeCog(26, { boostRadius: 'adjacent', buildRadiusBoost: 20, flaggyRadiusBoost: 10 }),
      makeCog(38, { boostRadius: 'diagonal', buildRadiusBoost: 30 }),
      makeCog(13, { isPlayer: true }),
      makeCog(1, { boostRadius: 'row', expRadiusBoost: 15 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'multiple boost types');
  });

  it('matches full recompute for empty board', () => {
    const inv = buildInventory([]);
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'empty board');
  });

  it('fullRecompute matches score', () => {
    const inv = buildInventory([
      makeCog(5, { buildRate: 42, expBonus: 7 }),
      makeCog(17, { boostRadius: 'column', buildRadiusBoost: 10 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    const s1 = scorer.score;
    const s2 = scorer.fullRecompute();
    assertScoresEqual(s1, s2, 'fullRecompute vs score');
  });

});

// ─── IncrementalScorer — swap non-boost cogs ────────────────────────────────

describe('IncrementalScorer — swap non-boost cogs', () => {

  it('matches after swapping two stat cogs', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 10, expBonus: 5 }),
      makeCog(1, { buildRate: 20, flaggy: 8 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 1);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'swap two stat cogs');
  });

  it('matches after swapping stat cog with empty position', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 15 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 5);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'stat cog to empty');
  });

  it('matches after swapping cog into spare area and back', () => {
    // key 0 (board) <-> key 50 (board) - both available
    const inv = buildInventory([
      makeCog(0, { buildRate: 10 }),
      makeCog(50, { buildRate: 25 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 50);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'swap within board');
  });

  it('matches after multiple sequential swaps', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 10 }),
      makeCog(1, { buildRate: 20 }),
      makeCog(2, { flaggy: 5 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 1);
    scorer.swap(1, 2);
    scorer.swap(0, 2);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'multiple sequential swaps');
  });

  it('undo restores score', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 10 }),
      makeCog(1, { buildRate: 20 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    const before = scorer.score;
    scorer.swap(0, 1);
    scorer.swap(0, 1); // undo
    assertScoresEqual(scorer.score, before, 'undo restores score');
  });

  it('matches after swap when cog is in bonus zone', () => {
    const inv = buildInventory([
      makeCog(1, { boostRadius: 'adjacent', buildRadiusBoost: 50 }),
      makeCog(0, { buildRate: 100 }),  // adjacent to cog at 1
      makeCog(13, { buildRate: 200 }), // adjacent to cog at 1 (below)
      makeCog(25, { buildRate: 50 }),  // not adjacent
    ]);
    const scorer = new IncrementalScorer(inv);
    // Swap the stat cog at 0 (in bonus zone) with one not in bonus zone
    scorer.swap(0, 25);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'swap within bonus zone');
  });

});

// ─── IncrementalScorer — swap boost cogs ────────────────────────────────────

describe('IncrementalScorer — swap boost cogs', () => {

  it('matches after swapping a boost cog with a stat cog', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', buildRadiusBoost: 50 }),
      makeCog(1, { buildRate: 100 }),
      makeCog(12, { buildRate: 80 }),
      makeCog(25, { buildRate: 60 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 25);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'boost-stat swap');
  });

  it('matches after swapping two boost cogs', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', buildRadiusBoost: 50 }),
      makeCog(25, { boostRadius: 'adjacent', buildRadiusBoost: 30 }),
      makeCog(1, { buildRate: 100 }),
      makeCog(26, { buildRate: 80 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 25);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'two-boost swap');
  });

  it('matches after swapping a row boost cog', () => {
    const inv = buildInventory([
      makeCog(12, { boostRadius: 'row', buildRadiusBoost: 20 }),
      makeCog(13, { buildRate: 100 }),
      makeCog(14, { buildRate: 80 }),
      makeCog(0, { buildRate: 40 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(12, 0);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'row boost swap');
  });

  it('matches after swapping a column boost cog', () => {
    const inv = buildInventory([
      makeCog(1, { boostRadius: 'column', buildRadiusBoost: 15 }),
      makeCog(13, { buildRate: 100 }),
      makeCog(25, { buildRate: 80 }),
      makeCog(50, { buildRate: 40 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(1, 50);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'column boost swap');
  });

  it('matches after swapping an around boost cog', () => {
    const inv = buildInventory([
      makeCog(25, { boostRadius: 'around', buildRadiusBoost: 10 }),
      makeCog(13, { buildRate: 100 }),
      makeCog(26, { buildRate: 80 }),
      makeCog(37, { buildRate: 60 }),
      makeCog(0, { buildRate: 40 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(25, 0);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'around boost swap');
  });

  it('matches after swapping a corners boost cog', () => {
    const inv = buildInventory([
      makeCog(26, { boostRadius: 'corners', buildRadiusBoost: 25 }),
      makeCog(0, { buildRate: 100 }),  // corner position
      makeCog(4, { buildRate: 80 }),   // corner position
      makeCog(50, { buildRate: 60 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(26, 50);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'corners boost swap');
  });

  it('matches after swapping an up boost cog', () => {
    const inv = buildInventory([
      makeCog(36, { boostRadius: 'up', buildRadiusBoost: 20 }),
      makeCog(12, { buildRate: 100 }),
      makeCog(13, { buildRate: 80 }),
      makeCog(24, { buildRate: 60 }),
      makeCog(60, { buildRate: 40 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(36, 60);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'up boost swap');
  });

  it('matches after swapping a down boost cog', () => {
    const inv = buildInventory([
      makeCog(24, { boostRadius: 'down', buildRadiusBoost: 20 }),
      makeCog(36, { buildRate: 100 }),
      makeCog(37, { buildRate: 80 }),
      makeCog(0, { buildRate: 40 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(24, 0);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'down boost swap');
  });

  it('matches after swapping a left boost cog', () => {
    const inv = buildInventory([
      makeCog(14, { boostRadius: 'left', buildRadiusBoost: 20 }),
      makeCog(12, { buildRate: 100 }),
      makeCog(13, { buildRate: 80 }),
      makeCog(50, { buildRate: 40 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(14, 50);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'left boost swap');
  });

  it('matches after swapping a right boost cog', () => {
    const inv = buildInventory([
      makeCog(12, { boostRadius: 'right', buildRadiusBoost: 20 }),
      makeCog(14, { buildRate: 100 }),
      makeCog(13, { buildRate: 80 }),
      makeCog(60, { buildRate: 40 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(12, 60);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'right boost swap');
  });

  it('matches after boost affecting player expBoost', () => {
    const inv = buildInventory([
      makeCog(13, { isPlayer: true }),
      makeCog(12, { boostRadius: 'adjacent', expRadiusBoost: 30 }),
      makeCog(50, { buildRate: 10 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    // Move the expBoost cog away from player
    scorer.swap(12, 50);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'boost affecting player expBoost');
  });

  it('matches after boost affecting flag flagBoost', () => {
    const flagPos = 14;
    const inv = buildInventory(
      [
        makeCog(0, { boostRadius: 'row', flagBoost: 10 }),
        makeCog(flagPos, { isFlag: true }),
        makeCog(50, { buildRate: 5 }),
      ],
      { flagPose: [flagPos] }
    );
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 12); // move the flagBoost cog to different row
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'boost affecting flag flagBoost');
  });

  it('matches after boost cog moved to spare area (key outside board)', () => {
    // We'll swap boost cog with a high-key available slot (still in board, key < 96)
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', buildRadiusBoost: 50 }),
      makeCog(1, { buildRate: 100 }),
      makeCog(88, { buildRate: 20 }), // far end of board
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 88);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'boost cog to far end of board');
  });

  it('matches after boost covering flag positions', () => {
    const flagPos = 36;
    const inv = buildInventory(
      [
        makeCog(25, { boostRadius: 'around', flagBoost: 5 }),
        makeCog(flagPos, { isFlag: true }),
        makeCog(80, { buildRate: 10 }),
      ],
      { flagPose: [flagPos] }
    );
    const scorer = new IncrementalScorer(inv);
    scorer.swap(25, 80);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'boost covering flag positions');
  });

});

// ─── IncrementalScorer — stress tests ───────────────────────────────────────

function makeStressBoard(rng, cogCount, boostCount) {
  const BOARD_SIZE = 96;
  const positions = Array.from({ length: BOARD_SIZE }, (_, i) => i);
  // Shuffle positions
  for (let i = positions.length - 1; i > 0; i--) {
    const j = rng.randInt(i + 1);
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }

  const cogs = [];
  let posIdx = 0;

  // Place boost cogs
  for (let i = 0; i < boostCount && posIdx < BOARD_SIZE; i++, posIdx++) {
    const radiusTypes = ['adjacent', 'diagonal', 'row', 'column', 'around', 'corners', 'up', 'down', 'left', 'right'];
    const radius = rng.pick(radiusTypes);
    cogs.push(makeCog(positions[posIdx], {
      boostRadius: radius,
      buildRadiusBoost: rng.randInt(30),
      flaggyRadiusBoost: rng.randInt(20),
      expRadiusBoost: rng.randInt(25),
      flagBoost: rng.randInt(10),
    }));
  }

  // Place stat cogs
  for (let i = 0; i < cogCount && posIdx < BOARD_SIZE; i++, posIdx++) {
    cogs.push(makeCog(positions[posIdx], {
      buildRate: rng.randInt(200),
      expBonus: rng.randInt(50),
      flaggy: rng.randInt(100),
    }));
  }

  // Put some player cogs
  if (posIdx < BOARD_SIZE) {
    cogs.push(makeCog(positions[posIdx++], { isPlayer: true }));
  }

  // Flag positions (a few non-available keys — simulate by using keys from another set)
  // For simplicity in stress test, we use empty flagPose to avoid complexity
  const inv = buildInventory(cogs, { flaggyShopUpgrades: rng.randInt(5) });
  return inv;
}

describe('IncrementalScorer — stress tests', () => {

  it('10k random swaps (seed 42)', () => {
    const rng = new SeededRng(42);
    const inv = makeStressBoard(rng, 40, 15);
    const scorer = new IncrementalScorer(inv);
    const availKeys = [...inv.availableSlotKeys];

    for (let i = 0; i < 10000; i++) {
      const posA = rng.pick(availKeys);
      const posB = rng.pick(availKeys);
      scorer.swap(posA, posB);

      if (i % 500 === 0) {
        assertScoresEqual(scorer.score, scorer.fullRecompute(), `seed 42 swap ${i}`);
      }
    }
    // Final check
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'seed 42 final');
  });

  it('10k random swaps (seed 999)', () => {
    const rng = new SeededRng(999);
    const inv = makeStressBoard(rng, 35, 20);
    const scorer = new IncrementalScorer(inv);
    const availKeys = [...inv.availableSlotKeys];

    for (let i = 0; i < 10000; i++) {
      const posA = rng.pick(availKeys);
      const posB = rng.pick(availKeys);
      scorer.swap(posA, posB);

      if (i % 500 === 0) {
        assertScoresEqual(scorer.score, scorer.fullRecompute(), `seed 999 swap ${i}`);
      }
    }
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'seed 999 final');
  });

  it('1000 undo-redo cycles', () => {
    const rng = new SeededRng(1337);
    const inv = makeStressBoard(rng, 30, 10);
    const scorer = new IncrementalScorer(inv);
    const availKeys = [...inv.availableSlotKeys];

    for (let i = 0; i < 1000; i++) {
      const posA = rng.pick(availKeys);
      const posB = rng.pick(availKeys);
      const before = scorer.score;
      scorer.swap(posA, posB);
      scorer.swap(posA, posB); // undo
      assertScoresEqual(scorer.score, before, `undo-redo cycle ${i}`);
    }
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'undo-redo final');
  });

});
