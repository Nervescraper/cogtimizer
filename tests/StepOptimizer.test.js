const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Cog } = require('../CogInventory.js');
const { getOptimalSteps } = require('../StepOptimizer.js');

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
    // Cog A was at 0, now at 1. Cog B was at 1, now at 0.
    const cogs = cogDict([
      makeCog(1, 0),
      makeCog(0, 1),
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
    // Cycle 1: A(0->1), B(1->0). Cycle 2: C(10->11), D(11->10).
    const cogs = cogDict([
      makeCog(1, 0),
      makeCog(0, 1),
      makeCog(11, 10),
      makeCog(10, 11),
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
