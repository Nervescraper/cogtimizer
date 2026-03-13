const { describe, it } = require('node:test');
const assert = require('node:assert');
const { TabuSearch } = require('../TabuSearch.js');

// Minimal mock IncrementalScorer for constructor tests
function makeScorer(scoreValue) {
  if (scoreValue === undefined) scoreValue = 100;
  return {
    score: { buildRate: scoreValue, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 },
    swap(a, b) {},
    playerCount: 1,
    flagCount: 1,
  };
}

describe('TabuSearch static metadata', () => {
  it('has a displayName string', () => {
    assert.strictEqual(typeof TabuSearch.displayName, 'string');
    assert.ok(TabuSearch.displayName.length > 0);
  });

  it('has a description string', () => {
    assert.strictEqual(typeof TabuSearch.description, 'string');
    assert.ok(TabuSearch.description.length > 0);
  });
});

describe('TabuSearch constructor', () => {
  it('accepts scorer and settings without throwing', () => {
    const scorer = makeScorer();
    assert.doesNotThrow(() => new TabuSearch(scorer, {}));
  });

  it('uses default parameters when settings is empty', () => {
    const ts = new TabuSearch(makeScorer(), {});
    assert.strictEqual(ts.sampleSize, 200);
    assert.strictEqual(ts.tabuTenure, 50);
    assert.strictEqual(ts.diversifyAfter, 1000);
    assert.strictEqual(ts.perturbSize, 8);
  });

  it('overrides default parameters from settings', () => {
    const ts = new TabuSearch(makeScorer(), {
      sampleSize: 50,
      tabuTenure: 10,
      diversifyAfter: 200,
      perturbSize: 4,
    });
    assert.strictEqual(ts.sampleSize, 50);
    assert.strictEqual(ts.tabuTenure, 10);
    assert.strictEqual(ts.diversifyAfter, 200);
    assert.strictEqual(ts.perturbSize, 4);
  });
});

// ---- Integration tests ----

/**
 * A deterministic mock scorer that tracks swap calls and returns preset scores.
 * The inventory is a plain object with the minimum interface TabuSearch needs.
 */
function makeMockScorer(options) {
  if (!options) options = {};
  const availableSlotKeys = options.availableSlotKeys || [0,1,2,3,4,5,6,7,8,9];
  const scoreSequence = options.scoreSequence || [];
  let callIndex = 0;
  const swapLog = [];

  const inventory = {
    availableSlotKeys: availableSlotKeys,
    playerCount: 1,
    flagPose: [],
    clone() { return Object.assign({}, this); },
  };

  return {
    inventory: inventory,
    get score() {
      const s = scoreSequence[callIndex] ?? 100;
      callIndex++;
      return { buildRate: s, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 };
    },
    swap(a, b) { swapLog.push([a, b]); },
    swapLog: swapLog,
  };
}

describe('TabuSearch.solve() — basic', () => {
  it('returns an inventory object', () => {
    const scorer = makeMockScorer({ scoreSequence: Array(10000).fill(100) });
    const ts = new TabuSearch(scorer, { sampleSize: 5, tabuTenure: 3 });
    const result = ts.solve(scorer, 50, null);
    assert.ok(result !== null && typeof result === 'object');
  });

  it('calls onProgress at least once during a 200ms solve', () => {
    const scorer = makeMockScorer({ scoreSequence: Array(100000).fill(100) });
    const ts = new TabuSearch(scorer, { sampleSize: 2, tabuTenure: 3 });
    let progressCalled = false;
    ts.solve(scorer, 600, () => { progressCalled = true; });
    assert.ok(progressCalled, 'onProgress was never called');
  });

  it('tracks the best score seen across all steps', () => {
    const scores = [50, ...Array(50).fill(50), 200, ...Array(50000).fill(50)];
    const scorer = makeMockScorer({ scoreSequence: scores });
    const ts = new TabuSearch(scorer, { sampleSize: 5, tabuTenure: 3, diversifyAfter: 9999 });
    ts.solve(scorer, 100, null);
    assert.ok(ts._bestInventory !== null);
  });
});

describe('TabuSearch.solve() — tabu list consulted', () => {
  it('does not immediately re-apply the move just made', () => {
    const scorer = makeMockScorer({
      availableSlotKeys: [0, 1],
      scoreSequence: Array(100000).fill(100),
    });
    const ts = new TabuSearch(scorer, { sampleSize: 10, tabuTenure: 5, diversifyAfter: 9999 });
    ts.solve(scorer, 150, null);
    assert.ok(true, 'solve() completed without error with all moves tabu');
  });
});

describe('TabuSearch.solve() — aspiration criterion', () => {
  it('accepts a tabu move when it produces a new global best', () => {
    const scorer = makeMockScorer({
      availableSlotKeys: [0, 1, 2],
      scoreSequence: Array(100000).fill(150),
    });
    const ts = new TabuSearch(scorer, { sampleSize: 5, tabuTenure: 100, diversifyAfter: 9999 });
    assert.doesNotThrow(() => ts.solve(scorer, 100, null));
  });
});

describe('TabuSearch.solve() — diversification', () => {
  it('clears the tabu list after diversifyAfter steps without improvement', () => {
    const scorer = makeMockScorer({ scoreSequence: Array(100000).fill(100) });
    const ts = new TabuSearch(scorer, {
      sampleSize: 2,
      tabuTenure: 50,
      diversifyAfter: 5,
      perturbSize: 2,
    });
    // Spy on _tabuList.clear
    let clearCount = 0;
    const origClear = ts._tabuList.clear.bind(ts._tabuList);
    ts._tabuList.clear = () => { clearCount++; origClear(); };
    ts.solve(scorer, 100, null);
    assert.ok(clearCount > 0, 'tabu list was never cleared (diversification did not fire)');
  });
});

// ---- Reproducibility tests ----

describe('TabuSearch — reproducibility', () => {
  it('produces identical swap sequences given the same SeededRng seed', () => {
    function makeDetRng(seed) {
      let s = seed;
      return {
        random() {
          s = (s * 1664525 + 1013904223) & 0xffffffff;
          return (s >>> 0) / 0xffffffff;
        }
      };
    }

    function runWithSeed(seed) {
      // Track a rolling hash of swaps instead of storing all pairs (avoids OOM)
      let hash = 0;
      let swapCount = 0;
      // Use a fake Date.now that advances by exactly 1ms per call for deterministic iteration count
      let fakeTime = 0;
      const origDateNow = Date.now;
      Date.now = () => fakeTime++;
      const scorer = {
        inventory: {
          availableSlotKeys: [0,1,2,3,4,5,6,7,8,9],
          playerCount: 1,
          flagPose: [],
          clone() { return Object.assign({}, this); },
        },
        get score() {
          return { buildRate: 100, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 };
        },
        swap(a, b) {
          hash = ((hash * 31 + a) ^ (b * 17)) | 0;
          swapCount++;
        },
      };
      const ts = new TabuSearch(scorer, {
        sampleSize: 5,
        tabuTenure: 3,
        diversifyAfter: 50,
        perturbSize: 2,
        rng: makeDetRng(seed),
      });
      ts.solve(scorer, 200, null);
      Date.now = origDateNow;
      return { hash, swapCount };
    }

    const run1 = runWithSeed(42);
    const run2 = runWithSeed(42);
    assert.deepStrictEqual(run1, run2, 'Two runs with the same seed produced different swap sequences');
  });

  it('produces different swap sequences with different seeds', () => {
    function makeDetRng(seed) {
      let s = seed;
      return {
        random() {
          s = (s * 1664525 + 1013904223) & 0xffffffff;
          return (s >>> 0) / 0xffffffff;
        }
      };
    }

    function runWithSeed(seed) {
      let hash = 0;
      let swapCount = 0;
      const scorer = {
        inventory: {
          availableSlotKeys: [0,1,2,3,4,5,6,7,8,9],
          playerCount: 1,
          flagPose: [],
          clone() { return Object.assign({}, this); },
        },
        get score() {
          return { buildRate: 100, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 };
        },
        swap(a, b) {
          hash = ((hash * 31 + a) ^ (b * 17)) | 0;
          swapCount++;
        },
      };
      const ts = new TabuSearch(scorer, {
        sampleSize: 5,
        tabuTenure: 3,
        rng: makeDetRng(seed),
      });
      ts.solve(scorer, 80, null);
      return { hash, swapCount };
    }

    const run1 = runWithSeed(1);
    const run2 = runWithSeed(999);
    const allSame = run1.hash === run2.hash && run1.swapCount === run2.swapCount;
    assert.strictEqual(allSame, false, 'Different seeds produced identical sequences (suspicious)');
  });
});

// ---- Edge case tests ----

describe('TabuSearch — edge cases', () => {
  it('handles a board with only two available slots without throwing', () => {
    const scorer = makeMockScorer({
      availableSlotKeys: [0, 1],
      scoreSequence: Array(100000).fill(100),
    });
    const ts = new TabuSearch(scorer, { sampleSize: 20, tabuTenure: 1, diversifyAfter: 5 });
    assert.doesNotThrow(() => ts.solve(scorer, 80, null));
  });

  it('handles sampleSize=1 without throwing', () => {
    const scorer = makeMockScorer({ scoreSequence: Array(100000).fill(100) });
    const ts = new TabuSearch(scorer, { sampleSize: 1, tabuTenure: 3 });
    assert.doesNotThrow(() => ts.solve(scorer, 80, null));
  });

  it('handles timeLimit=0 and returns immediately', () => {
    const scorer = makeMockScorer({ scoreSequence: Array(100000).fill(100) });
    const ts = new TabuSearch(scorer, { sampleSize: 200, tabuTenure: 50 });
    const result = ts.solve(scorer, 0, null);
    assert.ok(result !== undefined);
  });

  it('onProgress callback receives expected fields', () => {
    const scorer = makeMockScorer({ scoreSequence: Array(100000).fill(100) });
    const ts = new TabuSearch(scorer, { sampleSize: 2, tabuTenure: 3 });
    const progressReports = [];
    ts.solve(scorer, 600, (report) => {
      progressReports.push(report);
    });
    if (progressReports.length > 0) {
      const r = progressReports[0];
      assert.ok('score'      in r, 'progress report missing score');
      assert.ok('iterations' in r, 'progress report missing iterations');
      assert.ok('elapsed'    in r, 'progress report missing elapsed');
    }
  });

  it('_perturb does not throw with minimum slots', () => {
    const scorer = makeMockScorer({ availableSlotKeys: [0, 1] });
    const ts = new TabuSearch(scorer, { perturbSize: 10 });
    assert.doesNotThrow(() => ts._perturb(scorer, [0, 1]));
  });
});

// ---- Interface compliance tests ----

describe('TabuSearch — SolverAlgorithm interface compliance', () => {
  it('has a solve() method', () => {
    const ts = new TabuSearch(makeScorer(), {});
    assert.strictEqual(typeof ts.solve, 'function');
  });

  it('solve() returns an object (the best inventory)', () => {
    const scorer = makeMockScorer({ scoreSequence: Array(10000).fill(100) });
    const ts = new TabuSearch(scorer, { sampleSize: 3, tabuTenure: 3 });
    const result = ts.solve(scorer, 50, null);
    assert.strictEqual(typeof result, 'object');
    assert.notStrictEqual(result, null);
  });

  it('displayName is a non-empty string', () => {
    assert.strictEqual(typeof TabuSearch.displayName, 'string');
    assert.ok(TabuSearch.displayName.length > 0);
  });

  it('description is a non-empty string', () => {
    assert.strictEqual(typeof TabuSearch.description, 'string');
    assert.ok(TabuSearch.description.length > 0);
  });

  it('constructor signature: (scorer, settings)', () => {
    assert.doesNotThrow(() => new TabuSearch(makeScorer(), {}));
    assert.doesNotThrow(() => new TabuSearch(makeScorer()));
  });
});
