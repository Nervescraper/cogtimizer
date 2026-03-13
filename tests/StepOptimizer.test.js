const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Cog } = require('../CogInventory.js');
const { getOptimalSteps, cogsAreEquivalent } = require('../StepOptimizer.js');

// Helper: create a minimal cog with key and initialKey
function makeCog(key, initialKey, opts = {}) {
  return new Cog({
    key,
    initialKey,
    icon: opts.icon || { path: 'icons/cogs/Cog_Nooby.png' },
    buildRate: opts.buildRate || 0,
    expBonus: opts.expBonus || 0,
    flaggy: opts.flaggy || 0,
    ...opts
  });
}

// Helper: build a cogs dict from an array of Cog objects
function cogDict(cogs) {
  const dict = {};
  for (const c of cogs) {
    dict[c.key] = c;
  }
  return dict;
}

const BOARD = 'fake-board'; // getOptimalSteps passes this through without inspecting it

// Helper: simulate what stepsChangeHandler does — apply steps as position swaps.
// Returns a map of position -> initialKey showing which cog ends up where.
function replaySteps(steps, cogs) {
  // Build position -> initialKey map (each cog starts at its initialKey)
  const grid = {};
  for (const c of Object.values(cogs)) {
    grid[c.initialKey] = c.initialKey;
  }
  // Apply each step as a swap of two positions
  for (const step of steps) {
    const temp = grid[step.keyFrom];
    grid[step.keyFrom] = grid[step.keyTo];
    grid[step.keyTo] = temp;
  }
  return grid;
}

describe('getOptimalSteps — baseline behavior', () => {

  it('returns empty array when no cogs moved', () => {
    const cogs = cogDict([
      makeCog(0, 0),
      makeCog(1, 1),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 0);
  });

  it('returns 1 step for a single cog moved to an empty slot', () => {
    // Cog was at key 0, now at key 5
    const cogs = cogDict([
      makeCog(5, 0),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].keyFrom, 0);
    assert.strictEqual(steps[0].keyTo, 5);
    // targetCog is a synthetic fallback since nothing is at the destination in interimCogs
    assert.strictEqual(steps[0].targetCog.icon, 'Blank');
  });

  it('returns 1 step for a 2-cycle (two cogs swapped)', () => {
    // Cog A was at 0, now at 1. Cog B was at 1, now at 0. Different stats so not eliminated.
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10 }),
      makeCog(0, 1, { buildRate: 20 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
  });

  it('returns 2 steps for a 3-cycle', () => {
    // A: 0->1, B: 1->2, C: 2->0
    const cogs = cogDict([
      makeCog(1, 0),
      makeCog(2, 1),
      makeCog(0, 2),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 2);
  });

  it('returns 2 steps for two independent 2-cycles', () => {
    // Cycle 1: A(0->1), B(1->0). Cycle 2: C(10->11), D(11->10). Different stats so not eliminated.
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10 }),
      makeCog(0, 1, { buildRate: 20 }),
      makeCog(11, 10, { buildRate: 30 }),
      makeCog(10, 11, { buildRate: 40 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 2);
  });

  it('excludes unmoved cog among moved cogs', () => {
    // Cog A unmoved at key 0, Cog B moved from 1 to 2
    const cogs = cogDict([
      makeCog(0, 0),
      makeCog(2, 1),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].keyFrom, 1);
    assert.strictEqual(steps[0].keyTo, 2);
  });

  it('each step has the expected shape', () => {
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10 }),
      makeCog(0, 1, { buildRate: 20 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
    const step = steps[0];
    assert.strictEqual(step.board, BOARD);
    assert.ok(step.cog instanceof Cog);
    assert.ok('keyFrom' in step);
    assert.ok('keyTo' in step);
    assert.ok('targetCog' in step);
  });

});

describe('getOptimalSteps — replay correctness', () => {

  it('3-cycle: applying steps in order produces the solved permutation', () => {
    // Solved state: A at 1 (was 0), B at 2 (was 1), C at 0 (was 2)
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10 }),
      makeCog(2, 1, { buildRate: 20 }),
      makeCog(0, 2, { buildRate: 30 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 2);

    // Replay: grid[position] = initialKey of the cog now at that position
    const grid = replaySteps(steps, cogs);
    // After replay, each solved position should contain the cog that moved there
    for (const c of Object.values(cogs)) {
      assert.strictEqual(grid[c.key], c.initialKey,
        `Position ${c.key} should contain cog from ${c.initialKey}, got cog from ${grid[c.key]}`);
    }
  });

  it('two independent 2-cycles: replay produces correct final state', () => {
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10 }),
      makeCog(0, 1, { buildRate: 20 }),
      makeCog(11, 10, { buildRate: 30 }),
      makeCog(10, 11, { buildRate: 40 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 2);

    const grid = replaySteps(steps, cogs);
    for (const c of Object.values(cogs)) {
      assert.strictEqual(grid[c.key], c.initialKey,
        `Position ${c.key} should contain cog from ${c.initialKey}, got cog from ${grid[c.key]}`);
    }
  });

  it('4-cycle: produces 3 steps and replay is correct', () => {
    // A: 0->1, B: 1->2, C: 2->3, D: 3->0
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10 }),
      makeCog(2, 1, { buildRate: 20 }),
      makeCog(3, 2, { buildRate: 30 }),
      makeCog(0, 3, { buildRate: 40 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 3);

    const grid = replaySteps(steps, cogs);
    for (const c of Object.values(cogs)) {
      assert.strictEqual(grid[c.key], c.initialKey,
        `Position ${c.key} should contain cog from ${c.initialKey}, got cog from ${grid[c.key]}`);
    }
  });

  it('cog properties are preserved through steps', () => {
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10, expBonus: 5, flaggy: 3 }),
      makeCog(0, 1, { buildRate: 20, expBonus: 15, flaggy: 7 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
    const step = steps[0];
    // The step's cog should have the properties of the cog that was originally at keyFrom
    assert.strictEqual(step.cog.buildRate, 10);
    assert.strictEqual(step.cog.expBonus, 5);
    assert.strictEqual(step.cog.flaggy, 3);
  });

  it('board reference is the exact object passed in', () => {
    const boardObj = { id: 'test-board-ref' };
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10 }),
      makeCog(0, 1, { buildRate: 20 }),
    ]);
    const steps = getOptimalSteps(boardObj, cogs);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].board, boardObj); // exact reference, not a copy
  });

});

describe('cogsAreEquivalent', () => {

  it('returns true for identical non-boost cogs', () => {
    const a = makeCog(0, 0, { buildRate: 10, expBonus: 5, flaggy: 3, icon: { path: 'icons/cogs/Cog_Nooby.png' } });
    const b = makeCog(1, 1, { buildRate: 10, expBonus: 5, flaggy: 3, icon: { path: 'icons/cogs/Cog_Nooby.png' } });
    assert.strictEqual(cogsAreEquivalent(a, b), true);
  });

  it('returns false for different buildRate', () => {
    const a = makeCog(0, 0, { buildRate: 10 });
    const b = makeCog(1, 1, { buildRate: 20 });
    assert.strictEqual(cogsAreEquivalent(a, b), false);
  });

  it('returns false for different expBonus', () => {
    const a = makeCog(0, 0, { expBonus: 5 });
    const b = makeCog(1, 1, { expBonus: 10 });
    assert.strictEqual(cogsAreEquivalent(a, b), false);
  });

  it('returns false for different flaggy', () => {
    const a = makeCog(0, 0, { flaggy: 3 });
    const b = makeCog(1, 1, { flaggy: 7 });
    assert.strictEqual(cogsAreEquivalent(a, b), false);
  });

  it('returns false for different icon.path', () => {
    const a = makeCog(0, 0, { icon: { path: 'icons/cogs/Cog_Nooby.png' } });
    const b = makeCog(1, 1, { icon: { path: 'icons/cogs/Spur_Decent.png' } });
    assert.strictEqual(cogsAreEquivalent(a, b), false);
  });

  it('returns false when one has boostRadius', () => {
    const a = makeCog(0, 0, { boostRadius: 'adjacent' });
    const b = makeCog(1, 1);
    assert.strictEqual(cogsAreEquivalent(a, b), false);
  });

  it('returns false when both have boostRadius', () => {
    const a = makeCog(0, 0, { boostRadius: 'adjacent' });
    const b = makeCog(1, 1, { boostRadius: 'adjacent' });
    assert.strictEqual(cogsAreEquivalent(a, b), false);
  });

  it('returns false when one is a player', () => {
    const a = makeCog(0, 0, { isPlayer: true });
    const b = makeCog(1, 1);
    assert.strictEqual(cogsAreEquivalent(a, b), false);
  });

  it('returns false when one is a flag', () => {
    const a = makeCog(0, 0, { isFlag: true });
    const b = makeCog(1, 1);
    assert.strictEqual(cogsAreEquivalent(a, b), false);
  });

  it('handles string icon "Blank" — returns true if stats match', () => {
    const a = makeCog(0, 0, { icon: 'Blank' });
    const b = makeCog(1, 1, { icon: 'Blank' });
    assert.strictEqual(cogsAreEquivalent(a, b), true);
  });

});

describe('getOptimalSteps — equivalence elimination', () => {

  it('eliminates swap of two identical cogs', () => {
    // A and B have identical stats/icon, swapped positions — should produce 0 steps
    const icon = { path: 'icons/cogs/Cog_Nooby.png' };
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10, expBonus: 5, flaggy: 3, icon }),
      makeCog(0, 1, { buildRate: 10, expBonus: 5, flaggy: 3, icon }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 0);
  });

  it('keeps swap of two different cogs', () => {
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10 }),
      makeCog(0, 1, { buildRate: 20 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
  });

  it('preserves 3-cycle even when two cogs in it are identical', () => {
    // A(0->1), B(1->2), C(2->0). A and B are identical but this is a 3-cycle, not a 2-swap.
    const icon = { path: 'icons/cogs/Cog_Nooby.png' };
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10, icon }),
      makeCog(2, 1, { buildRate: 10, icon }),
      makeCog(0, 2, { buildRate: 30 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 2);
  });

  it('eliminates one pair while keeping other moves', () => {
    // Pair: A(0->1) and B(1->0) are identical — eliminated
    // Move: C(10->11) is a real move — kept
    const icon = { path: 'icons/cogs/Cog_Nooby.png' };
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10, icon }),
      makeCog(0, 1, { buildRate: 10, icon }),
      makeCog(11, 10, { buildRate: 50 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].keyFrom, 10);
    assert.strictEqual(steps[0].keyTo, 11);
  });

});
