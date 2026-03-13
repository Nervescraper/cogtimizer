const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { SimulatedAnnealing, SA_DEFAULTS } = require('../SimulatedAnnealing.js');
const { makeCog, buildInventory } = require('./helpers.js');
const { getScoreSum } = require('../Solver.js');
const { IncrementalScorer } = require('../IncrementalScorer.js');
const { SeededRng } = require('../SeededRng.js');
const { deserialize } = require('../Serializer.js');

// Minimal mock IncrementalScorer for unit tests that don't need real scoring
function makeMockScorer(inventory) {
  return {
    inventory,
    score: { buildRate: 0, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 },
    swap(a, b) {},
    fullRecompute() {
      return { buildRate: 0, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 };
    }
  };
}

// Minimal scorer that returns a controllable score
function makeFixedScorer(inventory, scoreValue) {
  return {
    inventory,
    score: { buildRate: scoreValue, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 },
    swap(a, b) {},
    fullRecompute() {
      return { buildRate: scoreValue, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 };
    }
  };
}

// ---- Chunk 1: Scaffolding ----

describe('SimulatedAnnealing — constructor', () => {
  it('can be instantiated with a scorer and default settings', () => {
    const inv = buildInventory([makeCog(0, { buildRate: 10 })]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, {});
    assert.ok(sa instanceof SimulatedAnnealing);
  });

  it('merges provided settings with defaults', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { staleLimit: 999 });
    assert.strictEqual(sa.settings.staleLimit, 999);
    assert.strictEqual(sa.settings.coolingTarget, SA_DEFAULTS.coolingTarget);
    assert.strictEqual(sa.settings.reheatFactor, SA_DEFAULTS.reheatFactor);
    assert.strictEqual(sa.settings.boardSpareRatio, SA_DEFAULTS.boardSpareRatio);
  });

  it('exposes displayName and description static properties', () => {
    assert.strictEqual(typeof SimulatedAnnealing.displayName, 'string');
    assert.ok(SimulatedAnnealing.displayName.length > 0);
    assert.strictEqual(typeof SimulatedAnnealing.description, 'string');
    assert.ok(SimulatedAnnealing.description.length > 0);
  });
});

describe('SA_DEFAULTS', () => {
  it('has all required settings keys with sensible values', () => {
    assert.strictEqual(typeof SA_DEFAULTS.coolingTarget, 'number');
    assert.ok(SA_DEFAULTS.coolingTarget > 0 && SA_DEFAULTS.coolingTarget < 1);
    assert.strictEqual(typeof SA_DEFAULTS.staleLimit, 'number');
    assert.ok(SA_DEFAULTS.staleLimit > 0);
    assert.strictEqual(typeof SA_DEFAULTS.reheatFactor, 'number');
    assert.ok(SA_DEFAULTS.reheatFactor > 0 && SA_DEFAULTS.reheatFactor < 1);
    assert.strictEqual(typeof SA_DEFAULTS.boardSpareRatio, 'number');
    assert.ok(SA_DEFAULTS.boardSpareRatio > 0 && SA_DEFAULTS.boardSpareRatio < 1);
  });
});

// ---- Chunk 2: Scoring integration ----

describe('SimulatedAnnealing — _computeInitialTemp', () => {
  it('returns a positive temperature proportional to score magnitude', () => {
    const inv = buildInventory([makeCog(0, { buildRate: 1000 })]);
    const scorer = makeFixedScorer(inv, 1000);
    const sa = new SimulatedAnnealing(scorer, {});
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const temp = sa._computeInitialTemp(scorer.score, weights, null, 10, 1);
    assert.ok(temp > 0, 'temperature should be positive');
    assert.ok(temp < 1e9, 'temperature should not be absurdly large');
  });

  it('returns a small temperature when score is near zero (target mode)', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeFixedScorer(inv, 0);
    const sa = new SimulatedAnnealing(scorer, {});
    // In target mode, scores are 0-1, so temp should be scaled accordingly
    const temp = sa._computeInitialTemp(scorer.score, null, { buildRate: 100, expBonus: 0, flaggy: 0 }, 10, 1);
    assert.ok(temp > 0 && temp <= 0.1, `temp ${temp} should be in (0, 0.1] for target mode`);
  });

  it('has a minimum floor so it never returns zero', () => {
    const inv = buildInventory([]);
    const scorer = makeFixedScorer(inv, 0);
    const sa = new SimulatedAnnealing(scorer, {});
    const temp = sa._computeInitialTemp(scorer.score, { buildRate: 0, expBonus: 0, flaggy: 0 }, null, 10, 1);
    assert.ok(temp > 0, 'temperature must always be positive');
  });
});

// ---- Chunk 3: Neighborhood operators ----

describe('SimulatedAnnealing — _pickMove', () => {
  // Build a minimal board: positions 0-5 on board, 108-110 as spare
  function makeTestInventory() {
    const cogs = [
      makeCog(0, { buildRate: 10 }),
      makeCog(1, { buildRate: 5 }),
      makeCog(2, { expBonus: 8 }),
      makeCog(3, { flaggy: 3 }),
      makeCog(108, { buildRate: 1 }),
      makeCog(109, { buildRate: 2 }),
    ];
    return buildInventory(cogs, { availableSlotKeys: [0, 1, 2, 3, 4, 5] });
  }

  it('always returns two different positions', () => {
    const inv = makeTestInventory();
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, {});
    const rng = new SeededRng(42);
    for (let i = 0; i < 50; i++) {
      const [posA, posB] = sa._pickMove(inv, rng);
      assert.notStrictEqual(posA, posB, `move ${i}: posA and posB must differ`);
    }
  });

  it('never picks a fixed cog', () => {
    const cogs = [
      makeCog(0, { buildRate: 10, fixed: true }),
      makeCog(1, { buildRate: 5 }),
      makeCog(2, { expBonus: 8 }),
    ];
    const inv = buildInventory(cogs, { availableSlotKeys: [0, 1, 2] });
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, {});
    const rng = new SeededRng(42);
    for (let i = 0; i < 100; i++) {
      const [posA, posB] = sa._pickMove(inv, rng);
      const cogA = inv.get(posA);
      const cogB = inv.get(posB);
      assert.ok(!cogA || !cogA.fixed, `posA ${posA}: should not pick a fixed cog`);
      assert.ok(!cogB || !cogB.fixed, `posB ${posB}: should not pick a fixed cog`);
    }
  });

  it('produces board-spare swaps roughly 30% of the time', () => {
    const inv = makeTestInventory();
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { boardSpareRatio: 0.3 });
    const rng = new SeededRng(123);
    let spareSwaps = 0;
    const TRIALS = 1000;
    for (let i = 0; i < TRIALS; i++) {
      const [posA, posB] = sa._pickMove(inv, rng);
      if (posB >= 108 || posA >= 108) spareSwaps++;
    }
    const ratio = spareSwaps / TRIALS;
    // Allow +/-10% tolerance around the 30% target
    assert.ok(ratio > 0.20 && ratio < 0.40,
      `board-spare ratio ${ratio.toFixed(2)} should be near 0.30`);
  });
});

// ---- Chunk 4: Adaptive cooling ----

describe('SimulatedAnnealing — _adaptCooling', () => {
  it('decreases cooling rate (cools faster) when acceptance is above target', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { coolingTarget: 0.30 });
    const initialRate = 0.9997;
    // Acceptance 0.70 > target 0.30 -> should cool faster -> smaller rate
    const newRate = sa._adaptCooling(initialRate, 0.70, 0.30);
    assert.ok(newRate < initialRate,
      `rate should decrease when acceptance ${0.70} > target ${0.30}`);
  });

  it('increases cooling rate (cools slower) when acceptance is below target', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { coolingTarget: 0.30 });
    const initialRate = 0.9997;
    // Acceptance 0.05 < target 0.30 -> should cool slower -> larger rate
    const newRate = sa._adaptCooling(initialRate, 0.05, 0.30);
    assert.ok(newRate > initialRate,
      `rate should increase when acceptance ${0.05} < target ${0.30}`);
  });

  it('keeps rate within safe bounds [0.99, 0.9999]', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { coolingTarget: 0.30 });
    // Extreme acceptance values should not push rate outside bounds
    const tooHigh = sa._adaptCooling(0.9997, 1.0, 0.30);
    assert.ok(tooHigh >= 0.99 && tooHigh <= 0.9999, `rate ${tooHigh} out of bounds`);
    const tooLow = sa._adaptCooling(0.9997, 0.0, 0.30);
    assert.ok(tooLow >= 0.99 && tooLow <= 0.9999, `rate ${tooLow} out of bounds`);
  });

  it('does not change rate when acceptance matches target exactly', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { coolingTarget: 0.30 });
    const initialRate = 0.9997;
    const newRate = sa._adaptCooling(initialRate, 0.30, 0.30);
    // Allow tiny floating point tolerance
    assert.ok(Math.abs(newRate - initialRate) < 1e-6,
      `rate should be unchanged when acceptance equals target`);
  });
});

// ---- Chunk 5: Reheat strategy ----

describe('SimulatedAnnealing — _shouldReheat and _applyReheat', () => {
  it('_shouldReheat returns false before staleLimit is reached', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { staleLimit: 5000 });
    assert.strictEqual(sa._shouldReheat(4999), false);
  });

  it('_shouldReheat returns true at exactly staleLimit', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { staleLimit: 5000 });
    assert.strictEqual(sa._shouldReheat(5000), true);
  });

  it('_shouldReheat returns true beyond staleLimit', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { staleLimit: 5000 });
    assert.strictEqual(sa._shouldReheat(7000), true);
  });

  it('_applyReheat returns reheatFactor * initialTemp', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { reheatFactor: 0.5 });
    const initialTemp = 1000;
    const newTemp = sa._applyReheat(initialTemp);
    assert.strictEqual(newTemp, 500);
  });

  it('_applyReheat with factor 0.5 halves the initial temperature', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { reheatFactor: 0.5 });
    const newTemp = sa._applyReheat(2000);
    assert.strictEqual(newTemp, 1000);
  });
});

// ---- Chunk 6: Single SA step ----

describe('SimulatedAnnealing — _step', () => {
  // A board with two cogs where we know which placement is better
  function makeTwoCogBoard() {
    const cogs = [
      makeCog(0, { buildRate: 100 }),
      makeCog(1, { buildRate: 1 }),
    ];
    return buildInventory(cogs, { availableSlotKeys: [0, 1] });
  }

  it('always returns an object with accepted (boolean) and newScalar (number)', () => {
    const inv = makeTwoCogBoard();
    const scorer = new IncrementalScorer(inv);
    scorer.fullRecompute();
    const sa = new SimulatedAnnealing(scorer, {});
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const rng = new SeededRng(42);
    const currentScalar = getScoreSum(scorer.score, weights, null, 10, 1);
    const result = sa._step(inv, weights, null, 10, 1, 0.001, rng, currentScalar);
    assert.strictEqual(typeof result.accepted, 'boolean');
    assert.strictEqual(typeof result.newScalar, 'number');
  });

  it('with near-zero temp, score should not decrease much below initial', () => {
    const inv = makeTwoCogBoard();
    const scorer = new IncrementalScorer(inv);
    scorer.fullRecompute();
    const sa = new SimulatedAnnealing(scorer, {});
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const rng = new SeededRng(42);
    const scoreBefore = getScoreSum(scorer.score, weights, null, 10, 1);
    let currentScalar = scoreBefore;
    let minScore = scoreBefore;
    for (let i = 0; i < 200; i++) {
      const result = sa._step(inv, weights, null, 10, 1, 0.0001, rng, currentScalar);
      currentScalar = result.newScalar;
      minScore = Math.min(minScore, currentScalar);
    }
    // With near-zero temp, score should never drop much below initial
    assert.ok(minScore >= scoreBefore - 5,
      `score ${minScore} should not drop far below initial ${scoreBefore}`);
  });
});

// ---- Chunk 7: Full solve loop ----

describe('SimulatedAnnealing — solve()', () => {
  it('returns a CogInventory', () => {
    const cogs = [
      makeCog(0, { buildRate: 10 }),
      makeCog(1, { buildRate: 5 }),
      makeCog(2, { buildRate: 3 }),
    ];
    const inv = buildInventory(cogs, { availableSlotKeys: [0, 1, 2] });
    const scorer = new IncrementalScorer(inv);
    const sa = new SimulatedAnnealing(scorer, {});
    const result = sa.solve(inv, 200, () => {});
    assert.ok(result, 'should return a value');
    assert.ok(typeof result === 'object', 'should return an object (CogInventory)');
  });

  it('calls onProgress at least once during a 500ms run', (t, done) => {
    const cogs = [
      makeCog(0, { buildRate: 10 }),
      makeCog(1, { buildRate: 5 }),
      makeCog(2, { expBonus: 8 }),
      makeCog(3, { flaggy: 3 }),
    ];
    const inv = buildInventory(cogs, { availableSlotKeys: [0, 1, 2, 3] });
    const scorer = new IncrementalScorer(inv);
    const sa = new SimulatedAnnealing(scorer, {});
    let progressCalled = false;
    const result = sa.solve(inv, 600, (info) => {
      progressCalled = true;
      assert.ok(typeof info.score === 'number', 'progress.score should be a number');
      assert.ok(typeof info.iterations === 'number', 'progress.iterations should be a number');
      assert.ok(typeof info.elapsed === 'number', 'progress.elapsed should be a number');
    });
    assert.ok(progressCalled, 'onProgress should have been called at least once');
    done();
  });

  it('returns a result with score >= initial score', () => {
    const cogs = [
      makeCog(0, { buildRate: 10 }),
      makeCog(1, { buildRate: 5 }),
      makeCog(2, { expBonus: 8 }),
      makeCog(3, { flaggy: 3 }),
    ];
    const inv = buildInventory(cogs, { availableSlotKeys: [0, 1, 2, 3] });
    const scorer = new IncrementalScorer(inv);
    scorer.fullRecompute();
    const weights = { buildRate: 1, expBonus: 1, flaggy: 1 };
    const sa = new SimulatedAnnealing(scorer, {});
    const initialScalar = getScoreSum(scorer.score, weights, null, 10, 1);
    const result = sa.solve(inv, 300, () => {});
    const resultScorer = new IncrementalScorer(result);
    resultScorer.fullRecompute();
    const resultScalar = getScoreSum(resultScorer.score, weights, null, 10, 1);
    assert.ok(resultScalar >= initialScalar,
      `result score ${resultScalar} should be >= initial ${initialScalar}`);
  });

  it('is deterministic given the same seed', () => {
    const cogs = [
      makeCog(0, { buildRate: 10 }),
      makeCog(1, { buildRate: 5 }),
      makeCog(2, { expBonus: 8 }),
      makeCog(3, { flaggy: 3 }),
    ];
    const makeRun = () => {
      const inv = buildInventory(cogs, { availableSlotKeys: [0, 1, 2, 3] });
      const scorer = new IncrementalScorer(inv);
      scorer.fullRecompute();
      const sa = new SimulatedAnnealing(scorer, { seed: 42 });
      return sa.solve(inv, 300, () => {});
    };
    const result1 = makeRun();
    const result2 = makeRun();
    // Both runs should produce the same final cog placement
    for (const key of Object.keys(result1.cogs)) {
      assert.strictEqual(result1.cogs[key].key, result2.cogs[key].key,
        `cog at key ${key} differs between runs`);
    }
  });
});

// Fixture-based integration tests removed — the JSON fixture files contain raw game data
// (not serialized CogInventory format), so they cannot be deserialized with Serializer.
// Re-add these tests once a game-data parser or pre-serialized fixtures are available.
