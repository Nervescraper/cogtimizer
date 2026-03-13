# Solver Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the shared infrastructure (IncrementalScorer, GreedyInit, Web Worker, common interface) that all three solver algorithms will use.

**Architecture:** Extract the boost-radius position logic from `CogInventory.score` into a shared helper. Build an `IncrementalScorer` that maintains a persistent bonus grid and running score totals, updated incrementally on each swap. Add a greedy construction heuristic for high-quality initial solutions. Wrap everything in a Web Worker with serialization for off-main-thread computation.

**Tech Stack:** Vanilla JavaScript, Node.js native test runner (`node --test`), no external dependencies.

**Spec:** `docs/superpowers/specs/2026-03-13-solver-algorithms-design.md`

---

## File Structure

### New Files
| File | Responsibility |
|------|---------------|
| `BoostPositions.js` | Pure function: given a boost radius type and position, returns the list of affected [row, col] pairs. Extracted from the switch statement in `CogInventory.score`. |
| `IncrementalScorer.js` | Wraps a `CogInventory`. Maintains persistent bonus grid, running score totals, and per-position contribution cache. Exposes `swap(posA, posB)` and `score` getter. |
| `GreedyInit.js` | Given a `CogInventory` and weights/targets, produces an optimized initial board placement using the greedy heuristic. |
| `SeededRng.js` | Simple seeded PRNG (xorshift128) for reproducible results in tests and algorithms. |
| `Serializer.js` | Serialize/deserialize `CogInventory` to/from plain JSON for Web Worker communication. |
| `SolverWorker.js` | Web Worker entry point. Receives serialized inventory + settings, runs greedy init + selected algorithm, posts progress and results. |
| `tests/IncrementalScorer.test.js` | Comprehensive tests for incremental scoring correctness. |
| `tests/GreedyInit.test.js` | Tests for greedy construction heuristic. |
| `tests/BoostPositions.test.js` | Tests for extracted boost position logic. |
| `tests/Serializer.test.js` | Round-trip serialization tests. |
| `tests/SeededRng.test.js` | PRNG determinism and distribution tests. |
| `tests/helpers.js` | Shared test utilities: `buildInventory(cogSpecs, slotSpecs, opts)` for building test inventories without DOM. |

### Modified Files
| File | Change |
|------|--------|
| `CogInventory.js` | Use `getBoostPositions()` from `BoostPositions.js` in the `score` getter (replaces inline switch). Add `module.exports` for new dependency. |
| `Solver.js` | Move `getScoreSum()` to a standalone exported function (algorithms need it but it's not solver-specific). Keep `removeUselesMoves()` as exported function. |

---

## Chunk 1: Foundation — BoostPositions, Test Helpers, SeededRng

### Task 1: Extract boost position calculation

**Files:**
- Create: `BoostPositions.js`
- Test: `tests/BoostPositions.test.js`

- [ ] **Step 1: Write failing tests for `getBoostPositions`**

```js
// tests/BoostPositions.test.js
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
    // All positions should be above row 4
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
    assert.strictEqual(positions.length, 11); // 12 columns - 1 (self)
    for (const [r, c] of positions) {
      assert.strictEqual(r, 3);
      assert.notStrictEqual(c, 5);
    }
  });

  it('returns 7 positions for column radius (excludes self)', () => {
    const positions = getBoostPositions('column', 3, 5);
    assert.strictEqual(positions.length, 7); // 8 rows - 1 (self)
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
    assert.strictEqual(positions.length, 95); // 96 - 1 (self)
    // Self should not be included
    const hasSelf = positions.some(([r, c]) => r === 3 && c === 5);
    assert.strictEqual(hasSelf, false);
  });

  it('returns empty array for unknown radius type', () => {
    const positions = getBoostPositions('unknown', 3, 5);
    assert.deepStrictEqual(positions, []);
  });

  it('returns out-of-bounds positions unfiltered (caller filters)', () => {
    // Corner cog at (0,0) — some positions will be negative
    const positions = getBoostPositions('diagonal', 0, 0);
    assert.strictEqual(positions.length, 4);
    // Three of four will be out of bounds
    const inBounds = positions.filter(([r, c]) => r >= 0 && r < 8 && c >= 0 && c < 12);
    assert.strictEqual(inBounds.length, 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cogtimizer && node --test tests/BoostPositions.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement `getBoostPositions`**

```js
// BoostPositions.js
const INV_ROWS = 8;
const INV_COLUMNS = 12;

/**
 * Returns the [row, col] pairs affected by a boost cog at (row, col) with the given radius type.
 * Positions may be out of bounds — caller is responsible for bounds checking.
 * @param {string} radiusType - One of: diagonal, adjacent, up, down, left, right, row, column, corners, around, everything
 * @param {number} row - Row of the boost cog (0-7)
 * @param {number} col - Column of the boost cog (0-11)
 * @returns {Array<[number, number]>} Array of [row, col] pairs
 */
function getBoostPositions(radiusType, row, col) {
  const positions = [];
  switch (radiusType) {
    case 'diagonal':
      positions.push([row-1, col-1], [row-1, col+1], [row+1, col-1], [row+1, col+1]);
      break;
    case 'adjacent':
      positions.push([row-1, col], [row, col+1], [row+1, col], [row, col-1]);
      break;
    case 'up':
      positions.push([row-2, col-1], [row-2, col], [row-2, col+1], [row-1, col-1], [row-1, col], [row-1, col+1]);
      break;
    case 'right':
      positions.push([row-1, col+2], [row, col+2], [row+1, col+2], [row-1, col+1], [row, col+1], [row+1, col+1]);
      break;
    case 'down':
      positions.push([row+2, col-1], [row+2, col], [row+2, col+1], [row+1, col-1], [row+1, col], [row+1, col+1]);
      break;
    case 'left':
      positions.push([row-1, col-2], [row, col-2], [row+1, col-2], [row-1, col-1], [row, col-1], [row+1, col-1]);
      break;
    case 'row':
      for (let c = 0; c < INV_COLUMNS; c++) {
        if (c === col) continue;
        positions.push([row, c]);
      }
      break;
    case 'column':
      for (let r = 0; r < INV_ROWS; r++) {
        if (r === row) continue;
        positions.push([r, col]);
      }
      break;
    case 'corners':
      positions.push([row-2, col-2], [row-2, col+2], [row+2, col-2], [row+2, col+2]);
      break;
    case 'around':
      positions.push(
        [row-2, col], [row-1, col-1], [row-1, col], [row-1, col+1],
        [row, col-2], [row, col-1], [row, col+1], [row, col+2],
        [row+1, col-1], [row+1, col], [row+1, col+1], [row+2, col]
      );
      break;
    case 'everything':
      for (let r = 0; r < INV_ROWS; r++) {
        for (let c = 0; c < INV_COLUMNS; c++) {
          if (r === row && c === col) continue;
          positions.push([r, c]);
        }
      }
      break;
    default:
      break;
  }
  return positions;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getBoostPositions, INV_ROWS, INV_COLUMNS };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cogtimizer && node --test tests/BoostPositions.test.js`
Expected: All 12 tests PASS

- [ ] **Step 5: Refactor `CogInventory.score` to use `getBoostPositions`**

In `CogInventory.js`, replace the inline switch statement (lines 425-469) with a call to `getBoostPositions`. At the top of the file, add (guarded for browser/worker compatibility):
```js
if (typeof require !== 'undefined') {
  var { getBoostPositions } = require('./BoostPositions.js');
}
```

In browser context, `getBoostPositions` is a global from the script tag. The `var` declaration avoids re-declaring a global.

Replace the switch block in the `score` getter with:
```js
const boosted = getBoostPositions(entry.boostRadius, i, j);
```

Remove the local `boosted` array declaration and the entire switch statement.

- [ ] **Step 6: Verify existing tests still pass**

Run: `cd cogtimizer && node --test tests/StepOptimizer.test.js`
Expected: All existing tests PASS (the refactor should be behavior-preserving)

- [ ] **Step 7: Commit**

```bash
git add BoostPositions.js tests/BoostPositions.test.js CogInventory.js
git commit -m "refactor: extract boost position calculation into shared module"
```

---

### Task 2: Create shared test helpers

**Files:**
- Create: `tests/helpers.js`

- [ ] **Step 1: Write test helper module**

```js
// tests/helpers.js
const { Cog, CogInventory } = require('../CogInventory.js');

/**
 * Create a minimal Cog with sensible defaults.
 * @param {number} key - Board position
 * @param {Object} opts - Override any Cog property
 */
function makeCog(key, opts = {}) {
  return new Cog({
    key,
    initialKey: opts.initialKey !== undefined ? opts.initialKey : key,
    icon: opts.icon || { path: 'icons/cogs/Cog_Nooby.png' },
    buildRate: opts.buildRate || 0,
    expBonus: opts.expBonus || 0,
    flaggy: opts.flaggy || 0,
    isPlayer: opts.isPlayer || false,
    isFlag: opts.isFlag || false,
    boostRadius: opts.boostRadius || undefined,
    buildRadiusBoost: opts.buildRadiusBoost || 0,
    expRadiusBoost: opts.expRadiusBoost || 0,
    flaggyRadiusBoost: opts.flaggyRadiusBoost || 0,
    flagBoost: opts.flagBoost || 0,
    fixed: opts.fixed || false,
    blocked: opts.blocked || false,
    ...opts
  });
}

/**
 * Build a CogInventory from arrays of cog specs, without DOM access.
 * @param {Array<Cog>} cogs - Array of Cog objects to place on the board
 * @param {Object} opts - { flagPose, flaggyShopUpgrades, playerCount, availableSlotKeys }
 * @returns {CogInventory}
 */
function buildInventory(cogs, opts = {}) {
  const cogDict = {};
  for (const cog of cogs) {
    cogDict[cog.key] = cog;
  }

  // Build slots: all positions 0-95 are unlocked by default unless overridden
  const slots = {};
  const blockedKeys = new Set(opts.blockedKeys || []);
  for (let i = 0; i < 96; i++) {
    const isBlocked = blockedKeys.has(i);
    slots[i] = new Cog({
      key: i,
      icon: 'Blank',
      fixed: isBlocked,
      blocked: isBlocked
    });
  }

  const inv = new CogInventory(cogDict, slots);
  inv.flagPose = opts.flagPose || [];
  inv.flaggyShopUpgrades = opts.flaggyShopUpgrades || 0;
  inv.playerCount = opts.playerCount || 10;
  inv.spareSlotCount = opts.spareSlotCount || 96;

  // Build availableSlotKeys from slots (non-fixed, key < 96)
  inv.availableSlotKeys = opts.availableSlotKeys ||
    Object.values(slots)
      .filter(s => !s.fixed && s.key < 96)
      .map(s => s.key);

  return inv;
}

/**
 * Assert two score objects are equal across all 5 fields.
 */
function assertScoresEqual(actual, expected, message = '') {
  const prefix = message ? message + ': ' : '';
  assert.strictEqual(actual.buildRate, expected.buildRate, `${prefix}buildRate mismatch`);
  assert.strictEqual(actual.expBonus, expected.expBonus, `${prefix}expBonus mismatch`);
  assert.strictEqual(actual.flaggy, expected.flaggy, `${prefix}flaggy mismatch`);
  assert.strictEqual(actual.expBoost, expected.expBoost, `${prefix}expBoost mismatch`);
  assert.strictEqual(actual.flagBoost, expected.flagBoost, `${prefix}flagBoost mismatch`);
}

module.exports = { makeCog, buildInventory, assertScoresEqual };
```

- [ ] **Step 2: Commit**

```bash
git add tests/helpers.js
git commit -m "test: add shared test helper utilities for building inventories"
```

---

### Task 3: Seeded PRNG

**Files:**
- Create: `SeededRng.js`
- Test: `tests/SeededRng.test.js`

- [ ] **Step 1: Write failing tests**

```js
// tests/SeededRng.test.js
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
    // Should have picked all elements at least once in 100 tries
    assert.strictEqual(picked.size, 3);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cogtimizer && node --test tests/SeededRng.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SeededRng (xorshift128)**

```js
// SeededRng.js

/**
 * Seeded PRNG using xorshift128 algorithm.
 * Drop-in replacement for Math.random() when deterministic results are needed.
 */
class SeededRng {
  constructor(seed) {
    // Initialize state from seed using splitmix32 to avoid weak seeds
    this._s0 = this._splitmix32(seed);
    this._s1 = this._splitmix32(this._s0);
    this._s2 = this._splitmix32(this._s1);
    this._s3 = this._splitmix32(this._s2);
  }

  _splitmix32(seed) {
    seed = (seed + 0x9e3779b9) | 0;
    seed = Math.imul(seed ^ (seed >>> 16), 0x85ebca6b);
    seed = Math.imul(seed ^ (seed >>> 13), 0xc2b2ae35);
    return (seed ^ (seed >>> 16)) >>> 0;
  }

  /** Returns a float in [0, 1), like Math.random(). */
  random() {
    const t = this._s3;
    let s = this._s0;
    this._s3 = this._s2;
    this._s2 = this._s1;
    this._s1 = s;
    const t2 = t ^ (t << 11);
    this._s0 = t2 ^ (t2 >>> 8) ^ s ^ (s >>> 19);
    return (this._s0 >>> 0) / 4294967296;
  }

  /** Returns an integer in [0, max). */
  randInt(max) {
    return Math.floor(this.random() * max);
  }

  /** Returns a random element from the array. */
  pick(arr) {
    return arr[this.randInt(arr.length)];
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SeededRng };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cogtimizer && node --test tests/SeededRng.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add SeededRng.js tests/SeededRng.test.js
git commit -m "feat: add seeded PRNG for reproducible solver results"
```

---

## Chunk 2: IncrementalScorer — Core

### Task 4: IncrementalScorer initialization and score reading

**Files:**
- Create: `IncrementalScorer.js`
- Test: `tests/IncrementalScorer.test.js`
- Reference: `CogInventory.js:407-507` (the `score` getter — ground truth)

The IncrementalScorer must produce exactly the same results as `CogInventory.score`. This task implements initialization (building the bonus grid and running totals from scratch) and the `score` getter. No swap logic yet.

- [ ] **Step 1: Write failing tests for initialization**

```js
// tests/IncrementalScorer.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { IncrementalScorer } = require('../IncrementalScorer.js');
const { makeCog, buildInventory, assertScoresEqual } = require('./helpers.js');

describe('IncrementalScorer — initialization', () => {
  it('matches full recompute for board with no boost cogs', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 100 }),
      makeCog(1, { expBonus: 50 }),
      makeCog(2, { flaggy: 30 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, inv.score);
  });

  it('matches full recompute for board with adjacent boost cog', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', buildRadiusBoost: 50 }),
      makeCog(1, { buildRate: 200 }),  // position (0,1), adjacent to (0,0)
      makeCog(12, { buildRate: 100 }), // position (1,0), adjacent to (0,0)
      makeCog(13, { buildRate: 100 }), // position (1,1), NOT adjacent to (0,0)
    ]);
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, inv.score);
  });

  it('matches full recompute for board with player cog and expBoost', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', expRadiusBoost: 10 }),
      makeCog(1, { isPlayer: true, expBonus: 100 }),  // adjacent to 0
    ]);
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, inv.score);
  });

  it('matches full recompute for board with flag position and flagBoost', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', flagBoost: 5 }),
      makeCog(1, { flaggy: 100 }),
    ], { flagPose: [1] });
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, inv.score);
  });

  it('matches full recompute with flaggyShopUpgrades multiplier', () => {
    const inv = buildInventory([
      makeCog(0, { flaggy: 200 }),
      makeCog(1, { flaggy: 300 }),
    ], { flaggyShopUpgrades: 3 });
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, inv.score);
  });

  it('matches full recompute with multiple boost cogs of different types', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', buildRadiusBoost: 30 }),
      makeCog(1, { boostRadius: 'diagonal', flaggyRadiusBoost: 20 }),
      makeCog(2, { buildRate: 150, flaggy: 80 }),
      makeCog(12, { buildRate: 100, flaggy: 50, isPlayer: true, expBonus: 40 }),
      makeCog(13, { buildRate: 200 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, inv.score);
  });

  it('handles empty board', () => {
    const inv = buildInventory([]);
    const scorer = new IncrementalScorer(inv);
    assertScoresEqual(scorer.score, inv.score);
  });

  it('fullRecompute matches score getter', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'around', buildRadiusBoost: 25, flaggyRadiusBoost: 15 }),
      makeCog(1, { buildRate: 100, flaggy: 60 }),
      makeCog(11, { buildRate: 80 }),
      makeCog(12, { buildRate: 120, isPlayer: true, expBonus: 50 }),
      makeCog(13, { flaggy: 90 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    const recomputed = scorer.fullRecompute();
    assertScoresEqual(scorer.score, recomputed);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cogtimizer && node --test tests/IncrementalScorer.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement IncrementalScorer initialization**

```js
// IncrementalScorer.js
// Guard require for Web Worker compatibility (globals available via importScripts)
const { getBoostPositions, INV_ROWS, INV_COLUMNS } = typeof require !== 'undefined'
  ? require('./BoostPositions.js')
  : { getBoostPositions, INV_ROWS, INV_COLUMNS };

class IncrementalScorer {
  /**
   * @param {CogInventory} inventory - The inventory to track
   */
  constructor(inventory) {
    this._inv = inventory;
    this._initFromScratch();
  }

  /** Build bonus grid, running totals, and contribution cache from scratch. */
  _initFromScratch() {
    const inv = this._inv;

    // Convert to Sets for O(1) lookups in hot paths
    this._availableSet = new Set(inv.availableSlotKeys);
    this._flagPoseSet = new Set(inv.flagPose);

    // Initialize bonus grid: 8x12, four fields per cell
    this._bonusGrid = Array.from({ length: INV_ROWS }, () =>
      Array.from({ length: INV_COLUMNS }, () => ({
        buildRate: 0, flaggy: 0, expBoost: 0, flagBoost: 0
      }))
    );

    // Per-position contribution cache: what each position currently contributes to running totals
    // Keyed by position key (number). Values: { baseBR, baseFl, baseXP, ceilBR, ceilFl }
    this._contrib = {};

    // Running totals (pre-multiplier for flaggy)
    this._totals = { buildRate: 0, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 };

    // Step 1: Build bonus grid from boost cogs
    for (const key of inv.availableSlotKeys) {
      const cog = inv.get(key);
      if (!cog || !cog.boostRadius) continue;
      const pos = cog.position();
      const affected = getBoostPositions(cog.boostRadius, pos.y, pos.x);
      for (const [r, c] of affected) {
        if (r < 0 || r >= INV_ROWS || c < 0 || c >= INV_COLUMNS) continue;
        const cell = this._bonusGrid[r][c];
        cell.buildRate += cog.buildRadiusBoost || 0;
        cell.flaggy += cog.flaggyRadiusBoost || 0;
        cell.expBoost += cog.expRadiusBoost || 0;
        cell.flagBoost += cog.flagBoost || 0;
      }
    }

    // Step 2: Accumulate base stats and bonus-modified stats
    for (const key of inv.availableSlotKeys) {
      const cog = inv.get(key);
      if (!cog) continue;
      const pos = cog.position();
      const bonus = this._bonusGrid[pos.y][pos.x];

      const baseBR = cog.buildRate || 0;
      const baseXP = cog.expBonus || 0;
      const baseFl = cog.flaggy || 0;
      const ceilBR = Math.ceil(baseBR * (bonus.buildRate || 0) / 100);
      const ceilFl = Math.ceil(baseFl * (bonus.flaggy || 0) / 100);

      this._contrib[key] = { baseBR, baseXP, baseFl, ceilBR, ceilFl };

      this._totals.buildRate += baseBR + ceilBR;
      this._totals.expBonus += baseXP;
      this._totals.flaggy += baseFl + ceilFl;

      if (cog.isPlayer) {
        this._totals.expBoost += bonus.expBoost || 0;
      }
    }

    // Step 3: Flag position flagBoost
    for (const key of inv.flagPose) {
      const cog = inv.get(key);
      if (!cog) continue;
      const pos = cog.position();
      if (pos.y < 0 || pos.y >= INV_ROWS || pos.x < 0 || pos.x >= INV_COLUMNS) continue;
      const bonus = this._bonusGrid[pos.y][pos.x];
      this._totals.flagBoost += bonus.flagBoost || 0;
    }
  }

  /** Return the current score (with flaggy multiplier applied). */
  get score() {
    const flaggyMult = 1 + (this._inv.flaggyShopUpgrades || 0) * 0.5;
    return {
      buildRate: this._totals.buildRate,
      expBonus: this._totals.expBonus,
      flaggy: Math.floor(this._totals.flaggy * flaggyMult),
      expBoost: this._totals.expBoost,
      flagBoost: this._totals.flagBoost
    };
  }

  /** Recompute score from scratch using CogInventory.score (reference implementation). */
  fullRecompute() {
    this._inv._score = null;
    return this._inv.score;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IncrementalScorer };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cogtimizer && node --test tests/IncrementalScorer.test.js`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add IncrementalScorer.js tests/IncrementalScorer.test.js
git commit -m "feat: add IncrementalScorer with initialization and score reading"
```

---

### Task 5: IncrementalScorer swap — non-boost cogs

**Files:**
- Modify: `IncrementalScorer.js`
- Modify: `tests/IncrementalScorer.test.js`

This is the simplest swap case: neither cog has a boostRadius. Only the two swapped positions' contributions change.

- [ ] **Step 1: Write failing tests for non-boost swaps**

Add to `tests/IncrementalScorer.test.js`:

```js
describe('IncrementalScorer — swap non-boost cogs', () => {
  it('matches full recompute after swapping two stat cogs', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 100 }),
      makeCog(1, { buildRate: 200 }),
      makeCog(2, { flaggy: 50 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 1);
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('matches after swapping stat cog with empty position', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 100 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 5); // position 5 has no cog
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('matches after swapping board cog with spare cog', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 100 }),
      makeCog(110, { buildRate: 300 }), // spare area
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 110);
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('matches after multiple sequential swaps', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 100, expBonus: 20 }),
      makeCog(1, { buildRate: 200, flaggy: 30 }),
      makeCog(2, { flaggy: 50, expBonus: 10 }),
      makeCog(3, { buildRate: 150 }),
    ]);
    const scorer = new IncrementalScorer(inv);

    scorer.swap(0, 1);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'after swap 1');

    scorer.swap(2, 3);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'after swap 2');

    scorer.swap(0, 3);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'after swap 3');
  });

  it('undo (swap same positions again) restores original score', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 100 }),
      makeCog(1, { buildRate: 200 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    const originalScore = { ...scorer.score };

    scorer.swap(0, 1);
    scorer.swap(0, 1); // undo

    assertScoresEqual(scorer.score, originalScore);
  });

  it('swap in bonus zone updates contribution correctly', () => {
    // Boost cog at pos 0 radiates to pos 1 (adjacent).
    // Swapping two non-boost cogs at pos 1 and pos 5.
    // Pos 1 is in boost zone, pos 5 is not (unless within radius).
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', buildRadiusBoost: 50 }),
      makeCog(1, { buildRate: 200 }),   // in boost zone of 0
      makeCog(5, { buildRate: 100 }),   // not in boost zone of 0
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(1, 5);
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd cogtimizer && node --test tests/IncrementalScorer.test.js`
Expected: New tests FAIL — `scorer.swap is not a function`

- [ ] **Step 3: Implement `swap` for non-boost cogs**

Add to `IncrementalScorer`:

```js
  /**
   * Swap two cog positions and update scores incrementally.
   * @param {number} posA - First position key
   * @param {number} posB - Second position key
   */
  swap(posA, posB) {
    // Step 1: Withdraw both positions
    this._withdraw(posA);
    this._withdraw(posB);

    // Step 2: Perform the swap in the underlying inventory
    this._inv.move(posA, posB);

    // Step 3: Deposit both positions
    this._deposit(posA);
    this._deposit(posB);
  }

  /** Remove a position's contributions from running totals. */
  _withdraw(pos) {
    const cog = this._inv.get(pos);
    if (!cog) return;

    const contrib = this._contrib[pos];
    if (contrib) {
      this._totals.buildRate -= contrib.baseBR + contrib.ceilBR;
      this._totals.expBonus -= contrib.baseXP;
      this._totals.flaggy -= contrib.baseFl + contrib.ceilFl;
      delete this._contrib[pos];
    }

    // Player cog expBoost
    if (cog.isPlayer) {
      const p = cog.position();
      if (p.y >= 0 && p.y < INV_ROWS && p.x >= 0 && p.x < INV_COLUMNS) {
        this._totals.expBoost -= this._bonusGrid[p.y][p.x].expBoost || 0;
      }
    }

    // Flag position flagBoost
    if (this._flagPoseSet.has(pos)) {
      const p = cog.position();
      if (p.y >= 0 && p.y < INV_ROWS && p.x >= 0 && p.x < INV_COLUMNS) {
        this._totals.flagBoost -= this._bonusGrid[p.y][p.x].flagBoost || 0;
      }
    }

    // Boost cog: remove radius contributions from bonus grid
    if (cog.boostRadius) {
      this._withdrawBoost(cog, pos);
    }
  }

  /** Add a position's contributions to running totals. */
  _deposit(pos) {
    const cog = this._inv.get(pos);
    if (!cog) return;

    // Boost cog: add radius contributions to bonus grid
    if (cog.boostRadius) {
      this._depositBoost(cog, pos);
    }

    // Compute and cache contributions
    const p = cog.position();
    const onBoard = p.y >= 0 && p.y < INV_ROWS && p.x >= 0 && p.x < INV_COLUMNS;

    if (onBoard && this._availableSet.has(pos)) {
      const bonus = this._bonusGrid[p.y][p.x];
      const baseBR = cog.buildRate || 0;
      const baseXP = cog.expBonus || 0;
      const baseFl = cog.flaggy || 0;
      const ceilBR = Math.ceil(baseBR * (bonus.buildRate || 0) / 100);
      const ceilFl = Math.ceil(baseFl * (bonus.flaggy || 0) / 100);

      this._contrib[pos] = { baseBR, baseXP, baseFl, ceilBR, ceilFl };

      this._totals.buildRate += baseBR + ceilBR;
      this._totals.expBonus += baseXP;
      this._totals.flaggy += baseFl + ceilFl;

      // Player cog expBoost
      if (cog.isPlayer) {
        this._totals.expBoost += bonus.expBoost || 0;
      }
    }

    // Flag position flagBoost
    if (this._flagPoseSet.has(pos)) {
      if (onBoard) {
        this._totals.flagBoost += this._bonusGrid[p.y][p.x].flagBoost || 0;
      }
    }
  }

  /** Remove a boost cog's radius contributions from the bonus grid. */
  _withdrawBoost(cog, pos) {
    // Placeholder — implemented in next task
  }

  /** Add a boost cog's radius contributions to the bonus grid. */
  _depositBoost(cog, pos) {
    // Placeholder — implemented in next task
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cogtimizer && node --test tests/IncrementalScorer.test.js`
Expected: All tests PASS (boost cog swap tests are in the next task)

- [ ] **Step 5: Commit**

```bash
git add IncrementalScorer.js tests/IncrementalScorer.test.js
git commit -m "feat: add IncrementalScorer swap for non-boost cogs"
```

---

### Task 6: IncrementalScorer swap — boost cogs

**Files:**
- Modify: `IncrementalScorer.js`
- Modify: `tests/IncrementalScorer.test.js`

When a boost cog is moved, its radius contributions change in the bonus grid, which affects the ceiled contributions of every cog at the affected positions. This is the core complexity of incremental scoring.

- [ ] **Step 1: Write failing tests for boost cog swaps**

Add to `tests/IncrementalScorer.test.js`:

```js
describe('IncrementalScorer — swap boost cogs', () => {
  it('matches after swapping boost cog with stat cog', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', buildRadiusBoost: 50 }),
      makeCog(1, { buildRate: 200 }),
      makeCog(2, { buildRate: 100 }),
      makeCog(12, { buildRate: 150 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 2); // move boost cog from pos 0 to pos 2
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('matches after swapping two boost cogs', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', buildRadiusBoost: 50 }),
      makeCog(1, { boostRadius: 'diagonal', flaggyRadiusBoost: 30 }),
      makeCog(2, { buildRate: 200, flaggy: 100 }),
      makeCog(12, { buildRate: 100 }),
      makeCog(13, { buildRate: 150, flaggy: 80 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 1); // swap two boost cogs
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('matches with row boost cog swap', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'row', buildRadiusBoost: 20 }),
      makeCog(1, { buildRate: 100 }),
      makeCog(5, { buildRate: 200 }),
      makeCog(11, { buildRate: 150 }),
      makeCog(12, { buildRate: 80 }), // different row
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 12); // move row boost to different row
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('matches with column boost cog swap', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'column', buildRadiusBoost: 25 }),
      makeCog(12, { buildRate: 100 }),
      makeCog(24, { buildRate: 200 }),
      makeCog(1, { buildRate: 150 }), // different column
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 1);
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('matches with around boost cog swap', () => {
    const inv = buildInventory([
      makeCog(25, { boostRadius: 'around', buildRadiusBoost: 15, flaggyRadiusBoost: 10 }),
      makeCog(13, { buildRate: 100, flaggy: 50 }),
      makeCog(14, { buildRate: 200 }),
      makeCog(24, { buildRate: 120, flaggy: 30 }),
      makeCog(26, { flaggy: 80 }),
      makeCog(37, { buildRate: 90 }),
      makeCog(50, { buildRate: 60 }), // swap target, far away
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(25, 50);
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('matches with corners boost cog swap', () => {
    const inv = buildInventory([
      makeCog(25, { boostRadius: 'corners', buildRadiusBoost: 40 }),
      makeCog(1, { buildRate: 100 }),  // (0,1) — corner at (row-2, col-2) = (-1, -1) is OOB
      makeCog(3, { buildRate: 100 }),  // (0,3) — at (row-2, col+2) for 25=(2,1)
      makeCog(49, { buildRate: 100 }), // (4,1) — at (row+2, col-2) is OOB, but (4,3) hits
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(25, 49);
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('matches with up/down/left/right boost cog swaps', () => {
    const cogs = [
      makeCog(25, { boostRadius: 'up', buildRadiusBoost: 20 }),
      makeCog(37, { boostRadius: 'down', flaggyRadiusBoost: 15 }),
      makeCog(49, { boostRadius: 'left', buildRadiusBoost: 10 }),
      makeCog(61, { boostRadius: 'right', flaggyRadiusBoost: 25 }),
    ];
    // Fill some stat cogs around them
    for (let i = 0; i < 96; i++) {
      if ([25, 37, 49, 61].includes(i)) continue;
      if (i % 7 === 0) cogs.push(makeCog(i, { buildRate: 100 + i, flaggy: 50 + i }));
    }
    const inv = buildInventory(cogs);
    const scorer = new IncrementalScorer(inv);

    scorer.swap(25, 37);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'after swap up/down');

    scorer.swap(49, 61);
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'after swap left/right');
  });

  it('handles boost cog affecting player cog expBoost', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', expRadiusBoost: 10 }),
      makeCog(1, { isPlayer: true, expBonus: 100 }),
      makeCog(5, { buildRate: 50 }),
    ]);
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 5); // move boost away from player
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('handles boost cog affecting flag position flagBoost', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', flagBoost: 5 }),
      makeCog(1, { flaggy: 100 }),
      makeCog(5, { buildRate: 50 }),
    ], { flagPose: [1] });
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 5); // move boost away from flag
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('handles boost cog moved from board to spare area', () => {
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'adjacent', buildRadiusBoost: 40, flagBoost: 3 }),
      makeCog(1, { buildRate: 200, flaggy: 100 }),
      makeCog(12, { buildRate: 150 }),
      makeCog(110, { buildRate: 50 }), // spare cog
    ], { flagPose: [1] });
    const scorer = new IncrementalScorer(inv);
    scorer.swap(0, 110); // move boost cog to spare area
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });

  it('handles boost cog swap when radius covers flag positions', () => {
    // Row boost at row 0 covers all columns in row 0.
    // Flag at position 5 (row 0, col 5) should get flagBoost from the row boost cog.
    const inv = buildInventory([
      makeCog(0, { boostRadius: 'row', flagBoost: 7 }),
      makeCog(5, { flaggy: 200 }),
      makeCog(13, { buildRate: 100 }), // row 1
    ], { flagPose: [5] });
    const scorer = new IncrementalScorer(inv);
    // Move row boost to different row — flag position should lose flagBoost
    scorer.swap(0, 13);
    assertScoresEqual(scorer.score, scorer.fullRecompute());
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `cd cogtimizer && node --test tests/IncrementalScorer.test.js`
Expected: Boost cog swap tests FAIL (placeholder methods do nothing)

- [ ] **Step 3: Implement `_withdrawBoost` and `_depositBoost`**

Replace the placeholder methods in `IncrementalScorer.js`:

```js
  /**
   * Remove a boost cog's radius contributions from the bonus grid,
   * and update the ceiled contributions of all affected cogs.
   */
  _withdrawBoost(cog, pos) {
    const p = cog.position();
    const affected = getBoostPositions(cog.boostRadius, p.y, p.x);

    for (const [r, c] of affected) {
      if (r < 0 || r >= INV_ROWS || c < 0 || c >= INV_COLUMNS) continue;
      const cell = this._bonusGrid[r][c];

      // Remove boost contributions from grid
      cell.buildRate -= cog.buildRadiusBoost || 0;
      cell.flaggy -= cog.flaggyRadiusBoost || 0;
      cell.expBoost -= cog.expRadiusBoost || 0;
      cell.flagBoost -= cog.flagBoost || 0;

      // Update ceiled contributions of the cog at this position
      const affectedKey = r * INV_COLUMNS + c;
      this._updateContribAt(affectedKey);

      // Flag positions are NOT in availableSlotKeys, so _updateContribAt skips them.
      // Handle flagBoost at flag positions separately.
      if (this._flagPoseSet.has(affectedKey)) {
        this._totals.flagBoost -= cog.flagBoost || 0;
      }
    }
  }

  /**
   * Add a boost cog's radius contributions to the bonus grid,
   * and update the ceiled contributions of all affected cogs.
   */
  _depositBoost(cog, pos) {
    const p = cog.position();
    const affected = getBoostPositions(cog.boostRadius, p.y, p.x);

    for (const [r, c] of affected) {
      if (r < 0 || r >= INV_ROWS || c < 0 || c >= INV_COLUMNS) continue;
      const cell = this._bonusGrid[r][c];

      // Add boost contributions to grid
      cell.buildRate += cog.buildRadiusBoost || 0;
      cell.flaggy += cog.flaggyRadiusBoost || 0;
      cell.expBoost += cog.expRadiusBoost || 0;
      cell.flagBoost += cog.flagBoost || 0;

      // Update ceiled contributions of the cog at this position
      const affectedKey = r * INV_COLUMNS + c;
      this._updateContribAt(affectedKey);

      // Handle flagBoost at flag positions separately (not in availableSlotKeys)
      if (this._flagPoseSet.has(affectedKey)) {
        this._totals.flagBoost += cog.flagBoost || 0;
      }
    }
  }

  /**
   * Recompute and update the ceiled contribution of the cog at a given position.
   * Called when the bonus grid changes at that position.
   */
  _updateContribAt(key) {
    if (!this._availableSet.has(key)) return;
    const cog = this._inv.get(key);
    if (!cog) return;

    const oldContrib = this._contrib[key];
    if (oldContrib) {
      // Remove old ceiled values (base stats don't change, only ceiled bonus changes)
      this._totals.buildRate -= oldContrib.ceilBR;
      this._totals.flaggy -= oldContrib.ceilFl;
    }

    const p = cog.position();
    const bonus = this._bonusGrid[p.y][p.x];
    const baseBR = cog.buildRate || 0;
    const baseFl = cog.flaggy || 0;
    const newCeilBR = Math.ceil(baseBR * (bonus.buildRate || 0) / 100);
    const newCeilFl = Math.ceil(baseFl * (bonus.flaggy || 0) / 100);

    if (oldContrib) {
      oldContrib.ceilBR = newCeilBR;
      oldContrib.ceilFl = newCeilFl;
    }

    this._totals.buildRate += newCeilBR;
    this._totals.flaggy += newCeilFl;

    // Update player expBoost if bonus grid expBoost changed at a player position
    if (cog.isPlayer && oldContrib) {
      // expBoost is read from grid — we need to recalculate it
      // But we can't easily diff it here since we don't cache per-position expBoost.
      // This is handled by withdraw/deposit of the player cog itself.
      // For bonus grid changes affecting a stationary player cog, we need to handle it here.
      // However, the player cog's expBoost contribution depends on the grid value,
      // which just changed. We need to withdraw and re-deposit the expBoost portion.
    }
  }
```

Wait — this reveals a subtlety. When a boost cog moves, the bonus grid changes at affected positions. If any of those positions has a player cog, the `expBoost` contribution changes. Similarly for flag positions and `flagBoost`. The `_updateContribAt` method needs to handle these cases too.

Let me revise the approach. Instead of `_updateContribAt` only handling ceiled contributions, let's have it do a full re-deposit for the affected position (but without re-withdrawing base stats, since those didn't change).

Actually, a cleaner approach: `_updateContribAt` handles the delta for bonus-dependent fields only (ceilBR, ceilFl, expBoost at player positions, flagBoost at flag positions). Base stats don't change when the bonus grid changes.

```js
  _updateContribAt(key) {
    if (!this._availableSet.has(key)) return;
    const cog = this._inv.get(key);
    if (!cog) return;

    const oldContrib = this._contrib[key];
    if (!oldContrib) return; // No contribution to update (cog was already withdrawn)

    const p = cog.position();
    const bonus = this._bonusGrid[p.y][p.x];

    // Update ceiled buildRate
    const newCeilBR = Math.ceil((cog.buildRate || 0) * (bonus.buildRate || 0) / 100);
    this._totals.buildRate += newCeilBR - oldContrib.ceilBR;
    oldContrib.ceilBR = newCeilBR;

    // Update ceiled flaggy
    const newCeilFl = Math.ceil((cog.flaggy || 0) * (bonus.flaggy || 0) / 100);
    this._totals.flaggy += newCeilFl - oldContrib.ceilFl;
    oldContrib.ceilFl = newCeilFl;

    // If player cog, update expBoost
    if (cog.isPlayer) {
      // We need to track old expBoost per player position
      const oldExpBoost = oldContrib.expBoost || 0;
      const newExpBoost = bonus.expBoost || 0;
      this._totals.expBoost += newExpBoost - oldExpBoost;
      oldContrib.expBoost = newExpBoost;
    }

    // If flag position, update flagBoost
    if (this._flagPoseSet.has(key)) {
      const oldFlagBoost = oldContrib.flagBoostContrib || 0;
      const newFlagBoost = bonus.flagBoost || 0;
      this._totals.flagBoost += newFlagBoost - oldFlagBoost;
      oldContrib.flagBoostContrib = newFlagBoost;
    }
  }
```

This means the `_contrib` cache also needs to store `expBoost` for player cogs and `flagBoostContrib` for flag positions. Update `_initFromScratch` to include these.

In `_initFromScratch`, update the contrib cache creation:
```js
      const contribEntry = { baseBR, baseXP, baseFl, ceilBR, ceilFl };
      if (cog.isPlayer) {
        contribEntry.expBoost = bonus.expBoost || 0;
      }
      if (this.flagPose.includes(Number(key))) {
        contribEntry.flagBoostContrib = bonus.flagBoost || 0;
      }
      this._contrib[key] = contribEntry;
```

And update `_withdraw`/`_deposit` to not double-count expBoost/flagBoost — since `_updateContribAt` now tracks them in the contrib cache, the withdraw/deposit for player/flag cogs should also use the cached values.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cogtimizer && node --test tests/IncrementalScorer.test.js`
Expected: All tests PASS

- [ ] **Step 5: Commit**

```bash
git add IncrementalScorer.js tests/IncrementalScorer.test.js
git commit -m "feat: add IncrementalScorer swap support for boost cogs"
```

---

### Task 7: IncrementalScorer stress test

**Files:**
- Modify: `tests/IncrementalScorer.test.js`

- [ ] **Step 1: Write stress test using SeededRng and fixture data**

Add to `tests/IncrementalScorer.test.js`:

```js
const { SeededRng } = require('../SeededRng.js');

describe('IncrementalScorer — stress tests', () => {
  function makeStressBoard(rng, cogCount = 60, boostCount = 8) {
    const radiusTypes = ['adjacent', 'diagonal', 'up', 'down', 'left', 'right', 'row', 'column', 'corners', 'around'];
    const cogs = [];
    const usedKeys = new Set();

    // Place boost cogs
    for (let i = 0; i < boostCount; i++) {
      let key;
      do { key = rng.randInt(96); } while (usedKeys.has(key));
      usedKeys.add(key);
      cogs.push(makeCog(key, {
        boostRadius: rng.pick(radiusTypes),
        buildRadiusBoost: rng.randInt(50) + 10,
        flaggyRadiusBoost: rng.randInt(30),
        expRadiusBoost: rng.randInt(20),
        flagBoost: rng.randInt(10),
        buildRate: rng.randInt(100),
        flaggy: rng.randInt(80),
      }));
    }

    // Place stat cogs
    for (let i = 0; i < cogCount; i++) {
      let key;
      do { key = rng.randInt(96); } while (usedKeys.has(key));
      usedKeys.add(key);
      cogs.push(makeCog(key, {
        buildRate: rng.randInt(500) + 50,
        expBonus: rng.randInt(200),
        flaggy: rng.randInt(300),
        isPlayer: i < 2, // first two are player cogs
      }));
    }

    // Add some spare cogs
    for (let i = 0; i < 20; i++) {
      const key = 110 + i;
      cogs.push(makeCog(key, {
        buildRate: rng.randInt(300),
        expBonus: rng.randInt(100),
        flaggy: rng.randInt(200),
      }));
    }

    const flagPose = [cogs[boostCount + 2].key, cogs[boostCount + 3].key]; // two flag positions
    return buildInventory(cogs, { flagPose, flaggyShopUpgrades: 2, playerCount: 10 });
  }

  it('matches full recompute after 10,000 random swaps', () => {
    const rng = new SeededRng(42);
    const inv = makeStressBoard(rng);
    const scorer = new IncrementalScorer(inv);
    const allKeys = inv.availableSlotKeys;

    for (let i = 0; i < 10000; i++) {
      const a = rng.pick(allKeys);
      let b;
      // Mix board-board and board-spare swaps
      if (rng.random() < 0.3) {
        b = 110 + rng.randInt(20);
      } else {
        do { b = rng.pick(allKeys); } while (b === a);
      }
      scorer.swap(a, b);

      // Verify every 1000 swaps
      if (i % 1000 === 0) {
        assertScoresEqual(scorer.score, scorer.fullRecompute(), `mismatch at swap ${i}`);
      }
    }
    // Final check
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'final mismatch');
  });

  it('matches full recompute after 10,000 swaps with different seed', () => {
    const rng = new SeededRng(999);
    const inv = makeStressBoard(rng, 70, 12);
    const scorer = new IncrementalScorer(inv);
    const allKeys = inv.availableSlotKeys;

    for (let i = 0; i < 10000; i++) {
      const a = rng.pick(allKeys);
      let b;
      if (rng.random() < 0.3) {
        b = 110 + rng.randInt(20);
      } else {
        do { b = rng.pick(allKeys); } while (b === a);
      }
      scorer.swap(a, b);

      if (i % 1000 === 0) {
        assertScoresEqual(scorer.score, scorer.fullRecompute(), `mismatch at swap ${i}`);
      }
    }
    assertScoresEqual(scorer.score, scorer.fullRecompute(), 'final mismatch');
  });

  it('undo-redo produces same score 1000 times', () => {
    const rng = new SeededRng(777);
    const inv = makeStressBoard(rng);
    const scorer = new IncrementalScorer(inv);
    const allKeys = inv.availableSlotKeys;

    for (let i = 0; i < 1000; i++) {
      const a = rng.pick(allKeys);
      let b;
      do { b = rng.pick(allKeys); } while (b === a);

      const before = { ...scorer.score };
      scorer.swap(a, b);
      scorer.swap(a, b); // undo
      assertScoresEqual(scorer.score, before, `undo-redo mismatch at iteration ${i}`);
    }
  });
});
```

- [ ] **Step 2: Run stress tests**

Run: `cd cogtimizer && node --test tests/IncrementalScorer.test.js`
Expected: All tests PASS (may take a few seconds for 10k iterations)

- [ ] **Step 3: Commit**

```bash
git add tests/IncrementalScorer.test.js
git commit -m "test: add IncrementalScorer stress tests with 10k random swaps"
```

---

## Chunk 3: Greedy Construction, Serialization, getScoreSum extraction

### Task 8: Extract `getScoreSum` from Solver

**Files:**
- Modify: `Solver.js`

The `getScoreSum` function is needed by all algorithms but is currently a method on the `Solver` class. Extract it as a standalone function.

- [ ] **Step 1: Extract `getScoreSum` as standalone function**

At the bottom of `Solver.js`, before the `module.exports` guard, make `getScoreSum` and `removeUselesMoves` available:

```js
/**
 * Compute a single scalar score from the five-field score object.
 * @param {Object} score - { buildRate, expBonus, flaggy, expBoost, flagBoost }
 * @param {Object} weights - { buildRate, expBonus, flaggy }
 * @param {Object|null} targets - { buildRate, expBonus, flaggy } or null
 * @param {number} playerCount
 * @param {number} flagCount
 * @returns {number}
 */
function getScoreSum(score, weights, targets, playerCount, flagCount) {
  if (targets) {
    const br = targets.buildRate > 0 ? Math.min(score.buildRate / targets.buildRate, 1.0) : 1.0;
    const xpEff = score.expBonus * (score.expBoost + playerCount) / playerCount;
    const xp = targets.expBonus > 0 ? Math.min(xpEff / targets.expBonus, 1.0) : 1.0;
    const flEff = score.flaggy * (score.flagBoost + flagCount) / flagCount;
    const fl = targets.flaggy > 0 ? Math.min(flEff / targets.flaggy, 1.0) : 1.0;
    return br * xp * fl;
  }
  let res = 0;
  res += score.buildRate * weights.buildRate;
  res += score.expBonus * weights.expBonus * (score.expBoost + playerCount) / playerCount;
  res += score.flaggy * weights.flaggy * (score.flagBoost + flagCount) / flagCount;
  return res;
}
```

Update the `Solver` class to call the standalone function internally, and update `module.exports`:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Solver, getScoreSum };
}
```

The `Solver.getScoreSum` method should delegate to the standalone function so the existing index.html code continues working.

- [ ] **Step 2: Verify existing behavior unchanged**

Run: `cd cogtimizer && node --test tests/StepOptimizer.test.js`
Expected: All existing tests PASS

- [ ] **Step 3: Commit**

```bash
git add Solver.js
git commit -m "refactor: extract getScoreSum as standalone function for shared use"
```

---

### Task 9: Serializer

**Files:**
- Create: `Serializer.js`
- Test: `tests/Serializer.test.js`

Serialize/deserialize `CogInventory` for Web Worker communication. Based on the `clone()` pattern.

- [ ] **Step 1: Write failing tests**

```js
// tests/Serializer.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { serialize, deserialize } = require('../Serializer.js');
const { makeCog, buildInventory, assertScoresEqual } = require('./helpers.js');

describe('Serializer', () => {
  it('round-trips a simple inventory', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 100 }),
      makeCog(1, { expBonus: 50 }),
    ]);
    const json = serialize(inv);
    const restored = deserialize(json);
    assertScoresEqual(restored.score, inv.score);
  });

  it('round-trips boost cogs with all properties', () => {
    const inv = buildInventory([
      makeCog(0, {
        boostRadius: 'adjacent',
        buildRadiusBoost: 50,
        expRadiusBoost: 10,
        flaggyRadiusBoost: 20,
        flagBoost: 5,
        buildRate: 30,
      }),
      makeCog(1, { buildRate: 200 }),
    ]);
    const json = serialize(inv);
    const restored = deserialize(json);
    assertScoresEqual(restored.score, inv.score);
    assert.strictEqual(restored.get(0).boostRadius, 'adjacent');
    assert.strictEqual(restored.get(0).buildRadiusBoost, 50);
  });

  it('preserves player cog properties', () => {
    const inv = buildInventory([
      makeCog(0, { isPlayer: true, expBonus: 100 }),
    ]);
    const json = serialize(inv);
    const restored = deserialize(json);
    assert.strictEqual(restored.get(0).isPlayer, true);
  });

  it('preserves fixed/blocked properties', () => {
    const inv = buildInventory([
      makeCog(0, { fixed: true, boostRadius: 'everything' }),
    ]);
    const json = serialize(inv);
    const restored = deserialize(json);
    assert.strictEqual(restored.get(0).fixed, true);
  });

  it('preserves inventory metadata', () => {
    const inv = buildInventory(
      [makeCog(0, { buildRate: 100 })],
      { flagPose: [1, 5], flaggyShopUpgrades: 3, playerCount: 8 }
    );
    const json = serialize(inv);
    const restored = deserialize(json);
    assert.deepStrictEqual(restored.flagPose, [1, 5]);
    assert.strictEqual(restored.flaggyShopUpgrades, 3);
    assert.strictEqual(restored.playerCount, 8);
  });

  it('preserves availableSlotKeys', () => {
    const inv = buildInventory(
      [makeCog(0, { buildRate: 100 })],
      { blockedKeys: [5, 10] }
    );
    const json = serialize(inv);
    const restored = deserialize(json);
    assert.ok(!restored.availableSlotKeys.includes(5));
    assert.ok(!restored.availableSlotKeys.includes(10));
    assert.ok(restored.availableSlotKeys.includes(0));
  });

  it('serialized form is valid JSON string', () => {
    const inv = buildInventory([makeCog(0, { buildRate: 100 })]);
    const json = serialize(inv);
    assert.doesNotThrow(() => JSON.parse(json));
  });

  it('preserves initialKey (for step tracking)', () => {
    const inv = buildInventory([
      makeCog(5, { initialKey: 0, buildRate: 100 }),
    ]);
    const json = serialize(inv);
    const restored = deserialize(json);
    assert.strictEqual(restored.get(5).initialKey, 0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cogtimizer && node --test tests/Serializer.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement Serializer**

```js
// Serializer.js
const { Cog, CogInventory } = typeof require !== 'undefined'
  ? require('./CogInventory.js')
  : { Cog, CogInventory };

const COG_FIELDS = [
  'key', 'initialKey', 'icon', 'buildRate', 'isPlayer', 'isFlag', 'expGain',
  'flaggy', 'expBonus', 'buildRadiusBoost', 'expRadiusBoost', 'flaggyRadiusBoost',
  'boostRadius', 'flagBoost', 'nothing', 'fixed', 'blocked'
];

function serializeCog(cog) {
  const obj = {};
  for (const f of COG_FIELDS) {
    if (cog[f] !== undefined && cog[f] !== null && cog[f] !== 0 && cog[f] !== false) {
      obj[f] = cog[f];
    }
  }
  // Always include key and initialKey
  obj.key = cog.key;
  if (cog.initialKey !== undefined) obj.initialKey = cog.initialKey;
  return obj;
}

function serialize(inventory) {
  const data = {
    cogs: {},
    slots: {},
    flagPose: inventory.flagPose,
    flaggyShopUpgrades: inventory.flaggyShopUpgrades,
    playerCount: inventory.playerCount,
    spareSlotCount: inventory.spareSlotCount,
    availableSlotKeys: inventory.availableSlotKeys,
    lockedSlotsRemaining: inventory.lockedSlotsRemaining || 0,
    tinyMultipliers: inventory.tinyMultipliers || { buildRate: 1, expBonus: 1, flaggy: 1 },
  };
  for (const [k, v] of Object.entries(inventory.cogs)) {
    data.cogs[k] = serializeCog(v);
  }
  for (const [k, v] of Object.entries(inventory.slots)) {
    data.slots[k] = serializeCog(v);
  }
  return JSON.stringify(data);
}

function deserialize(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const cogs = {};
  for (const [k, v] of Object.entries(data.cogs)) {
    cogs[k] = new Cog(v);
  }
  const slots = {};
  for (const [k, v] of Object.entries(data.slots)) {
    slots[k] = new Cog(v);
  }
  const inv = new CogInventory(cogs, slots);
  inv.flagPose = data.flagPose || [];
  inv.flaggyShopUpgrades = data.flaggyShopUpgrades || 0;
  inv.playerCount = data.playerCount || 10;
  inv.spareSlotCount = data.spareSlotCount || 96;
  inv.availableSlotKeys = data.availableSlotKeys || [];
  inv.lockedSlotsRemaining = data.lockedSlotsRemaining || 0;
  inv.tinyMultipliers = data.tinyMultipliers || { buildRate: 1, expBonus: 1, flaggy: 1 };
  return inv;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { serialize, deserialize };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cogtimizer && node --test tests/Serializer.test.js`
Expected: All 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add Serializer.js tests/Serializer.test.js
git commit -m "feat: add CogInventory serializer for Web Worker communication"
```

---

### Task 10: Greedy construction heuristic

**Files:**
- Create: `GreedyInit.js`
- Test: `tests/GreedyInit.test.js`
- Reference: Spec section 1.2

- [ ] **Step 1: Write failing tests**

```js
// tests/GreedyInit.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { greedyInit } = require('../GreedyInit.js');
const { makeCog, buildInventory } = require('./helpers.js');
const { SeededRng } = require('../SeededRng.js');

describe('greedyInit', () => {
  it('returns a valid board state', () => {
    const cogs = [];
    for (let i = 0; i < 30; i++) {
      cogs.push(makeCog(i, { buildRate: 100 + i * 10 }));
    }
    const inv = buildInventory(cogs);
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const result = greedyInit(inv, weights);

    // No duplicate cog keys
    const keys = Object.keys(result.cogs);
    const keySet = new Set(keys);
    assert.strictEqual(keys.length, keySet.size, 'duplicate cog keys');
  });

  it('produces higher score than random shuffle', () => {
    const rng = new SeededRng(42);
    const cogs = [];
    // Board cogs
    for (let i = 0; i < 40; i++) {
      cogs.push(makeCog(i, { buildRate: rng.randInt(500) + 50 }));
    }
    // Some boost cogs
    cogs.push(makeCog(50, { boostRadius: 'adjacent', buildRadiusBoost: 30 }));
    cogs.push(makeCog(51, { boostRadius: 'diagonal', buildRadiusBoost: 20 }));
    // Spare cogs
    for (let i = 0; i < 20; i++) {
      cogs.push(makeCog(110 + i, { buildRate: rng.randInt(300) }));
    }

    const inv = buildInventory(cogs);
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const greedyResult = greedyInit(inv, weights);
    const greedyScore = greedyResult.score.buildRate;

    // Compare against 50 random shuffles
    let shuffleBetter = 0;
    for (let trial = 0; trial < 50; trial++) {
      const clone = inv.clone();
      // Random shuffle: 200 random swaps
      const allSlots = clone.availableSlotKeys;
      for (let s = 0; s < 200; s++) {
        const a = allSlots[rng.randInt(allSlots.length)];
        const allKeys = clone.cogKeys;
        const b = allKeys[rng.randInt(allKeys.length)];
        const cogA = clone.get(a);
        const cogB = clone.get(b);
        if (cogA && cogA.fixed) continue;
        if (cogB && cogB.fixed) continue;
        clone.move(a, b);
      }
      if (clone.score.buildRate > greedyScore) shuffleBetter++;
    }
    // Greedy should beat most random shuffles
    assert.ok(shuffleBetter < 10, `Greedy lost to ${shuffleBetter}/50 shuffles`);
  });

  it('places boost cogs on the board', () => {
    const cogs = [
      makeCog(0, { buildRate: 100 }),
      makeCog(110, { boostRadius: 'adjacent', buildRadiusBoost: 50 }), // spare boost cog
    ];
    const inv = buildInventory(cogs);
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const result = greedyInit(inv, weights);

    // The boost cog should have been moved to the board
    const boostCog = Object.values(result.cogs).find(c => c.boostRadius === 'adjacent');
    assert.ok(boostCog, 'boost cog should exist');
    assert.ok(boostCog.key < 96, 'boost cog should be on the board');
  });

  it('does not move fixed cogs', () => {
    const cogs = [
      makeCog(0, { fixed: true, boostRadius: 'everything', buildRadiusBoost: 10 }),
      makeCog(1, { buildRate: 100 }),
    ];
    const inv = buildInventory(cogs);
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const result = greedyInit(inv, weights);

    assert.strictEqual(result.get(0).key, 0, 'fixed cog should not move');
    assert.strictEqual(result.get(0).boostRadius, 'everything');
  });

  it('respects blocked positions', () => {
    const cogs = [
      makeCog(0, { buildRate: 100 }),
      makeCog(1, { buildRate: 200 }),
    ];
    const inv = buildInventory(cogs, { blockedKeys: [5] });
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const result = greedyInit(inv, weights);

    // Position 5 should not have a cog assigned
    assert.ok(!result.cogs[5] || result.get(5).blocked, 'blocked position should be empty');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd cogtimizer && node --test tests/GreedyInit.test.js`
Expected: FAIL — module not found

- [ ] **Step 3: Implement GreedyInit**

```js
// GreedyInit.js
const { getBoostPositions, INV_ROWS, INV_COLUMNS } = typeof require !== 'undefined'
  ? require('./BoostPositions.js')
  : { getBoostPositions, INV_ROWS, INV_COLUMNS };
const SPARE_START = 108;

/**
 * Produce a high-quality initial board placement using a greedy heuristic.
 * @param {CogInventory} inventory - The starting inventory (will be cloned)
 * @param {Object} weights - { buildRate, expBonus, flaggy }
 * @param {Object|null} targets - { buildRate, expBonus, flaggy } or null
 * @returns {CogInventory} - A new inventory with greedy placement
 */
function greedyInit(inventory, weights, targets = null) {
  const inv = inventory.clone();
  const availableSlots = [...inv.availableSlotKeys];

  // Collect all cogs (board + spare), excluding fixed and build-area
  const allCogs = Object.values(inv.cogs).filter(c => {
    if (c.fixed) return false;
    const pos = c.position();
    if (pos.location === 'build') return false;
    return true;
  });

  // Remove all movable cogs from the inventory to avoid displacement during placement.
  // We'll re-assign them to positions via direct key manipulation (not inv.move()).
  for (const cog of allCogs) {
    delete inv.cogs[cog.key];
  }
  // Now all available board positions are empty. We'll place cogs by inserting directly.

  /** Place a cog at a position by direct key assignment. */
  function placeCog(cog, pos) {
    cog.key = pos;
    cog._position = null; // clear cached position
    inv.cogs[pos] = cog;
  }

  // Classify cogs
  const localBoostCogs = allCogs.filter(c => c.boostRadius && c.boostRadius !== 'everything');
  const everythingCogs = allCogs.filter(c => c.boostRadius === 'everything');
  const statCogs = allCogs.filter(c => !c.boostRadius);

  // Score a cog's raw value for ranking
  function rawScore(cog) {
    let s = 0;
    s += (cog.buildRate || 0) * (weights.buildRate || 0);
    s += (cog.expBonus || 0) * (weights.expBonus || 0);
    s += (cog.flaggy || 0) * (weights.flaggy || 0);
    return s;
  }

  // Score a boost cog's impact
  function boostScore(cog) {
    const coverage = getBoostPositions(cog.boostRadius, 4, 6) // center-ish position
      .filter(([r, c]) => r >= 0 && r < INV_ROWS && c >= 0 && c < INV_COLUMNS).length;
    const magnitude = (cog.buildRadiusBoost || 0) * (weights.buildRate || 0)
      + (cog.flaggyRadiusBoost || 0) * (weights.flaggy || 0)
      + (cog.expRadiusBoost || 0) * (weights.expBonus || 0)
      + (cog.flagBoost || 0) * (weights.flaggy || 0);
    return magnitude * coverage + rawScore(cog);
  }

  // Sort boost cogs by impact (highest first)
  localBoostCogs.sort((a, b) => boostScore(b) - boostScore(a));
  statCogs.sort((a, b) => rawScore(b) - rawScore(a));

  // Track which positions are open and which cogs are placed
  const openPositions = new Set(availableSlots.filter(k => {
    // Exclude positions with fixed cogs
    const cog = inv.get(k);
    return !cog || !cog.fixed;
  }));
  const placedCogs = new Set();

  // Note: fixed cogs (including everything cogs already on board) stay where they are

  // Step 1: Place local boost cogs
  for (const boostCog of localBoostCogs) {
    if (openPositions.size === 0) break;
    let bestPos = -1;
    let bestCoverage = -1;

    for (const pos of openPositions) {
      const row = Math.floor(pos / INV_COLUMNS);
      const col = pos % INV_COLUMNS;
      const affected = getBoostPositions(boostCog.boostRadius, row, col);
      const coverage = affected.filter(([r, c]) =>
        r >= 0 && r < INV_ROWS && c >= 0 && c < INV_COLUMNS
      ).length;
      if (coverage > bestCoverage) {
        bestCoverage = coverage;
        bestPos = pos;
      }
    }

    if (bestPos >= 0) {
      placeCog(boostCog, bestPos);
      openPositions.delete(bestPos);
      placedCogs.add(boostCog);
    }
  }

  // Step 2: Place everything cogs in lowest-opportunity-cost positions
  // Build a temporary bonus grid from placed boost cogs to evaluate positions
  const bonusGrid = Array.from({ length: INV_ROWS }, () =>
    Array.from({ length: INV_COLUMNS }, () => ({ buildRate: 0, flaggy: 0 }))
  );
  for (const key of availableSlots) {
    const cog = inv.get(key);
    if (!cog || !cog.boostRadius || cog.boostRadius === 'everything') continue;
    const pos = cog.position();
    const affected = getBoostPositions(cog.boostRadius, pos.y, pos.x);
    for (const [r, c] of affected) {
      if (r < 0 || r >= INV_ROWS || c < 0 || c >= INV_COLUMNS) continue;
      bonusGrid[r][c].buildRate += cog.buildRadiusBoost || 0;
      bonusGrid[r][c].flaggy += cog.flaggyRadiusBoost || 0;
    }
  }

  // For each everything cog, find the position with smallest opportunity cost
  for (const evCog of everythingCogs) {
    if (openPositions.size === 0) break;
    if (evCog.fixed) continue; // already placed

    const evScore = rawScore(evCog);
    let bestPos = -1;
    let bestDiff = Infinity; // smallest difference = lowest opportunity cost

    // Find the best stat cog available for comparison
    const topStatCog = statCogs.find(c => !placedCogs.has(c));
    const topStatScore = topStatCog ? rawScore(topStatCog) : 0;

    for (const pos of openPositions) {
      const row = Math.floor(pos / INV_COLUMNS);
      const col = pos % INV_COLUMNS;
      const bonus = bonusGrid[row][col];

      // Score of everything cog at this position (with bonuses)
      const evAtPos = evScore + Math.ceil((evCog.buildRate || 0) * (bonus.buildRate || 0) / 100)
        + Math.ceil((evCog.flaggy || 0) * (bonus.flaggy || 0) / 100);

      // Score of best stat cog at this position
      const statAtPos = topStatCog
        ? topStatScore + Math.ceil((topStatCog.buildRate || 0) * (bonus.buildRate || 0) / 100)
          + Math.ceil((topStatCog.flaggy || 0) * (bonus.flaggy || 0) / 100)
        : 0;

      const diff = statAtPos - evAtPos; // lower = less opportunity cost
      if (diff < bestDiff) {
        bestDiff = diff;
        bestPos = pos;
      }
    }

    if (bestPos >= 0) {
      placeCog(evCog, bestPos);
      openPositions.delete(bestPos);
      placedCogs.add(evCog);
    }
  }

  // Step 3: Place stat cogs in remaining positions (highest bonus first)
  const openPosArray = [...openPositions].sort((a, b) => {
    const rowA = Math.floor(a / INV_COLUMNS), colA = a % INV_COLUMNS;
    const rowB = Math.floor(b / INV_COLUMNS), colB = b % INV_COLUMNS;
    const bonusA = (bonusGrid[rowA][colA].buildRate || 0) * (weights.buildRate || 0)
      + (bonusGrid[rowA][colA].flaggy || 0) * (weights.flaggy || 0);
    const bonusB = (bonusGrid[rowB][colB].buildRate || 0) * (weights.buildRate || 0)
      + (bonusGrid[rowB][colB].flaggy || 0) * (weights.flaggy || 0);
    return bonusB - bonusA; // highest bonus first
  });

  const remainingStats = statCogs.filter(c => !placedCogs.has(c));

  for (let i = 0; i < openPosArray.length && i < remainingStats.length; i++) {
    const pos = openPosArray[i];
    const cog = remainingStats[i];
    placeCog(cog, pos);
    placedCogs.add(cog);
  }

  // Remaining unplaced cogs go back into spare positions
  const unplaced = allCogs.filter(c => !placedCogs.has(c));
  let spareKey = SPARE_START;
  for (const cog of unplaced) {
    while (inv.cogs[spareKey]) spareKey++;
    placeCog(cog, spareKey);
    spareKey++;
  }

  return inv;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { greedyInit };
}
```

Note: This is a first implementation. The player cog / flag position priority logic described in the spec (step 4 of the greedy algorithm) is simplified here — player cogs and flag cogs are treated as stat cogs and placed by raw score. This can be refined later once we have baseline tests passing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd cogtimizer && node --test tests/GreedyInit.test.js`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add GreedyInit.js tests/GreedyInit.test.js
git commit -m "feat: add greedy construction heuristic for initial board placement"
```

---

## Chunk 4: Web Worker and Integration

### Task 11: Web Worker

**Files:**
- Create: `SolverWorker.js`

The Web Worker receives a serialized inventory, runs greedy init + algorithm, and posts results. For now, we wire it up with the existing SA as the only algorithm. The three new algorithms will be added in Phase 2 plans.

- [ ] **Step 1: Implement SolverWorker**

```js
// SolverWorker.js
importScripts(
  'BoostPositions.js',
  'CogInventory.js',
  'IncrementalScorer.js',
  'SeededRng.js',
  'GreedyInit.js',
  'Serializer.js',
  'Solver.js',
  'StepOptimizer.js'
);

let cancelled = false;
let workerBest = null;

self.onmessage = function(e) {
  const { command } = e.data;

  if (command === 'cancel') {
    cancelled = true;
    return;
  }

  if (command === 'solve') {
    cancelled = false;
    const { inventory: serializedInv, algorithm, settings } = e.data;

    // Deserialize
    const inventory = deserialize(serializedInv);

    // Greedy init
    const weights = settings.weights || { buildRate: 1, expBonus: 1, flaggy: 1 };
    const targets = settings.targets || null;
    const greedyState = greedyInit(inventory, weights, targets);

    const playerCount = inventory.playerCount || 10;
    const flagCount = Math.max(inventory.flagPose.length, 1);

    // Post greedy result as first progress
    self.postMessage({
      type: 'progress',
      score: getScoreSum(greedyState.score, weights, targets, playerCount, flagCount),
      elapsed: 0,
      iterations: 0,
      phase: 'greedy'
    });

    // For now, run the existing SA solver synchronously (no yields needed in worker)
    // Phase 2 will add algorithm selection
    const solver = new Solver(weights);
    if (targets) solver.setTargets(targets);

    const timeLimit = settings.timeLimit || 10000;
    const startTime = Date.now();

    // Run solver (blocking in worker is fine)
    // Note: the current Solver.solve is async due to yields — for the worker,
    // we'll need to adapt it or write a synchronous variant.
    // For now, post the greedy result and mark done.
    // Full integration with algorithm selection happens when Phase 2 algorithms are ready.

    self.postMessage({
      type: 'done',
      inventory: serialize(greedyState),
      score: getScoreSum(greedyState.score, weights, targets, playerCount, flagCount),
      stats: { elapsed: Date.now() - startTime, iterations: 0 }
    });
  }
};
```

Note: Full solver integration (with incremental scoring and the new algorithm interface) will be completed when Phase 2 algorithms are implemented. This task establishes the worker scaffolding and message protocol.

- [ ] **Step 2: Commit**

```bash
git add SolverWorker.js
git commit -m "feat: add Web Worker scaffolding for off-main-thread solving"
```

---

### Task 12: Add script tags for new modules in index.html

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Add script tags for new modules**

In `index.html`, add script tags before `Solver.js`:

```html
<script type="text/javascript" src="BoostPositions.js"></script>
<script type="text/javascript" src="SeededRng.js"></script>
<script type="text/javascript" src="IncrementalScorer.js"></script>
<script type="text/javascript" src="GreedyInit.js"></script>
<script type="text/javascript" src="Serializer.js"></script>
```

The `require()` calls in these files are guarded by `typeof module !== 'undefined'`, so they'll work as both browser globals and Node.js modules.

- [ ] **Step 2: Verify the page loads without errors**

Open `index.html` in a browser. Check the console for any errors. All existing functionality should work unchanged.

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "chore: add script tags for new solver infrastructure modules"
```

---

### Task 13: Run all tests, final verification

- [ ] **Step 1: Run all test files**

```bash
cd cogtimizer && node --test tests/BoostPositions.test.js tests/SeededRng.test.js tests/IncrementalScorer.test.js tests/Serializer.test.js tests/GreedyInit.test.js tests/StepOptimizer.test.js
```

Expected: All tests PASS

- [ ] **Step 2: Commit any fixes if needed**

---

## Summary

**Note: Common Algorithm Interface** (spec section 1.4) is not implemented in this plan. The `SolverAlgorithm` base class and `solve(inventory, timeLimit, onProgress)` contract will be introduced with the first Phase 2 algorithm plan, since it needs a concrete algorithm to validate against.

After completing all 13 tasks, the infrastructure is in place:

| Component | File | Status |
|-----------|------|--------|
| Boost position extraction | `BoostPositions.js` | Ready |
| Incremental scorer | `IncrementalScorer.js` | Ready, stress-tested |
| Greedy construction | `GreedyInit.js` | Ready |
| Seeded PRNG | `SeededRng.js` | Ready |
| Serialization | `Serializer.js` | Ready |
| Web Worker scaffold | `SolverWorker.js` | Scaffolded, awaits Phase 2 |
| Extracted getScoreSum | `Solver.js` | Ready |
| Test helpers | `tests/helpers.js` | Ready |

Phase 2 (the three algorithms) can now be planned and implemented in parallel, each in its own plan document.
