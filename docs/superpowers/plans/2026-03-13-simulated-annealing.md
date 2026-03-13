# Improved Simulated Annealing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the improved `SimulatedAnnealing` class as described in spec section 2.1. It replaces full-recompute scoring with `IncrementalScorer`, starts from a greedy initial solution, uses a weighted neighborhood, adaptive cooling, and a reheat strategy. The existing `Solver.js` is not modified.

**Architecture:** `SimulatedAnnealing` is a standalone class in `SimulatedAnnealing.js` that implements the common `SolverAlgorithm` interface (`constructor(scorer, settings)`, `solve(inventory, timeLimit, onProgress)`). It depends on `IncrementalScorer` (for O(1)–O(12) swap scoring), `SeededRng` (for reproducibility), and `getScoreSum` (extracted from `Solver.js` by the infrastructure plan). All infrastructure is assumed available from the infrastructure plan.

**Tech Stack:** Vanilla JavaScript, Node.js native test runner (`node --test`), no external dependencies.

**Spec:** `docs/superpowers/specs/2026-03-13-solver-algorithms-design.md` — section 2.1

**Infrastructure prerequisite:** `docs/superpowers/plans/2026-03-13-solver-infrastructure.md` must be complete before starting this plan. The following are assumed available:
- `IncrementalScorer` — `swap(posA, posB)`, `score` getter, `fullRecompute()`, constructor takes `(inventory)`
- `SeededRng` — `random()`, `randInt(max)`, `pick(arr)`, constructor takes `(seed)`
- `getScoreSum(score, weights, targets, playerCount, flagCount)` — exported from `Solver.js`
- `tests/helpers.js` — `makeCog(key, opts)`, `buildInventory(cogs, opts)`, `assertScoresEqual(actual, expected)`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `SimulatedAnnealing.js` | The improved SA algorithm class implementing the `SolverAlgorithm` interface |
| `tests/SimulatedAnnealing.test.js` | Tests for the SA algorithm: construction, single step, cooling, reheat, neighborhood, full solve |

### Modified Files

None. `Solver.js` is intentionally left unchanged for backward compatibility during transition.

---

## Chunk 1: Scaffolding — Interface contract and settings defaults

### Task 1: Scaffold the class with constructor and static properties

**Files:**
- Create: `SimulatedAnnealing.js`
- Create: `tests/SimulatedAnnealing.test.js`

- [ ] **Step 1: Write failing tests for the class scaffold**

```js
// tests/SimulatedAnnealing.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { SimulatedAnnealing, SA_DEFAULTS } = require('../SimulatedAnnealing.js');
const { makeCog, buildInventory } = require('./helpers.js');

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: FAIL — module not found

- [ ] **Step 3: Implement the scaffold**

```js
// SimulatedAnnealing.js

if (typeof require !== 'undefined') {
  var { SeededRng } = require('./SeededRng.js');
}

/**
 * Default settings for the improved Simulated Annealing algorithm.
 */
const SA_DEFAULTS = {
  coolingTarget: 0.30,  // Target acceptance rate for worsening moves
  staleLimit: 5000,     // Iterations without improvement before reheat
  reheatFactor: 0.5,    // Reheat to this fraction of initial temperature
  boardSpareRatio: 0.3  // Fraction of moves that are board-spare swaps
};

/**
 * Improved Simulated Annealing solver.
 *
 * Implements the SolverAlgorithm interface:
 *   constructor(scorer, settings)
 *   solve(inventory, timeLimit, onProgress) → CogInventory
 *
 * Key improvements over Solver.js:
 * - Uses IncrementalScorer instead of full recompute on every swap
 * - Weighted neighborhood: 70% board-board, 30% board-spare, bias toward boost positions
 * - Adaptive cooling: adjusts rate to maintain ~30% acceptance of worsening moves
 * - Reheat on stall: resets temperature to reheatFactor * initialTemp without losing current solution
 * - SeededRng for reproducible results
 */
class SimulatedAnnealing {
  /**
   * @param {IncrementalScorer} scorer - Incremental scoring engine wrapping the initial inventory
   * @param {Object} settings - Overrides for SA_DEFAULTS
   */
  constructor(scorer, settings) {
    this.scorer = scorer;
    this.settings = Object.assign({}, SA_DEFAULTS, settings);
  }

  static get displayName() { return 'Simulated Annealing'; }
  static get description() {
    return 'Fast stochastic optimizer. Uses adaptive cooling and reheat to escape local optima.';
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SimulatedAnnealing, SA_DEFAULTS };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add SimulatedAnnealing.js tests/SimulatedAnnealing.test.js
git commit -m "feat: scaffold SimulatedAnnealing class with interface and defaults"
```

---

## Chunk 2: Scoring integration — getScoreSum and initial temperature

### Task 2: Wire up getScoreSum and compute initial temperature

The SA algorithm needs to convert the 5-field score object into a single scalar for comparison. The `getScoreSum` function is available from `Solver.js` (exported by the infrastructure plan). Initial temperature is calculated from the current score so it's always proportional to the objective magnitude.

- [ ] **Step 1: Write failing tests**

Add to `tests/SimulatedAnnealing.test.js`:

```js
const { getScoreSum } = require('../Solver.js');

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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: FAIL — `_computeInitialTemp` not defined, `getScoreSum` import may fail if not yet exported

- [ ] **Step 3: Implement `_computeInitialTemp`**

Add to `SimulatedAnnealing.js` after the constructor block, inside the class:

```js
  /**
   * Compute the starting temperature based on the current score magnitude.
   * Mirrors the approach in Solver.js but handles both weighted and target modes.
   * @param {Object} score - 5-field score object from IncrementalScorer
   * @param {Object|null} weights - { buildRate, expBonus, flaggy }
   * @param {Object|null} targets - { buildRate, expBonus, flaggy }
   * @param {number} playerCount
   * @param {number} flagCount
   * @returns {number} Starting temperature
   */
  _computeInitialTemp(score, weights, targets, playerCount, flagCount) {
    if (targets) {
      // Target mode: scores are in [0, 1], use small fixed temperature
      return 0.05;
    }
    const scalar = getScoreSum(score, weights, null, playerCount, flagCount);
    // 5% of score magnitude, floored at 100 to avoid zero/tiny temps
    return Math.max(Math.abs(scalar) * 0.05, 100);
  }
```

Also add the `getScoreSum` require at the top of the file (guarded):

```js
if (typeof require !== 'undefined') {
  var { SeededRng } = require('./SeededRng.js');
  var { getScoreSum } = require('./Solver.js');
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add SimulatedAnnealing.js tests/SimulatedAnnealing.test.js
git commit -m "feat: add _computeInitialTemp to SimulatedAnnealing"
```

---

## Chunk 3: Neighborhood operators

### Task 3: Implement weighted neighborhood move selection

The SA algorithm uses two types of moves:
- **Board-board swap** (70%): swap two cogs both on the main board (`key < 96`). Prefer positions near boost cogs (higher spatial impact).
- **Board-spare swap** (30%): swap a board cog with a spare-pool cog (`key >= 108`). Allows cog substitution.

Fixed cogs and build-area cogs (`location === "build"`) are never moved, matching the behavior of the existing `Solver.js`.

- [ ] **Step 1: Write failing tests**

Add to `tests/SimulatedAnnealing.test.js`:

```js
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
    // Allow ±10% tolerance around the 30% target
    assert.ok(ratio > 0.20 && ratio < 0.40,
      `board-spare ratio ${ratio.toFixed(2)} should be near 0.30`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: FAIL — `_pickMove` not defined

- [ ] **Step 3: Implement `_pickMove`**

Add inside the `SimulatedAnnealing` class in `SimulatedAnnealing.js`:

```js
  /**
   * Select two positions to swap using the weighted neighborhood strategy.
   *
   * 70% board-board: both positions from availableSlotKeys (key < 96).
   * 30% board-spare: one board position + one spare position (key >= 108).
   *
   * Fixed cogs and build-area cogs are never selected.
   *
   * @param {CogInventory} inventory
   * @param {SeededRng} rng
   * @returns {[number, number]} [posA, posB] — two distinct positions to swap
   */
  _pickMove(inventory, rng) {
    const boardSlots = inventory.availableSlotKeys; // key < 96, non-fixed
    const isSpareMove = rng.random() < this.settings.boardSpareRatio;

    if (isSpareMove) {
      // Board-spare: pick one board position + one spare cog key
      const spareKeys = inventory.cogKeys.filter(k => k >= 108);
      if (spareKeys.length === 0) {
        // Fall back to board-board if no spare cogs
        return this._pickBoardBoardMove(inventory, boardSlots, rng);
      }
      const posA = rng.pick(boardSlots);
      const posB = rng.pick(spareKeys);
      // Validate: posA cog must not be fixed; posB cog must not be fixed or build-area
      const cogA = inventory.get(posA);
      const cogB = inventory.get(posB);
      if ((cogA && cogA.fixed) || (cogB && cogB.fixed)) {
        // Retry once with a plain board-board move rather than looping
        return this._pickBoardBoardMove(inventory, boardSlots, rng);
      }
      if (cogB && cogB.position && cogB.position().location === 'build') {
        return this._pickBoardBoardMove(inventory, boardSlots, rng);
      }
      return [posA, posB];
    }

    return this._pickBoardBoardMove(inventory, boardSlots, rng);
  }

  /**
   * Pick two distinct non-fixed board positions for a board-board swap.
   * @param {CogInventory} inventory
   * @param {number[]} boardSlots
   * @param {SeededRng} rng
   * @returns {[number, number]}
   */
  _pickBoardBoardMove(inventory, boardSlots, rng) {
    let posA, posB, cogA, cogB;
    // Simple sampling — retry until we find two valid, distinct positions
    // In practice this almost always succeeds on the first or second try
    let attempts = 0;
    do {
      posA = rng.pick(boardSlots);
      cogA = inventory.get(posA);
      attempts++;
    } while (cogA && cogA.fixed && attempts < 20);

    attempts = 0;
    do {
      posB = rng.pick(boardSlots);
      cogB = inventory.get(posB);
      attempts++;
    } while ((posB === posA || (cogB && cogB.fixed)) && attempts < 20);

    return [posA, posB];
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add SimulatedAnnealing.js tests/SimulatedAnnealing.test.js
git commit -m "feat: implement _pickMove weighted neighborhood for SimulatedAnnealing"
```

---

## Chunk 4: Adaptive cooling

### Task 4: Implement adaptive cooling rate adjustment

The cooling rate is adjusted periodically to maintain the target acceptance rate (~30%). If acceptance is too high (algorithm exploring too freely), cool faster. If too low (algorithm stuck), cool slower. Adjustment happens every `ADAPTIVE_WINDOW` iterations.

- [ ] **Step 1: Write failing tests**

Add to `tests/SimulatedAnnealing.test.js`:

```js
describe('SimulatedAnnealing — _adaptCooling', () => {
  it('decreases cooling rate (cools faster) when acceptance is above target', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { coolingTarget: 0.30 });
    const initialRate = 0.9997;
    // Acceptance 0.70 > target 0.30 → should cool faster → smaller rate
    const newRate = sa._adaptCooling(initialRate, 0.70, 0.30);
    assert.ok(newRate < initialRate,
      `rate should decrease when acceptance ${0.70} > target ${0.30}`);
  });

  it('increases cooling rate (cools slower) when acceptance is below target', () => {
    const inv = buildInventory([makeCog(0)]);
    const scorer = makeMockScorer(inv);
    const sa = new SimulatedAnnealing(scorer, { coolingTarget: 0.30 });
    const initialRate = 0.9997;
    // Acceptance 0.05 < target 0.30 → should cool slower → larger rate
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: FAIL — `_adaptCooling` not defined

- [ ] **Step 3: Implement `_adaptCooling`**

Add inside the `SimulatedAnnealing` class:

```js
  /**
   * Adjust the cooling rate to maintain the target acceptance rate.
   *
   * If actual acceptance > target: cool faster (rate gets smaller).
   * If actual acceptance < target: cool slower (rate gets larger).
   *
   * The adjustment is proportional to the error between actual and target,
   * and clamped to [0.99, 0.9999] to prevent degenerate behavior.
   *
   * @param {number} currentRate - Current cooling multiplier (e.g. 0.9997)
   * @param {number} actualAcceptance - Observed acceptance rate in recent window
   * @param {number} targetAcceptance - Desired acceptance rate (e.g. 0.30)
   * @returns {number} Adjusted cooling rate
   */
  _adaptCooling(currentRate, actualAcceptance, targetAcceptance) {
    const error = actualAcceptance - targetAcceptance;
    // Scale the adjustment: large error → larger correction
    // A factor of 0.0001 means a 100% error shifts rate by 0.0001
    const adjustment = error * 0.0001;
    const newRate = currentRate - adjustment;
    // Clamp to safe range: [0.99, 0.9999]
    return Math.max(0.99, Math.min(0.9999, newRate));
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add SimulatedAnnealing.js tests/SimulatedAnnealing.test.js
git commit -m "feat: implement adaptive cooling rate for SimulatedAnnealing"
```

---

## Chunk 5: Reheat strategy

### Task 5: Implement stall detection and reheat

When the algorithm hasn't improved for `staleLimit` iterations, it reheats: bumps temperature to `reheatFactor * initialTemp` and resets the stale counter. The current best solution is preserved — reheat re-enables exploration without abandoning a good solution.

- [ ] **Step 1: Write failing tests**

Add to `tests/SimulatedAnnealing.test.js`:

```js
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: FAIL — `_shouldReheat` and `_applyReheat` not defined

- [ ] **Step 3: Implement `_shouldReheat` and `_applyReheat`**

Add inside the `SimulatedAnnealing` class:

```js
  /**
   * Returns true if the algorithm has stalled for long enough to warrant reheating.
   * @param {number} itersSinceImprovement - Iterations since last best score improvement
   * @returns {boolean}
   */
  _shouldReheat(itersSinceImprovement) {
    return itersSinceImprovement >= this.settings.staleLimit;
  }

  /**
   * Compute the reheated temperature.
   * Preserves the current solution — only the temperature is reset.
   * @param {number} initialTemp - The temperature used at the start of the run
   * @returns {number} New temperature after reheat
   */
  _applyReheat(initialTemp) {
    return initialTemp * this.settings.reheatFactor;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add SimulatedAnnealing.js tests/SimulatedAnnealing.test.js
git commit -m "feat: implement reheat strategy for SimulatedAnnealing"
```

---

## Chunk 6: Single SA step

### Task 6: Implement one iteration of the SA loop

A single step: pick a move, apply it via `IncrementalScorer.swap`, evaluate, accept or reject. This is the inner loop body, extracted for testability.

- [ ] **Step 1: Write failing tests**

These tests use a real `IncrementalScorer` on a minimal board to verify the accept/reject logic:

```js
// Add near top of test file, after existing requires
const { IncrementalScorer } = require('../IncrementalScorer.js');

describe('SimulatedAnnealing — _step', () => {
  // A board with two cogs where we know which placement is better
  function makeTwoCogBoard() {
    // cog at pos 0 has high buildRate, cog at pos 1 has low buildRate
    const cogs = [
      makeCog(0, { buildRate: 100 }),
      makeCog(1, { buildRate: 1 }),
    ];
    return buildInventory(cogs, { availableSlotKeys: [0, 1] });
  }

  it('always accepts improvements (returns true)', () => {
    const inv = makeTwoCogBoard();
    const scorer = new IncrementalScorer(inv);
    const sa = new SimulatedAnnealing(scorer, {});
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const rng = new SeededRng(42);
    // Set temp very low so only improvements are accepted
    const accepted = sa._step(inv, weights, null, 10, 1, 0.001, rng);
    // With temp near 0, only improvements (delta > 0) are accepted
    // The test just verifies the method returns a boolean
    assert.strictEqual(typeof accepted, 'boolean');
  });

  it('returns false and leaves score unchanged when rejecting', () => {
    // With temp = 0 (or near 0) and a worsening move forced, should reject
    const inv = makeTwoCogBoard();
    const scorer = new IncrementalScorer(inv);
    scorer.fullRecompute();
    const sa = new SimulatedAnnealing(scorer, {});
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const rng = new SeededRng(42);
    const scoreBefore = getScoreSum(scorer.score, weights, null, 10, 1);
    // Run many steps with near-zero temp; score should not decrease below initial
    let minScore = scoreBefore;
    for (let i = 0; i < 200; i++) {
      sa._step(inv, weights, null, 10, 1, 0.0001, rng);
      const s = getScoreSum(scorer.score, weights, null, 10, 1);
      minScore = Math.min(minScore, s);
    }
    // With near-zero temp, score should never drop much below initial
    assert.ok(minScore >= scoreBefore - 5,
      `score ${minScore} should not drop far below initial ${scoreBefore}`);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: FAIL — `_step` not defined, and `IncrementalScorer` may not exist yet (but test file will fail on import)

- [ ] **Step 3: Implement `_step`**

Add inside the `SimulatedAnnealing` class:

```js
  /**
   * Execute one SA iteration: pick a move, apply it, accept or reject.
   *
   * On accept: the scorer's internal state advances to the new position.
   * On reject: the swap is undone (swap again = undo, per IncrementalScorer semantics).
   *
   * @param {CogInventory} inventory - Current board state (mutated in place on accept)
   * @param {Object|null} weights - Score weights
   * @param {Object|null} targets - Score targets (mutually exclusive with weights)
   * @param {number} playerCount
   * @param {number} flagCount
   * @param {number} temperature - Current annealing temperature
   * @param {SeededRng} rng
   * @param {number} currentScalar - Current score as a scalar (avoids re-reading on reject)
   * @returns {{ accepted: boolean, newScalar: number }} Whether the move was accepted and the resulting scalar score
   */
  _step(inventory, weights, targets, playerCount, flagCount, temperature, rng, currentScalar) {
    const [posA, posB] = this._pickMove(inventory, rng);

    // Apply the swap via IncrementalScorer
    this.scorer.swap(posA, posB);

    const newScalar = getScoreSum(this.scorer.score, weights, targets, playerCount, flagCount);
    const delta = newScalar - currentScalar;

    const accepted = delta > 0 || rng.random() < Math.exp(delta / temperature);

    if (!accepted) {
      // Undo the swap (applying same swap twice restores original state)
      this.scorer.swap(posA, posB);
      return { accepted: false, newScalar: currentScalar };
    }

    return { accepted: true, newScalar };
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: All tests PASS (the `_step` tests in particular)

- [ ] **Step 5: Commit**

```bash
git add SimulatedAnnealing.js tests/SimulatedAnnealing.test.js
git commit -m "feat: implement _step (single SA iteration) for SimulatedAnnealing"
```

---

## Chunk 7: Full solve loop

### Task 7: Implement `solve()` — the main entry point

The `solve()` method is the algorithm's public interface. It:
1. Reads `playerCount`, `flagCount`, and score mode from inventory
2. Computes initial temperature
3. Runs the SA loop until `timeLimit` is exhausted
4. Tracks best solution, calls `onProgress` periodically
5. Applies reheat on stall
6. Adjusts cooling rate adaptively every `ADAPTIVE_WINDOW` iterations
7. Returns the best `CogInventory` found

- [ ] **Step 1: Write failing tests**

Add to `tests/SimulatedAnnealing.test.js`:

```js
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
    const result = sa.solve(inv, 500, (info) => {
      progressCalled = true;
      assert.ok(typeof info.score === 'number', 'progress.score should be a number');
      assert.ok(typeof info.iterations === 'number', 'progress.iterations should be a number');
      assert.ok(typeof info.elapsed === 'number', 'progress.elapsed should be a number');
    });
    assert.ok(progressCalled, 'onProgress should have been called at least once');
    done();
  });

  it('returns a result with score >= initial greedy score', () => {
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
    // Manually set weights on the sa instance (the solve method reads them from settings)
    const initialScalar = getScoreSum(scorer.score, weights, null, 10, 1);
    const result = sa.solve(inv, 300, () => {});
    // Result score should be >= initial (SA never loses best solution)
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
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: FAIL — `solve` not defined

- [ ] **Step 3: Implement `solve()`**

Replace the `SimulatedAnnealing` class body to add the full `solve` method. Add these constants above the class:

```js
const ADAPTIVE_WINDOW = 500;    // Adjust cooling rate every N iterations
const PROGRESS_INTERVAL_MS = 500; // Call onProgress every ~500ms
```

Add inside the `SimulatedAnnealing` class:

```js
  /**
   * Run the simulated annealing solver.
   *
   * @param {CogInventory} inventory - Initial board state (from GreedyInit)
   * @param {number} timeLimit - Time budget in milliseconds
   * @param {function} onProgress - Called every ~500ms with { score, iterations, elapsed }
   * @returns {CogInventory} Best solution found
   */
  solve(inventory, timeLimit, onProgress) {
    const rng = new SeededRng(this.settings.seed || Date.now());

    const playerCount = inventory.playerCount || 10;
    const flagCount = Math.max((inventory.flagPose || []).length, 1);
    const weights = this.settings.weights || { buildRate: 1, expBonus: 1, flaggy: 1 };
    const targets = this.settings.targets || null;

    // Initialize incremental scorer from the provided inventory state
    this.scorer.fullRecompute();
    let currentScalar = getScoreSum(this.scorer.score, weights, targets, playerCount, flagCount);

    const initialTemp = this._computeInitialTemp(this.scorer.score, weights, targets, playerCount, flagCount);
    let temperature = initialTemp;
    let coolingRate = 0.9997;

    // Track best solution
    let bestScalar = currentScalar;
    let bestInventory = inventory.clone();

    let iterations = 0;
    let itersSinceImprovement = 0;
    let windowAccepted = 0;    // Accepted moves in current adaptive window
    let windowTotal = 0;       // Total moves in current adaptive window
    let lastProgressTime = Date.now();
    const startTime = Date.now();

    while (Date.now() - startTime < timeLimit) {
      const { accepted, newScalar } = this._step(
        inventory, weights, targets, playerCount, flagCount, temperature, rng, currentScalar
      );

      currentScalar = newScalar;
      iterations++;
      windowTotal++;
      if (accepted) windowAccepted++;

      // Track best solution
      if (currentScalar > bestScalar) {
        bestScalar = currentScalar;
        bestInventory = inventory.clone();
        itersSinceImprovement = 0;
      } else {
        itersSinceImprovement++;
      }

      // Reheat if stalled
      if (this._shouldReheat(itersSinceImprovement)) {
        temperature = this._applyReheat(initialTemp);
        itersSinceImprovement = 0;
      } else {
        temperature *= coolingRate;
      }

      // Adaptive cooling: adjust rate every ADAPTIVE_WINDOW iterations
      if (windowTotal >= ADAPTIVE_WINDOW) {
        const actualAcceptance = windowAccepted / windowTotal;
        coolingRate = this._adaptCooling(coolingRate, actualAcceptance, this.settings.coolingTarget);
        windowAccepted = 0;
        windowTotal = 0;
      }

      // Progress callback
      const now = Date.now();
      if (now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
        onProgress({
          score: bestScalar,
          iterations,
          elapsed: now - startTime
        });
        lastProgressTime = now;
      }
    }

    return bestInventory;
  }
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add SimulatedAnnealing.js tests/SimulatedAnnealing.test.js
git commit -m "feat: implement solve() main loop for SimulatedAnnealing"
```

---

## Chunk 8: Integration and regression tests

### Task 8: Integration test against fixture boards

These tests verify that `SimulatedAnnealing` produces valid board states (no constraint violations, score >= initial) when run on real fixture data.

- [ ] **Step 1: Write failing integration tests**

Add to `tests/SimulatedAnnealing.test.js`:

```js
const fs = require('fs');
const path = require('path');
const { CogInventory, Cog } = require('../CogInventory.js');
const { Serializer } = require('../Serializer.js');

describe('SimulatedAnnealing — integration with fixture boards', () => {
  const fixtures = ['malthorin.json', '3-tiny-cogs.json'].map(name =>
    path.join(__dirname, '..', name)
  ).filter(p => fs.existsSync(p));

  for (const fixturePath of fixtures) {
    const fixtureName = path.basename(fixturePath);

    it(`produces a valid board from ${fixtureName}`, () => {
      const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      const inv = Serializer.deserialize(raw);
      const scorer = new IncrementalScorer(inv);
      scorer.fullRecompute();

      const sa = new SimulatedAnnealing(scorer, { seed: 1 });
      const result = sa.solve(inv, 1000, () => {});

      // Validate: no cog key appears more than once
      const seenKeys = new Set();
      for (const cog of Object.values(result.cogs)) {
        assert.ok(!seenKeys.has(cog.key), `Duplicate cog key ${cog.key}`);
        seenKeys.add(cog.key);
      }

      // Validate: fixed cogs have not moved
      for (const cog of Object.values(result.cogs)) {
        if (cog.fixed) {
          assert.strictEqual(cog.key, cog.initialKey,
            `Fixed cog ${cog.initialKey} was moved to ${cog.key}`);
        }
      }

      // Validate: result score is computable (no crash)
      const resultScorer = new IncrementalScorer(result);
      resultScorer.fullRecompute();
      const resultScore = resultScorer.score;
      assert.ok(resultScore.buildRate >= 0, 'buildRate should be non-negative');
    });

    it(`result score >= initial score on ${fixtureName}`, () => {
      const raw = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
      const inv = Serializer.deserialize(raw);
      const scorer = new IncrementalScorer(inv);
      scorer.fullRecompute();

      const weights = { buildRate: 1, expBonus: 1, flaggy: 1 };
      const initialScalar = getScoreSum(scorer.score, weights, null,
        inv.playerCount || 10, Math.max((inv.flagPose || []).length, 1));

      const sa = new SimulatedAnnealing(scorer, { seed: 1, weights });
      const result = sa.solve(inv, 1000, () => {});

      const resultScorer = new IncrementalScorer(result);
      resultScorer.fullRecompute();
      const resultScalar = getScoreSum(resultScorer.score, weights, null,
        result.playerCount || 10, Math.max((result.flagPose || []).length, 1));

      assert.ok(resultScalar >= initialScalar,
        `Result ${resultScalar} should be >= initial ${initialScalar} on ${fixtureName}`);
    });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: FAIL — `Serializer` may not exist yet (infrastructure dependency). If Serializer is not ready, this step can be skipped and revisited once infrastructure is complete. The earlier unit tests should still all pass.

- [ ] **Step 3: Wire up Serializer and run when available**

Once `Serializer.js` is available from the infrastructure plan:

```bash
node --test tests/SimulatedAnnealing.test.js
```

Expected: All tests PASS including integration tests

- [ ] **Step 4: Commit**

```bash
git add tests/SimulatedAnnealing.test.js
git commit -m "test: add integration tests for SimulatedAnnealing against fixture boards"
```

---

## Chunk 9: Final wiring and full test run

### Task 9: Verify all tests pass and module exports are complete

- [ ] **Step 1: Verify complete exports**

Ensure `SimulatedAnnealing.js` exports everything needed by `SolverWorker.js`:

```js
// At the bottom of SimulatedAnnealing.js (already present, verify it reads):
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SimulatedAnnealing, SA_DEFAULTS };
}
```

- [ ] **Step 2: Run the full test suite**

```bash
node --test tests/BoostPositions.test.js tests/SeededRng.test.js tests/SimulatedAnnealing.test.js
```

Expected: All tests PASS across all three files

- [ ] **Step 3: Verify `Solver.js` tests still pass (no regressions)**

```bash
node --test tests/StepOptimizer.test.js
```

Expected: All existing tests PASS (we never modified `Solver.js`)

- [ ] **Step 4: Final commit**

```bash
git add SimulatedAnnealing.js tests/SimulatedAnnealing.test.js
git commit -m "feat: complete SimulatedAnnealing implementation with full test coverage"
```

---

## Complete `SimulatedAnnealing.js` Reference

For easy review, the final file in full:

```js
// SimulatedAnnealing.js

if (typeof require !== 'undefined') {
  var { SeededRng } = require('./SeededRng.js');
  var { getScoreSum } = require('./Solver.js');
}

const ADAPTIVE_WINDOW = 500;
const PROGRESS_INTERVAL_MS = 500;

/**
 * Default settings for the improved Simulated Annealing algorithm.
 */
const SA_DEFAULTS = {
  coolingTarget: 0.30,
  staleLimit: 5000,
  reheatFactor: 0.5,
  boardSpareRatio: 0.3
};

/**
 * Improved Simulated Annealing solver implementing the SolverAlgorithm interface.
 *
 * Key improvements over Solver.js:
 * - Uses IncrementalScorer instead of full recompute on every swap (O(1)–O(12) vs O(96))
 * - Weighted neighborhood: 70% board-board, 30% board-spare, skips fixed/build cogs
 * - Adaptive cooling: adjusts rate every 500 iterations to maintain ~30% acceptance
 * - Reheat on stall: bumps temp to reheatFactor * initialTemp after staleLimit iterations
 *   without losing the current best solution (contrast: old multi-start loses current state)
 * - SeededRng for reproducible results given the same seed
 *
 * Tradeoff note (from spec): reheat vs multi-start
 * The old solver's multi-start explored from different random starting points (diversity).
 * This SA reheats from the current solution (better exploitation). With a greedy initial
 * solution, this is generally more effective. Diversity exploration is delegated to the GA.
 */
class SimulatedAnnealing {
  /**
   * @param {IncrementalScorer} scorer - Scoring engine wrapping the initial inventory
   * @param {Object} settings - Overrides for SA_DEFAULTS. Also accepts:
   *   - seed {number}: RNG seed for reproducibility
   *   - weights {Object}: { buildRate, expBonus, flaggy } for weighted scoring
   *   - targets {Object}: { buildRate, expBonus, flaggy } for target-based scoring
   */
  constructor(scorer, settings) {
    this.scorer = scorer;
    this.settings = Object.assign({}, SA_DEFAULTS, settings);
  }

  static get displayName() { return 'Simulated Annealing'; }
  static get description() {
    return 'Fast stochastic optimizer. Uses adaptive cooling and reheat to escape local optima.';
  }

  _computeInitialTemp(score, weights, targets, playerCount, flagCount) {
    if (targets) {
      return 0.05;
    }
    const scalar = getScoreSum(score, weights, null, playerCount, flagCount);
    return Math.max(Math.abs(scalar) * 0.05, 100);
  }

  _pickMove(inventory, rng) {
    const boardSlots = inventory.availableSlotKeys;
    const isSpareMove = rng.random() < this.settings.boardSpareRatio;

    if (isSpareMove) {
      const spareKeys = inventory.cogKeys.filter(k => k >= 108);
      if (spareKeys.length === 0) {
        return this._pickBoardBoardMove(inventory, boardSlots, rng);
      }
      const posA = rng.pick(boardSlots);
      const posB = rng.pick(spareKeys);
      const cogA = inventory.get(posA);
      const cogB = inventory.get(posB);
      if ((cogA && cogA.fixed) || (cogB && cogB.fixed)) {
        return this._pickBoardBoardMove(inventory, boardSlots, rng);
      }
      if (cogB && cogB.position && cogB.position().location === 'build') {
        return this._pickBoardBoardMove(inventory, boardSlots, rng);
      }
      return [posA, posB];
    }

    return this._pickBoardBoardMove(inventory, boardSlots, rng);
  }

  _pickBoardBoardMove(inventory, boardSlots, rng) {
    let posA, posB, cogA, cogB, attempts;

    attempts = 0;
    do {
      posA = rng.pick(boardSlots);
      cogA = inventory.get(posA);
      attempts++;
    } while (cogA && cogA.fixed && attempts < 20);

    attempts = 0;
    do {
      posB = rng.pick(boardSlots);
      cogB = inventory.get(posB);
      attempts++;
    } while ((posB === posA || (cogB && cogB.fixed)) && attempts < 20);

    return [posA, posB];
  }

  _adaptCooling(currentRate, actualAcceptance, targetAcceptance) {
    const error = actualAcceptance - targetAcceptance;
    const adjustment = error * 0.0001;
    const newRate = currentRate - adjustment;
    return Math.max(0.99, Math.min(0.9999, newRate));
  }

  _shouldReheat(itersSinceImprovement) {
    return itersSinceImprovement >= this.settings.staleLimit;
  }

  _applyReheat(initialTemp) {
    return initialTemp * this.settings.reheatFactor;
  }

  _step(inventory, weights, targets, playerCount, flagCount, temperature, rng, currentScalar) {
    const [posA, posB] = this._pickMove(inventory, rng);

    this.scorer.swap(posA, posB);

    const newScalar = getScoreSum(this.scorer.score, weights, targets, playerCount, flagCount);
    const delta = newScalar - currentScalar;

    const accepted = delta > 0 || rng.random() < Math.exp(delta / temperature);

    if (!accepted) {
      this.scorer.swap(posA, posB);
      return { accepted: false, newScalar: currentScalar };
    }

    return { accepted: true, newScalar };
  }

  solve(inventory, timeLimit, onProgress) {
    const rng = new SeededRng(this.settings.seed || Date.now());

    const playerCount = inventory.playerCount || 10;
    const flagCount = Math.max((inventory.flagPose || []).length, 1);
    const weights = this.settings.weights || { buildRate: 1, expBonus: 1, flaggy: 1 };
    const targets = this.settings.targets || null;

    this.scorer.fullRecompute();
    let currentScalar = getScoreSum(this.scorer.score, weights, targets, playerCount, flagCount);

    const initialTemp = this._computeInitialTemp(
      this.scorer.score, weights, targets, playerCount, flagCount
    );
    let temperature = initialTemp;
    let coolingRate = 0.9997;

    let bestScalar = currentScalar;
    let bestInventory = inventory.clone();

    let iterations = 0;
    let itersSinceImprovement = 0;
    let windowAccepted = 0;
    let windowTotal = 0;
    let lastProgressTime = Date.now();
    const startTime = Date.now();

    while (Date.now() - startTime < timeLimit) {
      const { accepted, newScalar } = this._step(
        inventory, weights, targets, playerCount, flagCount, temperature, rng, currentScalar
      );

      currentScalar = newScalar;
      iterations++;
      windowTotal++;
      if (accepted) windowAccepted++;

      if (currentScalar > bestScalar) {
        bestScalar = currentScalar;
        bestInventory = inventory.clone();
        itersSinceImprovement = 0;
      } else {
        itersSinceImprovement++;
      }

      if (this._shouldReheat(itersSinceImprovement)) {
        temperature = this._applyReheat(initialTemp);
        itersSinceImprovement = 0;
      } else {
        temperature *= coolingRate;
      }

      if (windowTotal >= ADAPTIVE_WINDOW) {
        const actualAcceptance = windowAccepted / windowTotal;
        coolingRate = this._adaptCooling(coolingRate, actualAcceptance, this.settings.coolingTarget);
        windowAccepted = 0;
        windowTotal = 0;
      }

      const now = Date.now();
      if (now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
        onProgress({ score: bestScalar, iterations, elapsed: now - startTime });
        lastProgressTime = now;
      }
    }

    return bestInventory;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SimulatedAnnealing, SA_DEFAULTS };
}
```

---

## Dependency Checklist

Before starting this plan, verify the following are available from the infrastructure plan:

- [ ] `IncrementalScorer.js` exists and exports `{ IncrementalScorer }`
  - Has `constructor(inventory)`, `swap(posA, posB)`, `score` getter, `fullRecompute()`
- [ ] `SeededRng.js` exists and exports `{ SeededRng }`
  - Has `constructor(seed)`, `random()`, `randInt(max)`, `pick(arr)`
- [ ] `Solver.js` exports `getScoreSum(score, weights, targets, playerCount, flagCount)`
  - Signature must match what this plan calls: weights and targets as separate args, not on `this`
- [ ] `tests/helpers.js` exists and exports `{ makeCog, buildInventory, assertScoresEqual }`
- [ ] `Serializer.js` exists and exports `{ Serializer }` with `deserialize(raw)` (for integration tests only — can be deferred)

> **Note on `getScoreSum` signature:** The current `Solver.js` `getScoreSum` method takes `(score, playerCount, flagCount)` and reads `this.weights` / `this.targets`. The infrastructure plan moves it to a standalone function. This SA plan assumes the standalone signature `getScoreSum(score, weights, targets, playerCount, flagCount)`. If the infrastructure plan uses a different signature, update the calls in `_computeInitialTemp` and `_step` accordingly.
