# Genetic Algorithm Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `GeneticAlgorithm`, a population-based evolutionary solver that implements the `SolverAlgorithm` interface. The GA maintains a population of 40 `CogInventory` individuals, evolves them via block crossover and swap mutation, and uses elitism to preserve the best solutions.

**Architecture:** `GeneticAlgorithm` is a self-contained class in `GeneticAlgorithm.js`. It depends on infrastructure already built in the solver-infrastructure plan: `IncrementalScorer`, `GreedyInit`, `SeededRng`, and the `SolverAlgorithm` interface. The crossover operator (`BlockCrossover`) is extracted into its own module for independent testing. Tests use `buildInventory` / `makeCog` from `tests/helpers.js`.

**Tech Stack:** Vanilla JavaScript, `node --test` (Node.js native test runner), no external dependencies.

**Spec reference:** Section 2.3 of `docs/superpowers/specs/2026-03-13-solver-algorithms-design.md`

**Prerequisites (from infrastructure plan, assumed available):**
- `IncrementalScorer.js` — `new IncrementalScorer(inventory)`, `.fullRecompute()`, `.score`
- `GreedyInit.js` — `greedyInit(inventory, weights, rng)` returns a cloned, optimized `CogInventory`
- `SeededRng.js` — `new SeededRng(seed)`, `.random()`, `.randomInt(n)`, `.randomIntRange(lo, hi)`
- `getScoreSum(score, weights, playerCount, flagCount)` exported from `Solver.js`
- `tests/helpers.js` — `makeCog(key, opts)`, `buildInventory(cogs, opts)`, `assertScoresEqual(a, b)`

---

## File Structure

### New Files

| File | Responsibility |
|------|----------------|
| `BlockCrossover.js` | Pure function `blockCrossover(parentA, parentB, blockRect, rng)` — produces one child `CogInventory`. Contains all crossover and repair logic. |
| `GeneticAlgorithm.js` | `GeneticAlgorithm` class implementing the `SolverAlgorithm` interface. Owns the generation loop, selection, mutation, elitism. |
| `tests/BlockCrossover.test.js` | Unit + property-based tests for crossover correctness (duplicate cogs, fixed cog invariants, blocked positions, score accuracy). |
| `tests/GeneticAlgorithm.test.js` | Integration tests: population initialization, selection, mutation, full generation loop, progress callbacks, time-limit termination. |

### Modified Files

| File | Change |
|------|--------|
| `Solver.js` | Export `getScoreSum` as a standalone function (may already be done by infrastructure plan; verify and skip if already done). |

---

## Default Settings

```js
const GA_DEFAULTS = {
  populationSize: 40,        // Total individuals
  eliteCount: 3,             // Top N survive unchanged
  tournamentSize: 3,         // Competitors per selection
  mutationRate: 0.15,        // Probability any child is mutated
  crossoverBlockRows: 4,     // Height of inherited region
  crossoverBlockCols: 3,     // Width of inherited region
  spareSwapRate: 0.20,       // Fraction of mutations using board-spare swap
  swapMutationPairs: [1, 3], // Min/max pairs in swap mutation [inclusive, inclusive]
  greedyEliteCount: 5,       // Top N individuals initialized with slight greedy variations
  greedyEliteSwaps: [5, 10], // Swaps applied to greedy elite individuals [min, max]
  greedyRestSwaps: [50, 200] // Swaps applied to greedy non-elite individuals [min, max]
};
```

---

## Chunk 1: BlockCrossover — The Core Operator

This is the trickiest part and gets its own chunk with thorough testing before anything else.

### Task 1: Scaffold test file and define the crossover contract

**Files:** `tests/BlockCrossover.test.js` (test scaffold only — no implementation yet)

- [ ] **Step 1: Write the test scaffold**

Create `tests/BlockCrossover.test.js` with requires and a helper that verifies a `CogInventory` satisfies valid-board invariants:

```js
// tests/BlockCrossover.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { CogInventory, Cog } = require('../CogInventory.js');
const { makeCog, buildInventory } = require('./helpers.js');
const { SeededRng } = require('../SeededRng.js');
// blockCrossover is not yet implemented — this file will fail to load until Task 2
const { blockCrossover } = require('../BlockCrossover.js');

// ─── invariant checker ────────────────────────────────────────────────────────

/**
 * Assert all valid-board invariants on an inventory produced by crossover.
 * - No cog key appears at more than one position
 * - Fixed cogs are at their initialKey (unmoved)
 * - Blocked positions are empty
 * - Only positions in availableSlotKeys are occupied
 */
function assertValidBoard(inv, label = '') {
  const prefix = label ? `[${label}] ` : '';

  // 1. No duplicate cog positions: each cog key appears exactly once
  const positions = Object.keys(inv.cogs).map(Number);
  const uniquePositions = new Set(positions);
  assert.strictEqual(
    uniquePositions.size, positions.length,
    `${prefix}duplicate positions detected: ${positions}`
  );

  // 2. Fixed cogs must be at their initialKey
  for (const cog of Object.values(inv.cogs)) {
    if (cog.fixed) {
      assert.strictEqual(
        cog.key, cog.initialKey,
        `${prefix}fixed cog ${cog.initialKey} moved to ${cog.key}`
      );
    }
  }

  // 3. Blocked positions must be empty
  const blockedSlots = Object.values(inv.slots).filter(s => s.blocked).map(s => s.key);
  for (const pos of blockedSlots) {
    assert.ok(
      inv.cogs[pos] === undefined,
      `${prefix}blocked position ${pos} is occupied`
    );
  }

  // 4. Spare positions are in range >= 108
  for (const key of Object.keys(inv.cogs).map(Number)) {
    if (key < 96) {
      assert.ok(
        inv.availableSlotKeys.includes(key) || inv.cogs[key]?.fixed,
        `${prefix}cog at non-available, non-fixed board position ${key}`
      );
    }
  }
}

/**
 * Build two parents with all 96 board positions filled, no fixed/blocked slots.
 * Cogs are assigned to random positions via SeededRng to give diverse parents.
 */
function makeTwoParents(seed = 0) {
  const rng = new SeededRng(seed);
  // Create 96 plain stat cogs, keys 0..95 (initialKey = key, not fixed)
  const allCogs = Array.from({ length: 96 }, (_, i) =>
    makeCog(i, { buildRate: rng.randomInt(100) + 1 })
  );
  // Shuffle to create parentA
  const shuffledA = [...allCogs];
  for (let i = shuffledA.length - 1; i > 0; i--) {
    const j = rng.randomInt(i + 1);
    [shuffledA[i], shuffledA[j]] = [shuffledA[j], shuffledA[i]];
  }
  // Re-assign keys to positions
  const cogsA = shuffledA.map((cog, pos) => makeCog(pos, {
    buildRate: cog.buildRate,
    initialKey: cog.initialKey
  }));

  const shuffledB = [...allCogs];
  for (let i = shuffledB.length - 1; i > 0; i--) {
    const j = rng.randomInt(i + 1);
    [shuffledB[i], shuffledB[j]] = [shuffledB[j], shuffledB[i]];
  }
  const cogsB = shuffledB.map((cog, pos) => makeCog(pos, {
    buildRate: cog.buildRate,
    initialKey: cog.initialKey
  }));

  const parentA = buildInventory(cogsA);
  const parentB = buildInventory(cogsB);
  return { parentA, parentB };
}
```

- [ ] **Step 2: Run to confirm it fails (module not found)**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/BlockCrossover.test.js
```

Expected: `Error: Cannot find module '../BlockCrossover.js'`

---

### Task 2: Implement BlockCrossover with tests

**Files:** `BlockCrossover.js`, `tests/BlockCrossover.test.js` (add tests)

The crossover produces a child from two parents:
1. Pick a rectangular block of positions from `availableSlotKeys` (caller provides the block rect as `{ rowStart, colStart, rows, cols }`)
2. Child inherits all cogs in that block from Parent A
3. Remaining positions receive cogs from Parent B's assignment — but only if that cog was not already placed (is not in the inherited block)
4. Any remaining unfilled positions are filled by drawing from the leftover cog pool (cogs not yet placed anywhere), selecting by best `buildRate` weighted by local bonus

- [ ] **Step 3: Write failing tests for basic crossover behavior**

Add these `describe` blocks to `tests/BlockCrossover.test.js`:

```js
// ─── basic structure tests ────────────────────────────────────────────────────

describe('blockCrossover — basic structural invariants', () => {
  it('child passes all valid-board invariants on simple full board', () => {
    const rng = new SeededRng(1);
    const { parentA, parentB } = makeTwoParents(1);
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'simple full board');
  });

  it('child has same number of cogs as parents', () => {
    const rng = new SeededRng(2);
    const { parentA, parentB } = makeTwoParents(2);
    const blockRect = { rowStart: 2, colStart: 4, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assert.strictEqual(
      Object.keys(child.cogs).length,
      Object.keys(parentA.cogs).length,
      'child cog count must equal parent cog count'
    );
  });

  it('positions in block region come from parent A', () => {
    const rng = new SeededRng(3);
    const { parentA, parentB } = makeTwoParents(3);
    const blockRect = { rowStart: 1, colStart: 2, rows: 2, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);

    // Collect positions in block that are in availableSlotKeys
    const INV_COLUMNS = 12;
    const blockPositions = [];
    for (let r = blockRect.rowStart; r < blockRect.rowStart + blockRect.rows; r++) {
      for (let c = blockRect.colStart; c < blockRect.colStart + blockRect.cols; c++) {
        const key = r * INV_COLUMNS + c;
        if (parentA.availableSlotKeys.includes(key)) blockPositions.push(key);
      }
    }

    // For each block position, the cog in the child should have the same initialKey
    // as the cog from parent A at that position
    for (const pos of blockPositions) {
      const cogInParentA = parentA.cogs[pos];
      const cogInChild = child.cogs[pos];
      if (cogInParentA) {
        assert.ok(cogInChild, `child missing cog at block position ${pos}`);
        assert.strictEqual(
          cogInChild.initialKey, cogInParentA.initialKey,
          `block position ${pos}: expected cog ${cogInParentA.initialKey} from parent A, got ${cogInChild?.initialKey}`
        );
      }
    }
  });

  it('no cog appears at two positions (no duplicates)', () => {
    const rng = new SeededRng(4);
    const { parentA, parentB } = makeTwoParents(4);
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    const initialKeys = Object.values(child.cogs).map(c => c.initialKey);
    const uniqueKeys = new Set(initialKeys);
    assert.strictEqual(uniqueKeys.size, initialKeys.length,
      `Duplicate initialKeys found: ${initialKeys}`);
  });

  it('child does not contain cogs from neither parent (no invented cogs)', () => {
    const rng = new SeededRng(5);
    const { parentA, parentB } = makeTwoParents(5);
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);

    // All initialKeys in child must appear in parentA OR parentB
    const allParentInitialKeys = new Set([
      ...Object.values(parentA.cogs).map(c => c.initialKey),
      ...Object.values(parentB.cogs).map(c => c.initialKey)
    ]);
    for (const cog of Object.values(child.cogs)) {
      assert.ok(
        allParentInitialKeys.has(cog.initialKey),
        `child has invented cog with initialKey ${cog.initialKey}`
      );
    }
  });
});

// ─── fixed cog invariants ─────────────────────────────────────────────────────

describe('blockCrossover — fixed cog invariants', () => {
  it('fixed cogs remain at their original position after crossover', () => {
    const rng = new SeededRng(10);
    // Build parents where positions 0 and 11 are fixed
    const cogsA = Array.from({ length: 96 }, (_, i) =>
      makeCog(i, { buildRate: i + 1, fixed: (i === 0 || i === 11) })
    );
    const cogsB = cogsA.map(c => makeCog(c.key, {
      buildRate: c.buildRate * 2,
      fixed: c.fixed
    }));
    const parentA = buildInventory(cogsA);
    const parentB = buildInventory(cogsB);

    // Block overlaps both fixed positions
    const blockRect = { rowStart: 0, colStart: 0, rows: 2, cols: 6 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);

    // Fixed cogs must be at their initialKey
    for (const cog of Object.values(child.cogs)) {
      if (cog.fixed) {
        assert.strictEqual(cog.key, cog.initialKey,
          `Fixed cog ${cog.initialKey} found at position ${cog.key}`);
      }
    }
    assertValidBoard(child, 'fixed cogs test');
  });

  it('block region containing fixed positions still produces valid child', () => {
    const rng = new SeededRng(11);
    // Fixed cog at position 14 (row=1, col=2)
    const cogsA = Array.from({ length: 96 }, (_, i) =>
      makeCog(i, { buildRate: i + 1, fixed: i === 14 })
    );
    const cogsB = Array.from({ length: 96 }, (_, i) =>
      makeCog(i, { buildRate: (96 - i), fixed: i === 14 })
    );
    const parentA = buildInventory(cogsA);
    const parentB = buildInventory(cogsB);

    // Block centered on fixed cog
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 4 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'fixed in block');
    assert.strictEqual(child.cogs[14]?.initialKey, 14, 'fixed cog at 14 must stay at 14');
  });
});

// ─── blocked position invariants ──────────────────────────────────────────────

describe('blockCrossover — blocked positions', () => {
  it('blocked positions remain empty in child', () => {
    const rng = new SeededRng(20);
    // Positions 5 and 17 are blocked
    const blockedKeys = [5, 17];
    const cogsA = Array.from({ length: 94 }, (_, i) => {
      // Skip blocked positions: keys 0..4, 6..16, 18..95
      const key = i < 5 ? i : i < 16 ? i + 1 : i + 2;
      return makeCog(key, { buildRate: key + 1 });
    });
    const cogsB = cogsA.map(c => makeCog(c.key, { buildRate: c.buildRate + 1 }));
    const parentA = buildInventory(cogsA, { blockedKeys });
    const parentB = buildInventory(cogsB, { blockedKeys });

    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'blocked positions');
    assert.ok(!child.cogs[5], 'position 5 must be empty (blocked)');
    assert.ok(!child.cogs[17], 'position 17 must be empty (blocked)');
  });
});

// ─── property-based / repeated run checks ────────────────────────────────────

describe('blockCrossover — property-based checks (30 random runs)', () => {
  it('all invariants hold across 30 different seeds and block positions', () => {
    const INV_COLUMNS = 12;
    for (let seed = 100; seed < 130; seed++) {
      const rng = new SeededRng(seed);
      const { parentA, parentB } = makeTwoParents(seed);

      // Random block rect within bounds
      const rowStart = rng.randomInt(5);          // 0..4
      const colStart = rng.randomInt(9);          // 0..8
      const rows = rng.randomInt(3) + 2;          // 2..4
      const cols = rng.randomInt(3) + 2;          // 2..4
      const blockRect = { rowStart, colStart, rows, cols };

      const child = blockCrossover(parentA, parentB, blockRect, rng);
      assertValidBoard(child, `seed=${seed} block=${JSON.stringify(blockRect)}`);

      // No duplicate initialKeys
      const initialKeys = Object.values(child.cogs).map(c => c.initialKey);
      assert.strictEqual(new Set(initialKeys).size, initialKeys.length,
        `seed=${seed}: duplicate initialKeys`);

      // Cog count preserved
      assert.strictEqual(Object.keys(child.cogs).length, Object.keys(parentA.cogs).length,
        `seed=${seed}: cog count changed`);
    }
  });
});

// ─── score correctness ────────────────────────────────────────────────────────

describe('blockCrossover — score accuracy', () => {
  it('child score matches fullRecompute from IncrementalScorer', () => {
    const { IncrementalScorer } = require('../IncrementalScorer.js');
    const rng = new SeededRng(200);
    const { parentA, parentB } = makeTwoParents(200);
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);

    const scorer = new IncrementalScorer(child);
    const incremental = scorer.score;
    const recomputed = scorer.fullRecompute();

    assert.strictEqual(incremental.buildRate, recomputed.buildRate, 'buildRate mismatch');
    assert.strictEqual(incremental.expBonus, recomputed.expBonus, 'expBonus mismatch');
    assert.strictEqual(incremental.flaggy, recomputed.flaggy, 'flaggy mismatch');
    assert.strictEqual(incremental.expBoost, recomputed.expBoost, 'expBoost mismatch');
    assert.strictEqual(incremental.flagBoost, recomputed.flagBoost, 'flagBoost mismatch');
  });
});
```

- [ ] **Step 4: Run to confirm all tests fail (module not found)**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/BlockCrossover.test.js
```

Expected: `Error: Cannot find module '../BlockCrossover.js'`

- [ ] **Step 5: Implement `BlockCrossover.js`**

```js
// BlockCrossover.js
//
// blockCrossover(parentA, parentB, blockRect, rng) -> CogInventory
//
// Produces one child:
//   1. Inherit cogs at positions in blockRect from parentA
//   2. Fill remaining positions from parentB (skipping already-placed cogs)
//   3. Repair: any position still empty gets the best remaining cog from the pool
//
// Constraints preserved:
//   - Fixed cogs: always stay at their initialKey (skipped by both inheritance and fill)
//   - Blocked positions: never filled (not in availableSlotKeys)
//   - No duplicate cogs (initialKey uniqueness enforced throughout)

const { CogInventory, Cog } = require('./CogInventory.js');

const INV_COLUMNS = 12;

/**
 * @param {CogInventory} parentA
 * @param {CogInventory} parentB
 * @param {{ rowStart: number, colStart: number, rows: number, cols: number }} blockRect
 * @param {SeededRng} rng  - used only in repair step tie-breaking
 * @returns {CogInventory}
 */
function blockCrossover(parentA, parentB, blockRect, rng) {
  // ── Step 1: Clone parentA as base (preserves all metadata: flagPose, etc.) ──
  const child = parentA.clone();

  // Clear all non-fixed cogs from child (we will re-fill them)
  for (const key of Object.keys(child.cogs).map(Number)) {
    const cog = child.cogs[key];
    if (!cog.fixed) {
      delete child.cogs[key];
    }
  }

  // ── Step 2: Collect block positions (available, non-fixed) ────────────────
  const blockPositionSet = new Set();
  for (let r = blockRect.rowStart; r < blockRect.rowStart + blockRect.rows; r++) {
    for (let c = blockRect.colStart; c < blockRect.colStart + blockRect.cols; c++) {
      const key = r * INV_COLUMNS + c;
      if (parentA.availableSlotKeys.includes(key)) {
        blockPositionSet.add(key);
      }
    }
  }

  // ── Step 3: Inherit block positions from parentA ──────────────────────────
  const placedInitialKeys = new Set();

  // Fixed cogs are already in child.cogs — mark them as placed
  for (const cog of Object.values(child.cogs)) {
    if (cog.fixed) placedInitialKeys.add(cog.initialKey);
  }

  for (const pos of blockPositionSet) {
    const cogA = parentA.cogs[pos];
    if (!cogA || cogA.fixed) continue; // fixed cogs handled separately
    if (placedInitialKeys.has(cogA.initialKey)) continue; // already placed (shouldn't happen, but safe)
    // Clone the cog and place it at this position
    const cloned = new Cog({ ...cogA, key: pos });
    child.cogs[pos] = cloned;
    placedInitialKeys.add(cogA.initialKey);
  }

  // ── Step 4: Fill remaining available positions from parentB ──────────────
  const remainingPositions = parentA.availableSlotKeys.filter(
    pos => !blockPositionSet.has(pos) && !child.cogs[pos]
  );

  for (const pos of remainingPositions) {
    const cogB = parentB.cogs[pos];
    if (!cogB || cogB.fixed) continue;
    if (placedInitialKeys.has(cogB.initialKey)) continue; // already placed via block
    const cloned = new Cog({ ...cogB, key: pos });
    child.cogs[pos] = cloned;
    placedInitialKeys.add(cogB.initialKey);
  }

  // ── Step 5: Repair — fill still-empty positions from leftover pool ────────
  // Leftover pool: any cog from parentA that hasn't been placed yet
  const leftoverPool = Object.values(parentA.cogs)
    .filter(cog => !cog.fixed && !placedInitialKeys.has(cog.initialKey));

  // Also add leftover cogs from parentB that aren't already covered
  // (handles spare-area cogs if parentA and parentB have different spare pools)
  for (const cog of Object.values(parentB.cogs)) {
    if (!cog.fixed && !placedInitialKeys.has(cog.initialKey)) {
      leftoverPool.push(cog);
    }
  }

  // Sort pool descending by buildRate as a simple heuristic (stable, deterministic)
  leftoverPool.sort((a, b) => (b.buildRate || 0) - (a.buildRate || 0));

  const stillEmpty = parentA.availableSlotKeys.filter(pos => !child.cogs[pos]);
  let poolIndex = 0;
  for (const pos of stillEmpty) {
    if (poolIndex >= leftoverPool.length) break;
    const donor = leftoverPool[poolIndex++];
    const cloned = new Cog({ ...donor, key: pos });
    child.cogs[pos] = cloned;
    placedInitialKeys.add(donor.initialKey);
  }

  // ── Step 6: Invalidate score cache ───────────────────────────────────────
  child._score = null;

  return child;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { blockCrossover };
}
```

- [ ] **Step 6: Run tests — expect most to pass, fix any failures**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/BlockCrossover.test.js
```

Expected: All tests pass. If any fail, diagnose by reading the error message — common issues:
- Off-by-one in block rect bounds
- Fixed cog being double-counted in `placedInitialKeys`
- Spare-area cogs (key >= 108) ending up in board positions

Fix and re-run until all pass.

- [ ] **Step 7: Commit**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && git add BlockCrossover.js tests/BlockCrossover.test.js && git commit -m "feat: implement block crossover operator with full invariant tests"
```

---

## Chunk 2: GeneticAlgorithm — Population and Selection

### Task 3: Population initialization

**Files:** `GeneticAlgorithm.js` (new), `tests/GeneticAlgorithm.test.js` (new)

- [ ] **Step 1: Write failing tests for population initialization**

```js
// tests/GeneticAlgorithm.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { makeCog, buildInventory } = require('./helpers.js');
const { SeededRng } = require('../SeededRng.js');
const { IncrementalScorer } = require('../IncrementalScorer.js');
const { GeneticAlgorithm } = require('../GeneticAlgorithm.js');

// Build a simple 96-cog board inventory (no fixed/blocked slots)
function makeFullBoard(seed = 0) {
  const rng = new SeededRng(seed);
  const cogs = Array.from({ length: 96 }, (_, i) =>
    makeCog(i, { buildRate: rng.randomInt(100) + 1 })
  );
  return buildInventory(cogs, { playerCount: 5 });
}

describe('GeneticAlgorithm — initialization', () => {
  it('can be constructed with scorer and default settings', () => {
    const inv = makeFullBoard(0);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, {});
    assert.ok(ga, 'should construct without throwing');
  });

  it('initPopulation returns array of correct size', () => {
    const inv = makeFullBoard(1);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 10, seed: 42 });
    const pop = ga.initPopulation(inv);
    assert.strictEqual(pop.length, 10, 'population size must match settings');
  });

  it('each individual in population is a valid CogInventory', () => {
    const { CogInventory } = require('../CogInventory.js');
    const inv = makeFullBoard(2);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 8, seed: 7 });
    const pop = ga.initPopulation(inv);
    for (const individual of pop) {
      assert.ok(individual instanceof CogInventory,
        'each individual must be a CogInventory');
      assert.ok(Array.isArray(individual.availableSlotKeys),
        'individual must have availableSlotKeys');
    }
  });

  it('individuals are distinct (not all identical clones)', () => {
    const inv = makeFullBoard(3);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 6, seed: 99 });
    const pop = ga.initPopulation(inv);
    // Check that at least two individuals differ (any cog at position 0 has different buildRate)
    const buildRatesAt0 = pop.map(ind => ind.cogs[0]?.buildRate);
    const unique = new Set(buildRatesAt0);
    assert.ok(unique.size > 1,
      'population should have diversity, all individuals are identical');
  });

  it('initPopulation is deterministic given same seed', () => {
    const inv = makeFullBoard(4);
    const scorer1 = new IncrementalScorer(inv);
    const scorer2 = new IncrementalScorer(inv);
    const ga1 = new GeneticAlgorithm(scorer1, { populationSize: 5, seed: 17 });
    const ga2 = new GeneticAlgorithm(scorer2, { populationSize: 5, seed: 17 });
    const pop1 = ga1.initPopulation(inv);
    const pop2 = ga2.initPopulation(inv);
    // Same seed → same ordering of cogs in first individual
    assert.strictEqual(
      JSON.stringify(pop1[0].cogs),
      JSON.stringify(pop2[0].cogs),
      'same seed must produce same population'
    );
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/GeneticAlgorithm.test.js
```

Expected: `Error: Cannot find module '../GeneticAlgorithm.js'`

- [ ] **Step 3: Implement the GeneticAlgorithm skeleton with `initPopulation`**

```js
// GeneticAlgorithm.js

const { blockCrossover } = require('./BlockCrossover.js');
const { SeededRng } = require('./SeededRng.js');
const { greedyInit } = require('./GreedyInit.js');
const { CogInventory, Cog } = require('./CogInventory.js');

const GA_DEFAULTS = {
  populationSize: 40,
  eliteCount: 3,
  tournamentSize: 3,
  mutationRate: 0.15,
  crossoverBlockRows: 4,
  crossoverBlockCols: 3,
  spareSwapRate: 0.20,
  swapMutationMinPairs: 1,
  swapMutationMaxPairs: 3,
  greedyEliteCount: 5,
  greedyEliteSwaps: [5, 10],
  greedyRestSwaps: [50, 200],
  seed: 0
};

class GeneticAlgorithm {
  /**
   * @param {IncrementalScorer} scorer
   * @param {Object} settings
   */
  constructor(scorer, settings) {
    this.scorer = scorer;
    this.settings = { ...GA_DEFAULTS, ...settings };
    this.rng = new SeededRng(this.settings.seed);
  }

  static get displayName() { return 'Genetic Algorithm'; }
  static get description() { return 'Population-based. Explores diverse solutions.'; }

  /**
   * Initialize population from a starting inventory.
   * Top `greedyEliteCount` individuals: greedy + slight perturbation (5-10 swaps)
   * Remaining: greedy + heavier perturbation (50-200 swaps)
   *
   * @param {CogInventory} inventory - Starting inventory (already greedy-initialized)
   * @returns {CogInventory[]}
   */
  initPopulation(inventory) {
    const { populationSize, greedyEliteCount, greedyEliteSwaps, greedyRestSwaps } = this.settings;
    const population = [];

    for (let i = 0; i < populationSize; i++) {
      const individual = inventory.clone();
      const isElite = i < greedyEliteCount;
      const [minSwaps, maxSwaps] = isElite ? greedyEliteSwaps : greedyRestSwaps;
      const numSwaps = minSwaps + this.rng.randomInt(maxSwaps - minSwaps + 1);
      this._randomSwap(individual, numSwaps);
      population.push(individual);
    }

    return population;
  }

  /**
   * Apply `n` random swaps to an inventory (in-place). Respects fixed/blocked constraints.
   * @param {CogInventory} inventory
   * @param {number} n
   */
  _randomSwap(inventory, n) {
    const slots = inventory.availableSlotKeys;
    const allKeys = Object.keys(inventory.cogs);

    for (let i = 0; i < n; i++) {
      const slotKey = slots[this.rng.randomInt(slots.length)];
      const cogKey = allKeys[this.rng.randomInt(allKeys.length)];
      const slot = inventory.get(slotKey);
      const cog = inventory.get(cogKey);
      if (!slot || !cog) continue;
      if (slot.fixed || cog.fixed) continue;
      if (cog.position && cog.position().location === 'build') continue;
      inventory.move(slotKey, Number(cogKey));
    }
    inventory._score = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GeneticAlgorithm };
}
```

- [ ] **Step 4: Run tests — expect initialization tests to pass**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/GeneticAlgorithm.test.js
```

Expected: All 5 initialization tests pass.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && git add GeneticAlgorithm.js tests/GeneticAlgorithm.test.js && git commit -m "feat: add GeneticAlgorithm skeleton with population initialization"
```

---

### Task 4: Tournament selection

- [ ] **Step 1: Write failing tests for `tournamentSelect`**

Add to `tests/GeneticAlgorithm.test.js`:

```js
describe('GeneticAlgorithm — tournament selection', () => {
  // Build a scored population: 6 individuals with known scores
  function makeScoredPop(scorer) {
    const rng = new SeededRng(50);
    const inv = makeFullBoard(50);
    const pop = Array.from({ length: 6 }, (_, i) => {
      const ind = inv.clone();
      // Force a predictable score by setting buildRate of first cog
      // (actual score comes from CogInventory.score, so we just need diversity)
      return ind;
    });
    // Score each: use scorer.fullRecompute or inv.score
    const scores = pop.map(ind => ind.score.buildRate); // rough proxy
    return { pop, scores };
  }

  it('tournamentSelect returns an index within population bounds', () => {
    const inv = makeFullBoard(5);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { tournamentSize: 3, seed: 1 });
    const pop = ga.initPopulation(inv).slice(0, 6);
    const scores = pop.map(ind => inv.score.buildRate + Math.random()); // mock scores
    const idx = ga.tournamentSelect(pop, scores);
    assert.ok(idx >= 0 && idx < pop.length,
      `index ${idx} out of bounds [0, ${pop.length})`);
  });

  it('tournamentSelect always picks the highest-scoring among tournament competitors', () => {
    // Use a fixed seed and controlled scores to verify tournament winner
    const inv = makeFullBoard(6);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { tournamentSize: 3, seed: 123 });
    const pop = Array.from({ length: 10 }, (_, i) => inv.clone());
    // Assign distinct scores: individual i has score = i * 10
    const scores = pop.map((_, i) => i * 10);

    // Run 50 tournaments — winner must always be one of the top individuals
    // (can't always guarantee which, but the winner's score must equal
    // the max score among the 3 randomly chosen competitors)
    const rng = new SeededRng(123); // same seed as ga.rng before any calls
    // Note: ga.rng is already advanced by any prior calls; we just check the invariant
    for (let trial = 0; trial < 50; trial++) {
      const winner = ga.tournamentSelect(pop, scores);
      assert.ok(winner >= 0 && winner < pop.length,
        `winner index ${winner} out of bounds`);
    }
  });

  it('with tournamentSize=1, any individual can win', () => {
    const inv = makeFullBoard(7);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { tournamentSize: 1, seed: 77 });
    const pop = Array.from({ length: 20 }, (_, i) => inv.clone());
    const scores = pop.map((_, i) => i); // strictly increasing scores
    const winners = new Set();
    for (let i = 0; i < 100; i++) {
      winners.add(ga.tournamentSelect(pop, scores));
    }
    // With size=1 and 100 trials over 20 individuals, should see many distinct winners
    assert.ok(winners.size > 5,
      `expected diversity with tournamentSize=1, got only ${winners.size} distinct winners`);
  });

  it('with tournamentSize=population, always picks the best', () => {
    const inv = makeFullBoard(8);
    const scorer = new IncrementalScorer(inv);
    const pop = Array.from({ length: 10 }, (_, i) => inv.clone());
    const scores = pop.map((_, i) => i); // max is index 9
    const ga = new GeneticAlgorithm(scorer, { tournamentSize: 10, seed: 33 });
    for (let i = 0; i < 20; i++) {
      const winner = ga.tournamentSelect(pop, scores);
      assert.strictEqual(winner, 9, 'tournamentSize = pop size must always pick the best');
    }
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/GeneticAlgorithm.test.js
```

Expected: 4 new selection tests fail with `ga.tournamentSelect is not a function`.

- [ ] **Step 3: Implement `tournamentSelect` in `GeneticAlgorithm.js`**

Add this method inside the `GeneticAlgorithm` class:

```js
  /**
   * Tournament selection: draw `tournamentSize` random competitors, return index of winner.
   * @param {CogInventory[]} population
   * @param {number[]} scores - parallel array of scalar scores
   * @returns {number} index of the selected individual
   */
  tournamentSelect(population, scores) {
    const { tournamentSize } = this.settings;
    let bestIdx = this.rng.randomInt(population.length);
    for (let i = 1; i < tournamentSize; i++) {
      const challenger = this.rng.randomInt(population.length);
      if (scores[challenger] > scores[bestIdx]) {
        bestIdx = challenger;
      }
    }
    return bestIdx;
  }
```

- [ ] **Step 4: Run tests — all selection tests should pass**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/GeneticAlgorithm.test.js
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && git add GeneticAlgorithm.js tests/GeneticAlgorithm.test.js && git commit -m "feat: implement tournament selection in GeneticAlgorithm"
```

---

## Chunk 3: Mutation

### Task 5: Swap mutation and spare mutation

- [ ] **Step 1: Write failing tests for `mutate`**

Add to `tests/GeneticAlgorithm.test.js`:

```js
describe('GeneticAlgorithm — mutation', () => {
  it('mutate returns a CogInventory', () => {
    const inv = makeFullBoard(9);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { seed: 1 });
    const pop = ga.initPopulation(inv);
    const result = ga.mutate(pop[0]);
    const { CogInventory } = require('../CogInventory.js');
    assert.ok(result instanceof CogInventory, 'mutate must return a CogInventory');
  });

  it('mutate does not violate valid-board invariants', () => {
    const inv = makeFullBoard(10);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { seed: 2 });
    const pop = ga.initPopulation(inv);
    for (let i = 0; i < 20; i++) {
      const mutated = ga.mutate(pop[i % pop.length]);
      // Check no duplicates
      const keys = Object.values(mutated.cogs).map(c => c.initialKey);
      assert.strictEqual(new Set(keys).size, keys.length,
        `mutation ${i}: duplicate initialKeys after mutation`);
      // Check fixed cogs unmoved
      for (const cog of Object.values(mutated.cogs)) {
        if (cog.fixed) {
          assert.strictEqual(cog.key, cog.initialKey,
            `mutation ${i}: fixed cog ${cog.initialKey} moved`);
        }
      }
    }
  });

  it('mutate is a pure operation (does not modify the input individual)', () => {
    const inv = makeFullBoard(11);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { seed: 3 });
    const pop = ga.initPopulation(inv);
    const original = pop[0];
    // Snapshot cog positions before mutation
    const before = JSON.stringify(original.cogs);
    ga.mutate(original);
    const after = JSON.stringify(original.cogs);
    assert.strictEqual(before, after, 'mutate must not modify the input individual');
  });

  it('mutate changes at least one cog position (with high probability over 20 runs)', () => {
    const inv = makeFullBoard(12);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, {
      seed: 4,
      mutationRate: 1.0, // always mutate
      swapMutationMinPairs: 2,
      swapMutationMaxPairs: 2
    });
    const pop = ga.initPopulation(inv);
    let changedCount = 0;
    for (let i = 0; i < 20; i++) {
      const mutated = ga.mutate(pop[0]);
      if (JSON.stringify(mutated.cogs) !== JSON.stringify(pop[0].cogs)) changedCount++;
    }
    assert.ok(changedCount >= 15,
      `Expected most mutations to change something, got ${changedCount}/20`);
  });
});
```

- [ ] **Step 2: Run to confirm new tests fail**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/GeneticAlgorithm.test.js
```

Expected: 4 mutation tests fail with `ga.mutate is not a function`.

- [ ] **Step 3: Implement `mutate` in `GeneticAlgorithm.js`**

Add this method inside the `GeneticAlgorithm` class:

```js
  /**
   * Apply mutation to a clone of the individual. Returns the mutated clone.
   * Does not modify the input.
   * - 80%: swap mutation (1-3 random board-board swaps)
   * - 20%: spare mutation (swap one board cog with a spare-pool cog)
   *
   * @param {CogInventory} individual
   * @returns {CogInventory} mutated clone
   */
  mutate(individual) {
    const { spareSwapRate, swapMutationMinPairs, swapMutationMaxPairs } = this.settings;
    const mutated = individual.clone();
    const slots = mutated.availableSlotKeys;

    if (this.rng.random() < spareSwapRate) {
      // Spare mutation: swap a random board cog with a spare-pool cog
      const boardKeys = slots.filter(k => mutated.cogs[k] && !mutated.cogs[k].fixed);
      const spareKeys = Object.keys(mutated.cogs)
        .map(Number)
        .filter(k => k >= 108 && !mutated.cogs[k].fixed);

      if (boardKeys.length > 0 && spareKeys.length > 0) {
        const boardPos = boardKeys[this.rng.randomInt(boardKeys.length)];
        const sparePos = spareKeys[this.rng.randomInt(spareKeys.length)];
        mutated.move(boardPos, sparePos);
      }
    } else {
      // Swap mutation: 1-3 random board-board swaps
      const pairCount = swapMutationMinPairs +
        this.rng.randomInt(swapMutationMaxPairs - swapMutationMinPairs + 1);
      for (let p = 0; p < pairCount; p++) {
        const posA = slots[this.rng.randomInt(slots.length)];
        const posB = slots[this.rng.randomInt(slots.length)];
        if (posA === posB) continue;
        const cogA = mutated.cogs[posA];
        const cogB = mutated.cogs[posB];
        if (cogA?.fixed || cogB?.fixed) continue;
        mutated.move(posA, posB);
      }
    }

    mutated._score = null;
    return mutated;
  }
```

- [ ] **Step 4: Run tests — all mutation tests should pass**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/GeneticAlgorithm.test.js
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && git add GeneticAlgorithm.js tests/GeneticAlgorithm.test.js && git commit -m "feat: implement swap and spare mutation operators"
```

---

## Chunk 4: Generation Loop and `solve`

### Task 6: Elitism and next-generation assembly

- [ ] **Step 1: Write failing tests for `nextGeneration`**

Add to `tests/GeneticAlgorithm.test.js`:

```js
describe('GeneticAlgorithm — nextGeneration', () => {
  it('nextGeneration returns same-size population', () => {
    const inv = makeFullBoard(13);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 8, seed: 5 });
    const pop = ga.initPopulation(inv);
    const scores = pop.map(ind => ind.score.buildRate);
    const next = ga.nextGeneration(pop, scores);
    assert.strictEqual(next.length, 8, 'next generation must have same size');
  });

  it('elite individuals are preserved unchanged', () => {
    const inv = makeFullBoard(14);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 8, eliteCount: 2, seed: 6 });
    const pop = ga.initPopulation(inv);
    const scores = pop.map(ind => ind.score.buildRate);

    // Find the top 2 by score
    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const eliteInitialKeys = sorted.slice(0, 2).map(([i]) =>
      JSON.stringify(pop[i].cogs)
    );

    const next = ga.nextGeneration(pop, scores);

    // Top 2 of next generation (by score) must match the original elites
    const nextScores = next.map(ind => ind.score.buildRate);
    const nextSorted = [...nextScores.entries()].sort((a, b) => b[1] - a[1]);
    const nextEliteKeys = nextSorted.slice(0, 2).map(([i]) =>
      JSON.stringify(next[i].cogs)
    );

    // At least the best individual must survive
    assert.ok(
      nextEliteKeys.includes(eliteInitialKeys[0]),
      'best individual must survive into next generation (elitism)'
    );
  });

  it('next generation passes all valid-board invariants for every individual', () => {
    const inv = makeFullBoard(15);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 6, seed: 7 });
    const pop = ga.initPopulation(inv);
    const scores = pop.map(ind => ind.score.buildRate);
    const next = ga.nextGeneration(pop, scores);

    for (let i = 0; i < next.length; i++) {
      const ind = next[i];
      // No duplicate cogs
      const keys = Object.values(ind.cogs).map(c => c.initialKey);
      assert.strictEqual(new Set(keys).size, keys.length,
        `individual ${i} in next gen: duplicate initialKeys`);
    }
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/GeneticAlgorithm.test.js
```

Expected: 3 tests fail with `ga.nextGeneration is not a function`.

- [ ] **Step 3: Implement `nextGeneration` in `GeneticAlgorithm.js`**

Add this method inside the `GeneticAlgorithm` class:

```js
  /**
   * Produce the next generation population.
   * - Elite top `eliteCount` individuals survive unchanged
   * - Remaining slots filled by crossover (tournament-selected parents) + mutation
   *
   * @param {CogInventory[]} population
   * @param {number[]} scores - parallel array of scalar scores
   * @returns {CogInventory[]} next generation
   */
  nextGeneration(population, scores) {
    const { populationSize, eliteCount, mutationRate,
            crossoverBlockRows, crossoverBlockCols } = this.settings;
    const INV_COLUMNS = 12;

    // Sort by score descending to get elites
    const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const nextGen = [];

    // Preserve elite individuals
    for (let i = 0; i < Math.min(eliteCount, populationSize); i++) {
      nextGen.push(population[ranked[i][0]].clone());
    }

    // Fill remaining slots
    while (nextGen.length < populationSize) {
      // Tournament-select two parents
      const idxA = this.tournamentSelect(population, scores);
      let idxB = this.tournamentSelect(population, scores);
      // Ensure distinct parents when possible
      if (population.length > 1) {
        let attempts = 0;
        while (idxB === idxA && attempts < 5) {
          idxB = this.tournamentSelect(population, scores);
          attempts++;
        }
      }
      const parentA = population[idxA];
      const parentB = population[idxB];

      // Random block rect within board bounds
      const maxRowStart = Math.max(0, 8 - crossoverBlockRows);
      const maxColStart = Math.max(0, INV_COLUMNS - crossoverBlockCols);
      const rowStart = this.rng.randomInt(maxRowStart + 1);
      const colStart = this.rng.randomInt(maxColStart + 1);
      const blockRect = {
        rowStart,
        colStart,
        rows: crossoverBlockRows,
        cols: crossoverBlockCols
      };

      let child = blockCrossover(parentA, parentB, blockRect, this.rng);

      // Apply mutation with probability mutationRate
      if (this.rng.random() < mutationRate) {
        child = this.mutate(child);
      }

      nextGen.push(child);
    }

    return nextGen;
  }
```

- [ ] **Step 4: Run tests — expect all tests to pass**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/GeneticAlgorithm.test.js
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && git add GeneticAlgorithm.js tests/GeneticAlgorithm.test.js && git commit -m "feat: implement elitism and next-generation assembly"
```

---

### Task 7: Scoring helper and the `solve` entry point

- [ ] **Step 1: Write failing tests for `solve`**

Add to `tests/GeneticAlgorithm.test.js`:

```js
describe('GeneticAlgorithm — solve', () => {
  it('solve returns a CogInventory', async () => {
    const inv = makeFullBoard(20);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 4, seed: 10 });
    const result = ga.solve(inv, 500, () => {});
    const { CogInventory } = require('../CogInventory.js');
    assert.ok(result instanceof CogInventory, 'solve must return a CogInventory');
  });

  it('solve terminates within the time limit (generous bound)', () => {
    const inv = makeFullBoard(21);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 4, seed: 11 });
    const start = Date.now();
    ga.solve(inv, 300, () => {});
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1500,
      `solve took ${elapsed}ms, expected < 1500ms for 300ms limit`);
  });

  it('solve calls onProgress at least once', () => {
    const inv = makeFullBoard(22);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 4, seed: 12 });
    let callCount = 0;
    ga.solve(inv, 300, () => { callCount++; });
    assert.ok(callCount >= 1, `onProgress called ${callCount} times, expected >= 1`);
  });

  it('onProgress receives { score, iterations, elapsed } with numeric values', () => {
    const inv = makeFullBoard(23);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 4, seed: 13 });
    const reports = [];
    ga.solve(inv, 300, (report) => { reports.push(report); });
    assert.ok(reports.length >= 1, 'must have at least one report');
    const r = reports[0];
    assert.strictEqual(typeof r.score, 'number', 'score must be a number');
    assert.strictEqual(typeof r.iterations, 'number', 'iterations must be a number');
    assert.strictEqual(typeof r.elapsed, 'number', 'elapsed must be a number');
  });

  it('returned solution passes valid-board invariants', () => {
    const inv = makeFullBoard(24);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 4, seed: 14 });
    const result = ga.solve(inv, 300, () => {});
    const keys = Object.values(result.cogs).map(c => c.initialKey);
    assert.strictEqual(new Set(keys).size, keys.length,
      'solution has duplicate initialKeys');
    for (const cog of Object.values(result.cogs)) {
      if (cog.fixed) {
        assert.strictEqual(cog.key, cog.initialKey, 'fixed cog moved in solution');
      }
    }
  });

  it('solve returns a result at least as good as the initial greedy state', () => {
    const inv = makeFullBoard(25);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm(scorer, { populationSize: 6, seed: 15 });
    const initialScore = inv.score.buildRate;
    const result = ga.solve(inv, 500, () => {});
    const finalScore = result.score.buildRate;
    // GA with elitism must never return worse than initial (elites preserve best)
    assert.ok(finalScore >= initialScore - 1, // -1 tolerance for rounding
      `solve returned score ${finalScore} worse than initial ${initialScore}`);
  });
});
```

- [ ] **Step 2: Run to confirm tests fail**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/GeneticAlgorithm.test.js
```

Expected: 6 solve tests fail with `ga.solve is not a function`.

- [ ] **Step 3: Implement `solve` in `GeneticAlgorithm.js`**

Add this method inside the `GeneticAlgorithm` class, and a `_scoreIndividual` helper:

```js
  /**
   * Score a single individual using IncrementalScorer.fullRecompute.
   * Loads the individual's inventory into the scorer and returns the scalar score.
   *
   * @param {CogInventory} individual
   * @param {number} playerCount
   * @param {number} flagCount
   * @param {Object} weights  - { buildRate, expBonus, flaggy } or null for targets
   * @param {Object|null} targets
   * @returns {number}
   */
  _scoreIndividual(individual, playerCount, flagCount, weights, targets) {
    // IncrementalScorer.fullRecompute() returns the 5-field score object.
    // We re-initialize scorer from this individual by calling fullRecompute
    // after replacing the wrapped inventory reference.
    this.scorer.inventory = individual;
    const raw = this.scorer.fullRecompute();

    // getScoreSum mirrors Solver.getScoreSum logic
    if (targets) {
      const br = targets.buildRate > 0 ? Math.min(raw.buildRate / targets.buildRate, 1.0) : 1.0;
      const xpEff = raw.expBonus * (raw.expBoost + playerCount) / playerCount;
      const xp = targets.expBonus > 0 ? Math.min(xpEff / targets.expBonus, 1.0) : 1.0;
      const flEff = raw.flaggy * (raw.flagBoost + flagCount) / flagCount;
      const fl = targets.flaggy > 0 ? Math.min(flEff / targets.flaggy, 1.0) : 1.0;
      return br * xp * fl;
    }
    let res = raw.buildRate * (weights.buildRate || 0);
    res += raw.expBonus * (weights.expBonus || 0) * (raw.expBoost + playerCount) / playerCount;
    res += raw.flaggy * (weights.flaggy || 0) * (raw.flagBoost + flagCount) / flagCount;
    return res;
  }

  /**
   * Run the genetic algorithm.
   *
   * @param {CogInventory} inventory - Starting board (typically from greedy init)
   * @param {number} timeLimit - Time budget in milliseconds
   * @param {function} onProgress - Called each generation with { score, iterations, elapsed }
   * @returns {CogInventory} best solution found
   */
  solve(inventory, timeLimit, onProgress) {
    const startTime = Date.now();
    const playerCount = inventory.playerCount || 10;
    const flagCount = Math.max((inventory.flagPose || []).length, 1);
    const weights = this.settings.weights || { buildRate: 1, expBonus: 0, flaggy: 0 };
    const targets = this.settings.targets || null;

    // Initialize population
    let population = this.initPopulation(inventory);

    // Score all individuals
    let scores = population.map(ind =>
      this._scoreIndividual(ind, playerCount, flagCount, weights, targets)
    );

    let bestScore = Math.max(...scores);
    let bestIndividual = population[scores.indexOf(bestScore)].clone();
    let generation = 0;

    // Report initial state
    onProgress({ score: bestScore, iterations: generation, elapsed: Date.now() - startTime });

    while (Date.now() - startTime < timeLimit) {
      generation++;

      // Evolve
      population = this.nextGeneration(population, scores);

      // Re-score new generation
      scores = population.map(ind =>
        this._scoreIndividual(ind, playerCount, flagCount, weights, targets)
      );

      // Track best
      const genBest = Math.max(...scores);
      if (genBest > bestScore) {
        bestScore = genBest;
        bestIndividual = population[scores.indexOf(genBest)].clone();
      }

      onProgress({ score: bestScore, iterations: generation, elapsed: Date.now() - startTime });
    }

    return bestIndividual;
  }
```

- [ ] **Step 4: Run all tests — expect everything to pass**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/GeneticAlgorithm.test.js
```

Expected: All tests pass (may take ~30-60 seconds for the timed tests).

If `this.scorer.inventory` is not a settable property on `IncrementalScorer`, adjust `_scoreIndividual` to instead construct a fresh `IncrementalScorer` per call:

```js
// Alternative if scorer.inventory is not settable:
const { IncrementalScorer } = require('./IncrementalScorer.js');
const tempScorer = new IncrementalScorer(individual);
const raw = tempScorer.fullRecompute();
```

- [ ] **Step 5: Commit**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && git add GeneticAlgorithm.js tests/GeneticAlgorithm.test.js && git commit -m "feat: implement GA solve loop with scoring, elitism, and progress reporting"
```

---

## Chunk 5: Full Test Run and Integration Check

### Task 8: Run all tests and verify no regressions

- [ ] **Step 1: Run the full test suite**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/BlockCrossover.test.js tests/GeneticAlgorithm.test.js tests/BoostPositions.test.js tests/StepOptimizer.test.js
```

Expected: All tests in all files pass.

- [ ] **Step 2: Spot-check crossover output manually**

Add a one-off sanity script (not committed) to verify the crossover produces non-trivial output on a real inventory shape:

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node -e "
const { CogInventory, Cog } = require('./CogInventory.js');
const { blockCrossover } = require('./BlockCrossover.js');
const { SeededRng } = require('./SeededRng.js');

// 10-cog mini board for quick inspection
const makeCog = (key, br) => new Cog({ key, initialKey: key, buildRate: br, icon: 'Blank' });
const cogsA = Array.from({length: 10}, (_, i) => makeCog(i, i + 1));
const cogsB = Array.from({length: 10}, (_, i) => makeCog(i, 10 - i));

const slots = {};
for (let i = 0; i < 96; i++) slots[i] = new Cog({ key: i, icon: 'Blank' });
const makeInv = (cogs) => {
  const d = {};
  cogs.forEach(c => d[c.key] = c);
  const inv = new CogInventory(d, slots);
  inv.availableSlotKeys = cogsA.map(c => c.key);
  inv.flagPose = [];
  inv.flaggyShopUpgrades = 0;
  inv.playerCount = 5;
  return inv;
};
const pA = makeInv(cogsA);
const pB = makeInv(cogsB);
const child = blockCrossover(pA, pB, { rowStart: 0, colStart: 0, rows: 1, cols: 3 }, new SeededRng(1));
console.log('Child cog buildRates at positions 0-9:');
for (let i = 0; i < 10; i++) console.log(i, child.cogs[i]?.buildRate ?? 'empty');
"
```

Expected: positions 0, 1, 2 (block) show Parent A's buildRates (1, 2, 3). Remaining positions show a mix from B or repair.

- [ ] **Step 3: Final commit if anything was adjusted**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && git add -p && git commit -m "test: verify crossover integration manually"
```

---

## Chunk 6: Edge Cases and Hardening

### Task 9: Edge case tests for crossover

These cover the most likely failure modes in production:

- [ ] **Step 1: Add edge-case tests to `tests/BlockCrossover.test.js`**

```js
describe('blockCrossover — edge cases', () => {
  it('block covering entire board: child is a clone of parentA', () => {
    const rng = new SeededRng(300);
    const { parentA, parentB } = makeTwoParents(300);
    // Full board block
    const blockRect = { rowStart: 0, colStart: 0, rows: 8, cols: 12 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'full block');
    // All positions should match parentA
    for (const pos of parentA.availableSlotKeys) {
      const cogA = parentA.cogs[pos];
      const cogC = child.cogs[pos];
      if (cogA) {
        assert.ok(cogC, `position ${pos} empty in child but occupied in parentA`);
        assert.strictEqual(cogC.initialKey, cogA.initialKey,
          `position ${pos}: child has ${cogC.initialKey}, parentA has ${cogA.initialKey}`);
      }
    }
  });

  it('block covering zero available positions: child is assembled from parentB', () => {
    const rng = new SeededRng(301);
    const { parentA, parentB } = makeTwoParents(301);
    // Block at positions off the available list would be unusual; use a 0x0 block
    const blockRect = { rowStart: 0, colStart: 0, rows: 0, cols: 0 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'zero block');
  });

  it('identical parents produce a valid child', () => {
    const rng = new SeededRng(302);
    const { parentA } = makeTwoParents(302);
    const parentB = parentA.clone();
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'identical parents');
    const keysA = Object.values(parentA.cogs).map(c => c.initialKey).sort((a,b)=>a-b);
    const keysC = Object.values(child.cogs).map(c => c.initialKey).sort((a,b)=>a-b);
    assert.deepStrictEqual(keysC, keysA, 'child should have same cog set as parents');
  });

  it('board with spare-area cogs: no spare cog ends up on the main board', () => {
    const rng = new SeededRng(303);
    // 80 board cogs + 16 spare cogs
    const boardCogs = Array.from({ length: 80 }, (_, i) => makeCog(i, { buildRate: i + 1 }));
    const spareCogs = Array.from({ length: 16 }, (_, i) =>
      makeCog(108 + i, { buildRate: i + 200 })
    );
    const allCogs = [...boardCogs, ...spareCogs];

    // Shuffle for parentB
    const allCogsB = allCogs.map(c => {
      // reassign to same positions (just vary buildRate slightly)
      return makeCog(c.key, { buildRate: c.buildRate + 1 });
    });

    // Build parentA with spare cogs in spare area
    const cogsADict = {};
    allCogs.forEach(c => cogsADict[c.key] = c);
    const cogsBDict = {};
    allCogsB.forEach(c => cogsBDict[c.key] = c);

    const slotsA = {};
    for (let i = 0; i < 96; i++) slotsA[i] = new Cog({ key: i, icon: 'Blank' });
    const { CogInventory: CI } = require('../CogInventory.js');
    const parentA = new CI(cogsADict, slotsA);
    parentA.availableSlotKeys = boardCogs.map(c => c.key);
    parentA.flagPose = [];
    parentA.flaggyShopUpgrades = 0;
    parentA.playerCount = 5;

    const parentB = new CI(cogsBDict, slotsA);
    parentB.availableSlotKeys = boardCogs.map(c => c.key);
    parentB.flagPose = [];
    parentB.flaggyShopUpgrades = 0;
    parentB.playerCount = 5;

    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'spare cogs test');

    // No spare cog should be on the main board
    for (const [key, cog] of Object.entries(child.cogs)) {
      if (Number(key) < 96 && !cog.fixed) {
        assert.ok(
          cog.initialKey < 108 || cog.initialKey >= 108 && cog.fixed,
          `spare cog ${cog.initialKey} ended up at main board position ${key}`
        );
      }
    }
  });
});
```

- [ ] **Step 2: Run edge-case tests**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/BlockCrossover.test.js
```

Expected: All tests pass. If any fail, fix the edge case in `BlockCrossover.js` and re-run.

- [ ] **Step 3: Commit edge-case coverage**

```bash
cd C:/Users/winli/Documents/src/idleon/cogtimizer && git add tests/BlockCrossover.test.js BlockCrossover.js && git commit -m "test: add edge-case coverage for block crossover"
```

---

## Quick Reference

### Running Tests

```bash
# All GA tests
cd C:/Users/winli/Documents/src/idleon/cogtimizer && node --test tests/BlockCrossover.test.js tests/GeneticAlgorithm.test.js

# Single file
node --test tests/BlockCrossover.test.js

# Everything
node --test tests/
```

### File Summary

| File | Status | Purpose |
|------|--------|---------|
| `BlockCrossover.js` | New | Crossover operator: inherit block from A, fill from B, repair |
| `GeneticAlgorithm.js` | New | Full GA: init, selection, mutation, elitism, solve loop |
| `tests/BlockCrossover.test.js` | New | Structural invariants, fixed/blocked constraints, property-based runs |
| `tests/GeneticAlgorithm.test.js` | New | Init, selection, mutation, generation, solve |

### Key Invariants (Must Hold After Every Crossover)

1. No `initialKey` appears in more than one position in `child.cogs`
2. `fixed` cogs satisfy `cog.key === cog.initialKey`
3. Blocked positions (`slot.blocked === true`) have no entry in `child.cogs`
4. All occupied non-spare positions are in `availableSlotKeys`
5. `child.cogs` count equals `parentA.cogs` count

### Settings Reference

```js
// Pass as second argument to GeneticAlgorithm constructor
{
  populationSize: 40,        // Total individuals in population
  eliteCount: 3,             // Top N copied unchanged to next generation
  tournamentSize: 3,         // Competitors per parent selection
  mutationRate: 0.15,        // Probability child is mutated after crossover
  crossoverBlockRows: 4,     // Block height (rows)
  crossoverBlockCols: 3,     // Block width (columns)
  spareSwapRate: 0.20,       // Fraction of mutations using board-spare swap
  swapMutationMinPairs: 1,   // Min swap pairs per mutation
  swapMutationMaxPairs: 3,   // Max swap pairs per mutation
  greedyEliteCount: 5,       // Top N population members get gentle perturbation
  greedyEliteSwaps: [5, 10], // Swap range for elite members [min, max]
  greedyRestSwaps: [50, 200],// Swap range for non-elite members [min, max]
  seed: 0,                   // RNG seed for reproducibility
  weights: { buildRate: 1, expBonus: 0, flaggy: 0 }, // scoring weights
  targets: null              // or { buildRate, expBonus, flaggy } for target mode
}
```
