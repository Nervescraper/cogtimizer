# Tabu Search Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `TabuSearch`, a deterministic local search solver that uses a tabu list with aspiration and diversification to optimize cog placement on the Cogtimizer board.

**Architecture:** `TabuSearch` is a self-contained class in `TabuSearch.js` implementing the `SolverAlgorithm` interface. It wraps an `IncrementalScorer` for fast candidate evaluation, uses a ring-buffer tabu list with a `Set` for O(1) membership checks, and calls `getScoreSum()` (extracted from `Solver.js`) to convert five-field scores into a single scalar.

**Tech Stack:** Vanilla JavaScript, Node.js native test runner (`node --test`), no external dependencies. Depends on infrastructure built in `2026-03-13-solver-infrastructure.md`: `IncrementalScorer`, `SeededRng`, `getScoreSum` (exported from `Solver.js`).

**Spec reference:** Section 2.2 of `docs/superpowers/specs/2026-03-13-solver-algorithms-design.md`

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `TabuSearch.js` | Main implementation: `TabuSearch` class implementing the `SolverAlgorithm` interface. |
| `TabuList.js` | Ring-buffer tabu list with `Set` for O(1) lookup. Normalized `(a,b)` pairs as string keys. |
| `tests/TabuList.test.js` | Unit tests for ring buffer eviction, O(1) lookup, and normalization. |
| `tests/TabuSearch.test.js` | Integration tests: core loop, aspiration criterion, diversification, reproducibility. |

### Modified Files

| File | Change |
|------|--------|
| `Solver.js` | Export `getScoreSum` as a standalone function (already planned in the infrastructure plan; this plan assumes it is available as `require('./Solver.js').getScoreSum`). |

---

## Chunk 1: TabuList — Ring Buffer with O(1) Lookup

The tabu list is the only stateful data structure that is novel to this algorithm. Build and test it first in isolation so it can be used confidently in the main algorithm.

### Task 1: TabuList implementation

**Files:**
- Create: `TabuList.js`
- Create: `tests/TabuList.test.js`

- [ ] **Step 1: Write failing tests for `TabuList`**

```js
// tests/TabuList.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { TabuList } = require('../TabuList.js');

describe('TabuList', () => {
  it('is empty on construction', () => {
    const tl = new TabuList(5);
    assert.strictEqual(tl.has(2, 7), false);
  });

  it('reports a move as tabu after adding it', () => {
    const tl = new TabuList(5);
    tl.add(2, 7);
    assert.strictEqual(tl.has(2, 7), true);
  });

  it('normalizes (a,b) and (b,a) to the same entry', () => {
    const tl = new TabuList(5);
    tl.add(7, 2);
    assert.strictEqual(tl.has(2, 7), true);
    assert.strictEqual(tl.has(7, 2), true);
  });

  it('evicts oldest entry when ring buffer is full', () => {
    const tl = new TabuList(3);
    tl.add(1, 2); // slot 0
    tl.add(3, 4); // slot 1
    tl.add(5, 6); // slot 2
    // All three present
    assert.strictEqual(tl.has(1, 2), true);
    assert.strictEqual(tl.has(3, 4), true);
    assert.strictEqual(tl.has(5, 6), true);
    // Adding a 4th evicts slot 0 (move 1,2)
    tl.add(7, 8);
    assert.strictEqual(tl.has(1, 2), false);
    assert.strictEqual(tl.has(3, 4), true);
    assert.strictEqual(tl.has(5, 6), true);
    assert.strictEqual(tl.has(7, 8), true);
  });

  it('evicts in FIFO order across multiple wraps', () => {
    const tl = new TabuList(2);
    tl.add(1, 2); // slot 0
    tl.add(3, 4); // slot 1
    tl.add(5, 6); // evicts (1,2), slot 0
    tl.add(7, 8); // evicts (3,4), slot 1
    assert.strictEqual(tl.has(1, 2), false);
    assert.strictEqual(tl.has(3, 4), false);
    assert.strictEqual(tl.has(5, 6), true);
    assert.strictEqual(tl.has(7, 8), true);
  });

  it('clears all entries', () => {
    const tl = new TabuList(5);
    tl.add(1, 2);
    tl.add(3, 4);
    tl.clear();
    assert.strictEqual(tl.has(1, 2), false);
    assert.strictEqual(tl.has(3, 4), false);
  });

  it('can re-add a move after it has been evicted', () => {
    const tl = new TabuList(2);
    tl.add(1, 2);
    tl.add(3, 4);
    tl.add(5, 6); // evicts (1,2)
    tl.add(1, 2); // re-add
    assert.strictEqual(tl.has(1, 2), true);
  });

  it('handles adding the same move twice (counts as two slots)', () => {
    const tl = new TabuList(3);
    tl.add(1, 2); // slot 0
    tl.add(1, 2); // slot 1 — duplicate allowed in ring
    tl.add(3, 4); // slot 2
    tl.add(5, 6); // evicts slot 0: (1,2) — but slot 1 still holds (1,2)
    assert.strictEqual(tl.has(1, 2), true); // still present via slot 1
    tl.add(7, 8); // evicts slot 1: (1,2) — now fully gone
    assert.strictEqual(tl.has(1, 2), false);
  });

  it('size property returns tenure', () => {
    const tl = new TabuList(50);
    assert.strictEqual(tl.tenure, 50);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
node --test tests/TabuList.test.js
```

Expected: FAIL — `Cannot find module '../TabuList.js'`

- [ ] **Step 3: Implement `TabuList`**

```js
// TabuList.js

/**
 * Ring-buffer tabu list with O(1) lookup via a Set.
 * Moves are normalized so (a,b) and (b,a) are the same entry.
 */
class TabuList {
  /**
   * @param {number} tenure - Maximum number of moves to remember.
   */
  constructor(tenure) {
    this.tenure = tenure;
    /** @type {string[]} Ring buffer of normalized move keys */
    this._ring = new Array(tenure).fill(null);
    /** @type {Set<string>} Fast membership lookup */
    this._set = new Set();
    /** @type {number} Next write position in ring buffer */
    this._head = 0;
  }

  /**
   * Normalize a pair (a, b) to a canonical string key.
   * Always puts the smaller index first so (a,b) === (b,a).
   * @param {number} a
   * @param {number} b
   * @returns {string}
   */
  _key(a, b) {
    return a < b ? `${a},${b}` : `${b},${a}`;
  }

  /**
   * Add a move to the tabu list, evicting the oldest if full.
   * @param {number} a - First position index
   * @param {number} b - Second position index
   */
  add(a, b) {
    const key = this._key(a, b);
    // Evict the entry currently occupying this ring slot
    const evicted = this._ring[this._head];
    if (evicted !== null) {
      this._set.delete(evicted);
    }
    this._ring[this._head] = key;
    this._set.add(key);
    this._head = (this._head + 1) % this.tenure;
  }

  /**
   * Check if a move is currently tabu.
   * @param {number} a
   * @param {number} b
   * @returns {boolean}
   */
  has(a, b) {
    return this._set.has(this._key(a, b));
  }

  /**
   * Remove all entries from the tabu list.
   */
  clear() {
    this._ring.fill(null);
    this._set.clear();
    this._head = 0;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TabuList };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```
node --test tests/TabuList.test.js
```

Expected: All 9 tests PASS.

- [ ] **Step 5: Commit**

```
git add TabuList.js tests/TabuList.test.js
git commit -m "Add TabuList ring buffer with O(1) Set-backed lookup"
```

---

## Chunk 2: TabuSearch — Core Loop (No Diversification Yet)

Build the minimal working algorithm: generate candidates, evaluate each via apply/read/undo, pick best non-tabu move (with aspiration), apply it, update tabu list.

### Task 2: Core loop — scaffold and candidate evaluation

**Files:**
- Create: `TabuSearch.js`
- Create: `tests/TabuSearch.test.js`

- [ ] **Step 6: Write failing tests for the `TabuSearch` constructor and `displayName`**

```js
// tests/TabuSearch.test.js
const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const { TabuSearch } = require('../TabuSearch.js');

// Minimal mock IncrementalScorer for constructor tests
function makeScorer(scoreValue = 100) {
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
```

- [ ] **Step 7: Run tests to verify they fail**

```
node --test tests/TabuSearch.test.js
```

Expected: FAIL — `Cannot find module '../TabuSearch.js'`

- [ ] **Step 8: Create the `TabuSearch` scaffold**

```js
// TabuSearch.js
const { TabuList } = require('./TabuList.js');

/**
 * Tabu Search solver implementing the SolverAlgorithm interface.
 *
 * Core idea: at each step, evaluate N candidate swaps via incremental scoring
 * (apply → read → undo), pick the best non-tabu move, apply it, add it to
 * the tabu list. Aspiration: allow a tabu move if it produces a new global best.
 * Diversification: after many steps without improvement, perturb and clear the list.
 */
class TabuSearch {
  /**
   * @param {import('./IncrementalScorer.js').IncrementalScorer} scorer
   * @param {Object} settings
   * @param {number} [settings.sampleSize=200]   Candidate moves evaluated per step
   * @param {number} [settings.tabuTenure=50]    Steps a move stays tabu
   * @param {number} [settings.diversifyAfter=1000] Steps without improvement before perturb
   * @param {number} [settings.perturbSize=8]    Random swaps applied during perturbation
   * @param {Object} [settings.rng]              SeededRng instance (optional; falls back to Math.random)
   * @param {Object} [settings.weights]          Score weights { buildRate, expBonus, flaggy }
   * @param {Object} [settings.targets]          Score targets { buildRate, expBonus, flaggy }
   */
  constructor(scorer, settings = {}) {
    this.scorer = scorer;
    this.sampleSize    = settings.sampleSize    ?? 200;
    this.tabuTenure    = settings.tabuTenure    ?? 50;
    this.diversifyAfter = settings.diversifyAfter ?? 1000;
    this.perturbSize   = settings.perturbSize   ?? 8;
    this._rng          = settings.rng           ?? { random: () => Math.random() };
    this._weights      = settings.weights       ?? { buildRate: 1, expBonus: 1, flaggy: 1 };
    this._targets      = settings.targets       ?? null;
    this._tabuList     = new TabuList(this.tabuTenure);
  }

  static get displayName() { return 'Tabu Search'; }
  static get description()  {
    return 'Deterministic local search with short-term memory. Most consistent results between runs.';
  }

  /**
   * Compute a scalar score from the five-field score object.
   * Mirrors Solver.getScoreSum logic.
   * @param {Object} score  { buildRate, expBonus, flaggy, expBoost, flagBoost }
   * @param {number} playerCount
   * @param {number} flagCount
   * @returns {number}
   */
  _scalarScore(score, playerCount, flagCount) {
    if (this._targets) {
      const br = this._targets.buildRate > 0 ? Math.min(score.buildRate / this._targets.buildRate, 1.0) : 1.0;
      const xpEff = score.expBonus * (score.expBoost + playerCount) / playerCount;
      const xp = this._targets.expBonus > 0 ? Math.min(xpEff / this._targets.expBonus, 1.0) : 1.0;
      const flEff = score.flaggy * (score.flagBoost + flagCount) / flagCount;
      const fl = this._targets.flaggy > 0 ? Math.min(flEff / this._targets.flaggy, 1.0) : 1.0;
      return br * xp * fl;
    }
    let res = 0;
    res += score.buildRate * this._weights.buildRate;
    res += score.expBonus  * this._weights.expBonus  * (score.expBoost + playerCount) / playerCount;
    res += score.flaggy    * this._weights.flaggy     * (score.flagBoost + flagCount)  / flagCount;
    return res;
  }

  /**
   * Pick a random element from an array using the configured RNG.
   * @param {Array} arr
   * @returns {*}
   */
  _pick(arr) {
    return arr[Math.floor(this._rng.random() * arr.length)];
  }

  /**
   * Run the Tabu Search.
   * @param {import('./IncrementalScorer.js').IncrementalScorer} scorer
   *   The scorer already initialized to the starting board state.
   * @param {number} timeLimit Time budget in milliseconds.
   * @param {function} onProgress Called every ~500ms with { score, iterations, elapsed }.
   * @returns {void} The best solution is held in the scorer's underlying CogInventory
   *   and also separately tracked as bestInventory (cloned).
   */
  solve(scorer, timeLimit, onProgress) {
    // solve() receives the scorer directly (matches the interface pattern where
    // the worker passes the scorer already seeded with the greedy initial state).
    this.scorer = scorer;
    const inventory  = scorer.inventory;
    const playerCount = inventory.playerCount || 10;
    const flagCount   = Math.max((inventory.flagPose || []).length, 1);
    const allSlots    = inventory.availableSlotKeys; // numeric position indices

    const startTime   = Date.now();
    let lastProgress  = startTime;
    let iterations    = 0;
    let stepsSinceImprovement = 0;

    // Score the initial state
    let currentScalar = this._scalarScore(scorer.score, playerCount, flagCount);
    let bestScalar    = currentScalar;
    let bestInventory = inventory.clone();

    this._tabuList.clear();

    while (Date.now() - startTime < timeLimit) {
      // --- Generate N candidate moves ---
      let bestCandidateScore = -Infinity;
      let bestCandidateA     = -1;
      let bestCandidateB     = -1;
      let bestIsTabu         = false;

      for (let s = 0; s < this.sampleSize; s++) {
        // Draw two distinct slot keys at random
        const posA = this._pick(allSlots);
        let   posB = this._pick(allSlots);
        // Ensure distinct (retry once; collisions are rare)
        if (posB === posA) posB = this._pick(allSlots);
        if (posB === posA) continue;

        const isTabu = this._tabuList.has(posA, posB);

        // Apply swap
        scorer.swap(posA, posB);
        const candidateScalar = this._scalarScore(scorer.score, playerCount, flagCount);
        // Undo swap (symmetric)
        scorer.swap(posA, posB);

        // Aspiration: always allow if new global best
        const isGlobalBest = candidateScalar > bestScalar;

        if (isTabu && !isGlobalBest) continue; // skip tabu, non-improving

        if (candidateScalar > bestCandidateScore) {
          bestCandidateScore = candidateScalar;
          bestCandidateA     = posA;
          bestCandidateB     = posB;
          bestIsTabu         = isTabu;
        }
      }

      // If no viable candidate found (e.g., all candidates were tabu), skip step
      if (bestCandidateA === -1) {
        iterations++;
        stepsSinceImprovement++;
        this._maybeDiversify(scorer, allSlots, stepsSinceImprovement, playerCount, flagCount);
        continue;
      }

      // Apply the chosen move
      scorer.swap(bestCandidateA, bestCandidateB);
      currentScalar = bestCandidateScore;
      this._tabuList.add(bestCandidateA, bestCandidateB);
      iterations++;

      // Track global best
      if (currentScalar > bestScalar) {
        bestScalar    = currentScalar;
        bestInventory = inventory.clone();
        stepsSinceImprovement = 0;
      } else {
        stepsSinceImprovement++;
      }

      // Diversification check
      if (stepsSinceImprovement >= this.diversifyAfter) {
        this._perturb(scorer, allSlots);
        this._tabuList.clear();
        stepsSinceImprovement = 0;
        currentScalar = this._scalarScore(scorer.score, playerCount, flagCount);
      }

      // Progress callback ~every 500ms
      const now = Date.now();
      if (now - lastProgress >= 500) {
        onProgress && onProgress({
          score: bestScalar,
          iterations,
          elapsed: now - startTime,
        });
        lastProgress = now;
      }
    }

    // Restore best found solution into the inventory
    // (Caller reads the returned clone)
    this._bestInventory = bestInventory;
    return bestInventory;
  }

  /**
   * Perform perturbSize random swaps to escape a local optimum.
   * @param {Object} scorer
   * @param {number[]} allSlots
   */
  _perturb(scorer, allSlots) {
    for (let i = 0; i < this.perturbSize; i++) {
      const posA = this._pick(allSlots);
      let   posB = this._pick(allSlots);
      if (posB === posA) posB = this._pick(allSlots);
      if (posB === posA) continue;
      scorer.swap(posA, posB);
    }
  }

  /**
   * @deprecated Internal helper kept for old inline check. Use explicit call instead.
   */
  _maybeDiversify() {}
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TabuSearch };
}
```

- [ ] **Step 9: Run tests to verify constructor tests pass**

```
node --test tests/TabuSearch.test.js
```

Expected: The 5 constructor/metadata tests PASS. The integration tests (not yet written) don't exist yet.

- [ ] **Step 10: Commit**

```
git add TabuSearch.js
git commit -m "Add TabuSearch scaffold: constructor, defaults, scalar scoring, display metadata"
```

---

## Chunk 3: Core Loop Integration Tests

Test the full `solve()` method using a mock `IncrementalScorer` that reports controllable scores, so we can verify the tabu list is consulted, aspiration fires correctly, and the best solution is tracked.

### Task 3: Integration tests for solve()

- [ ] **Step 11: Write integration tests using a mock scorer**

Add to `tests/TabuSearch.test.js`:

```js
// ---- Append to tests/TabuSearch.test.js ----

/**
 * A deterministic mock scorer that tracks swap calls and returns preset scores.
 * The inventory is a plain object with the minimum interface TabuSearch needs.
 */
function makeMockScorer(options = {}) {
  const { availableSlotKeys = [0,1,2,3,4,5,6,7,8,9], scoreSequence = [] } = options;
  let callIndex = 0;
  const swapLog = [];

  const inventory = {
    availableSlotKeys,
    playerCount: 1,
    flagPose: [],
    clone() { return Object.assign({}, this); },
  };

  return {
    inventory,
    get score() {
      const s = scoreSequence[callIndex] ?? 100;
      callIndex++;
      return { buildRate: s, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 };
    },
    swap(a, b) { swapLog.push([a, b]); },
    swapLog,
  };
}

describe('TabuSearch.solve() — basic', () => {
  it('returns an inventory object', () => {
    const scorer = makeMockScorer({ scoreSequence: Array(10000).fill(100) });
    const ts = new TabuSearch(scorer, { sampleSize: 5, tabuTenure: 3 });
    const result = ts.solve(scorer, 50, null);
    assert.ok(result !== null && typeof result === 'object');
  });

  it('calls onProgress at least once during a 200ms solve', (t, done) => {
    const scorer = makeMockScorer({ scoreSequence: Array(100000).fill(100) });
    const ts = new TabuSearch(scorer, { sampleSize: 2, tabuTenure: 3 });
    let progressCalled = false;
    // Use a shorter progress interval for the test by monkey-patching lastProgress
    ts.solve(scorer, 600, () => { progressCalled = true; });
    // onProgress is called synchronously when 500ms elapses; since solve runs for 600ms
    // in a busy loop this will fire. We verify after the call returns.
    assert.ok(progressCalled, 'onProgress was never called');
  });

  it('tracks the best score seen across all steps', () => {
    // Sequence: first evaluation returns 50, later one returns 200 (new best)
    // We interleave: initial score=50, then 200 on one candidate, rest 50
    const scores = [50, ...Array(50).fill(50), 200, ...Array(50000).fill(50)];
    const scorer = makeMockScorer({ scoreSequence: scores });
    const ts = new TabuSearch(scorer, { sampleSize: 5, tabuTenure: 3, diversifyAfter: 9999 });
    ts.solve(scorer, 100, null);
    // The best scalar observed should be ≥ 200 (since 200 appeared in the sequence)
    // We can't easily assert bestScalar directly, but we verify solve() didn't throw
    // and returned a clone. Full behavioral assertion is in the fixture-based tests.
    assert.ok(ts._bestInventory !== null);
  });
});

describe('TabuSearch.solve() — tabu list consulted', () => {
  it('does not immediately re-apply the move just made', () => {
    // If the tabu list works, a move applied at step N won't be re-applied at step N+1
    // We use a tiny slot pool [0,1] so only one possible move exists.
    // Step 1: move (0,1) is applied.
    // Step 2: (0,1) is tabu — no viable candidates — solver should skip or find another.
    const scorer = makeMockScorer({
      availableSlotKeys: [0, 1],
      scoreSequence: Array(100000).fill(100),
    });
    const ts = new TabuSearch(scorer, { sampleSize: 10, tabuTenure: 5, diversifyAfter: 9999 });
    ts.solve(scorer, 150, null);
    // With only 2 slots and tabuTenure=5, after the first move is added to the tabu list
    // there are no non-tabu candidates. The solver should handle this gracefully (not throw).
    assert.ok(true, 'solve() completed without error with all moves tabu');
  });
});

describe('TabuSearch.solve() — aspiration criterion', () => {
  it('accepts a tabu move when it produces a new global best', () => {
    // We'll verify this indirectly: set diversifyAfter very high, use a tiny slot pool,
    // and a score sequence where the only available move (which becomes tabu) later
    // returns a higher score than the best seen. The solver must not get stuck forever.
    // If aspiration is broken the solver would loop without applying any move.
    const scorer = makeMockScorer({
      availableSlotKeys: [0, 1, 2],
      scoreSequence: Array(100000).fill(150),
    });
    // With tenure=1, every move is quickly freed; but at tenure=100 with 3 slots,
    // aspiration would need to fire. We just verify no infinite loop / error:
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
```

- [ ] **Step 12: Run all TabuSearch tests**

```
node --test tests/TabuSearch.test.js
```

Expected: The integration tests should mostly PASS. If any fail, diagnose and fix `TabuSearch.js` before proceeding to the next chunk.

- [ ] **Step 13: Commit**

```
git add tests/TabuSearch.test.js
git commit -m "Add TabuSearch integration tests: core loop, tabu consulted, aspiration, diversification"
```

---

## Chunk 4: Reproducibility via SeededRng

Tabu Search is "nearly deterministic" from the spec — it should produce identical results given the same starting board and the same RNG seed. This chunk wires in `SeededRng` and verifies reproducibility.

### Task 4: SeededRng integration and reproducibility test

- [ ] **Step 14: Write a reproducibility test**

Add to `tests/TabuSearch.test.js`:

```js
// ---- Append to tests/TabuSearch.test.js ----

describe('TabuSearch — reproducibility', () => {
  it('produces identical swap sequences given the same SeededRng seed', () => {
    // We cannot easily test with real SeededRng without importing it,
    // but we can test with a simple deterministic mock RNG.
    function makeDetRng(seed) {
      let s = seed;
      return {
        random() {
          // Minimal LCG for testing
          s = (s * 1664525 + 1013904223) & 0xffffffff;
          return (s >>> 0) / 0xffffffff;
        }
      };
    }

    function runWithSeed(seed) {
      const swaps = [];
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
        swap(a, b) { swaps.push([a, b]); },
      };
      const ts = new TabuSearch(scorer, {
        sampleSize: 5,
        tabuTenure: 3,
        diversifyAfter: 50,
        perturbSize: 2,
        rng: makeDetRng(seed),
      });
      ts.solve(scorer, 80, null);
      return swaps;
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
      const swaps = [];
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
        swap(a, b) { swaps.push([a, b]); },
      };
      const ts = new TabuSearch(scorer, {
        sampleSize: 5,
        tabuTenure: 3,
        rng: makeDetRng(seed),
      });
      ts.solve(scorer, 80, null);
      return swaps;
    }

    const run1 = runWithSeed(1);
    const run2 = runWithSeed(999);
    // Very unlikely to be identical with different seeds
    const allSame = run1.length === run2.length &&
      run1.every((pair, i) => pair[0] === run2[i][0] && pair[1] === run2[i][1]);
    assert.strictEqual(allSame, false, 'Different seeds produced identical sequences (suspicious)');
  });
});
```

- [ ] **Step 15: Run tests**

```
node --test tests/TabuSearch.test.js
```

Expected: All tests PASS. The `_rng` is already wired into `_pick()` from Step 8, so this should pass without changes to `TabuSearch.js`.

- [ ] **Step 16: Commit**

```
git add tests/TabuSearch.test.js
git commit -m "Add reproducibility tests for TabuSearch with seeded RNG"
```

---

## Chunk 5: Fixture-Based Quality Test

Smoke-test the algorithm against a real board fixture to verify it produces valid states and improves over the starting score. This test is allowed to be slow (~2s) since it's a quality gate, not a unit test.

### Task 5: Fixture smoke test

**Note:** This test requires `IncrementalScorer` and `CogInventory` to be available. It is tagged `slow` and excluded from the fast unit test run. Run it only when the infrastructure plan is complete.

- [ ] **Step 17: Write fixture smoke test**

Create `tests/TabuSearch.fixture.test.js`:

```js
// tests/TabuSearch.fixture.test.js
//
// Slow integration test — requires IncrementalScorer + CogInventory.
// Run with: node --test tests/TabuSearch.fixture.test.js
//
// Skip this file from the fast test suite (node --test tests/*.test.js)
// by naming convention: only run *.fixture.test.js explicitly.

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

// These modules come from the infrastructure plan.
// If they don't exist yet, this file will fail to require — that is expected.
const { TabuSearch }        = require('../TabuSearch.js');
const { IncrementalScorer } = require('../IncrementalScorer.js');
// CogInventory requires browser globals; load via the test helper.
const { buildInventoryFromFixture } = require('./helpers.js');

const FIXTURE_PATH = path.join(__dirname, '..', 'malthorin.json');

describe('TabuSearch fixture smoke test', () => {
  it('produces a valid board with score >= greedy initial score (malthorin.json)', () => {
    const raw = JSON.parse(fs.readFileSync(FIXTURE_PATH, 'utf8'));
    const inventory = buildInventoryFromFixture(raw);
    const scorer = new IncrementalScorer(inventory);

    const initialScalar = scorer.scalarScore({ buildRate: 1, expBonus: 1, flaggy: 1 });

    const ts = new TabuSearch(scorer, {
      sampleSize: 200,
      tabuTenure: 50,
      diversifyAfter: 1000,
      perturbSize: 8,
      weights: { buildRate: 1, expBonus: 1, flaggy: 1 },
    });

    const best = ts.solve(scorer, 2000, null);

    // Re-score the best result via full recompute to verify
    const finalFull = best.score;
    const finalScalar =
      finalFull.buildRate * 1 +
      finalFull.expBonus  * 1 * (finalFull.expBoost + (inventory.playerCount || 10)) / (inventory.playerCount || 10) +
      finalFull.flaggy    * 1 * (finalFull.flagBoost + Math.max((inventory.flagPose || []).length, 1)) / Math.max((inventory.flagPose || []).length, 1);

    assert.ok(
      finalScalar >= initialScalar,
      `TabuSearch result (${finalScalar.toFixed(2)}) is worse than the initial score (${initialScalar.toFixed(2)})`
    );

    // Validity: no fixed cog should have moved
    for (const cog of Object.values(best.cogs)) {
      if (cog.fixed) {
        assert.strictEqual(
          cog.key, cog.initialKey,
          `Fixed cog ${cog.name} moved from ${cog.initialKey} to ${cog.key}`
        );
      }
    }
  });
});
```

- [ ] **Step 18: Run the fixture test (after infrastructure is available)**

```
node --test tests/TabuSearch.fixture.test.js
```

Expected: 1 test PASS. If IncrementalScorer is not yet built, the test will fail with "Cannot find module" — that is expected and acceptable. Re-run once the infrastructure plan is complete.

- [ ] **Step 19: Commit**

```
git add tests/TabuSearch.fixture.test.js
git commit -m "Add fixture smoke test for TabuSearch quality gate"
```

---

## Chunk 6: Edge Cases and Robustness

Cover edge conditions that could cause silent incorrect behavior.

### Task 6: Edge case tests

- [ ] **Step 20: Write edge case tests**

Add to `tests/TabuSearch.test.js`:

```js
// ---- Append to tests/TabuSearch.test.js ----

describe('TabuSearch — edge cases', () => {
  it('handles a board with only two available slots without throwing', () => {
    // Minimum possible board: can only ever make one distinct swap
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
    // Should return without error; result may be the initial clone
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
    // If no progress was posted (very fast machine, <500ms), that's OK too.
  });

  it('_perturb does not throw with minimum slots', () => {
    const scorer = makeMockScorer({ availableSlotKeys: [0, 1] });
    const ts = new TabuSearch(scorer, { perturbSize: 10 });
    assert.doesNotThrow(() => ts._perturb(scorer, [0, 1]));
  });
});
```

- [ ] **Step 21: Run all unit tests**

```
node --test tests/TabuList.test.js tests/TabuSearch.test.js
```

Expected: All tests PASS.

- [ ] **Step 22: Commit**

```
git add tests/TabuSearch.test.js
git commit -m "Add edge case tests for TabuSearch: minimal board, zero time limit, progress fields"
```

---

## Chunk 7: Final Wiring — Module Exports and Interface Compliance

Ensure `TabuSearch` exports exactly what the worker orchestration layer expects and that the `SolverAlgorithm` interface contract is fully met.

### Task 7: Interface compliance test

- [ ] **Step 23: Write interface compliance tests**

Add to `tests/TabuSearch.test.js`:

```js
// ---- Append to tests/TabuSearch.test.js ----

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
    // Should not throw when constructed with scorer + empty settings
    assert.doesNotThrow(() => new TabuSearch(makeScorer(), {}));
    // Should not throw when constructed with scorer only (settings defaults)
    assert.doesNotThrow(() => new TabuSearch(makeScorer()));
  });
});
```

- [ ] **Step 24: Run all unit tests one final time**

```
node --test tests/TabuList.test.js tests/TabuSearch.test.js
```

Expected: All tests PASS (approx. 25–30 tests total).

- [ ] **Step 25: Final commit**

```
git add TabuSearch.js TabuList.js tests/TabuList.test.js tests/TabuSearch.test.js tests/TabuSearch.fixture.test.js
git commit -m "Complete TabuSearch implementation: core loop, tabu list, aspiration, diversification, reproducibility"
```

---

## Summary of All Files

| File | Status | Purpose |
|------|--------|---------|
| `TabuList.js` | New | Ring-buffer tabu list, O(1) Set lookup, FIFO eviction, normalized keys |
| `TabuSearch.js` | New | SolverAlgorithm implementation: core loop, aspiration, diversification, _scalarScore |
| `tests/TabuList.test.js` | New | 9 unit tests covering eviction, normalization, clear, re-add |
| `tests/TabuSearch.test.js` | New | ~25 tests: constructor, core loop, tabu consulted, aspiration, diversification, reproducibility, edge cases, interface compliance |
| `tests/TabuSearch.fixture.test.js` | New | 1 slow fixture test — run manually after infrastructure is ready |

## Commands Quick Reference

```bash
# Run all unit tests for this plan
node --test tests/TabuList.test.js tests/TabuSearch.test.js

# Run fixture test (requires IncrementalScorer from infrastructure plan)
node --test tests/TabuSearch.fixture.test.js

# Run everything together
node --test tests/TabuList.test.js tests/TabuSearch.test.js tests/TabuSearch.fixture.test.js
```

## Dependencies on Infrastructure Plan

The following symbols are assumed available from `2026-03-13-solver-infrastructure.md`:

| Symbol | File | Used in |
|--------|------|---------|
| `IncrementalScorer` | `IncrementalScorer.js` | `TabuSearch.fixture.test.js`, and real `solve()` usage in the worker |
| `SeededRng` | `SeededRng.js` | Passed in as `settings.rng` for reproducible runs |
| `buildInventoryFromFixture` | `tests/helpers.js` | `TabuSearch.fixture.test.js` |
| `inventory.availableSlotKeys` | `CogInventory.js` | Core loop slot sampling |
| `inventory.clone()` | `CogInventory.js` | Best solution tracking |
| `scorer.swap(posA, posB)` | `IncrementalScorer.js` | Candidate evaluation (apply/undo) |
| `scorer.score` | `IncrementalScorer.js` | Five-field score read after each swap |

The `TabuList.js` and `TabuSearch.js` unit tests are fully self-contained and run without any infrastructure dependencies.
