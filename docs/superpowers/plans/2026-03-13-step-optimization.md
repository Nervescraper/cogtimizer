# Step Optimization Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add equivalent cog elimination and geographic step ordering to `getOptimalSteps`, reducing unnecessary steps and presenting them in a user-friendly order.

**Architecture:** Add a `cogsAreEquivalent` helper and modify `getOptimalSteps` in `StepOptimizer.js`. The cycle decomposition loop gets `cycleId` tagging. After decomposition, steps are sorted by cycle (preserving intra-cycle order). Both functions are exported for testing.

**Tech Stack:** Vanilla JS, Node.js test runner (`node:test`, `node:assert`)

**Spec:** `docs/superpowers/specs/2026-03-13-step-optimization-design.md` (Phase 2 section)

---

### Task 1: Add `cogsAreEquivalent` helper with tests

**Files:**
- Modify: `StepOptimizer.js` (add function before `getOptimalSteps`, update `module.exports`)
- Modify: `tests/StepOptimizer.test.js` (add test suite)

- [ ] **Step 1: Write failing tests for `cogsAreEquivalent`**

Add to `tests/StepOptimizer.test.js`. Update the import at line 4 to include `cogsAreEquivalent`:

```js
const { getOptimalSteps, cogsAreEquivalent } = require('../StepOptimizer.js');
```

Then add this new describe block after the existing two:

```js
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
```

- [ ] **Step 2: Run tests — expect 10 new tests to fail**

Run: `node --test tests/StepOptimizer.test.js`

Expected: 12 existing tests pass, 10 new tests fail with `cogsAreEquivalent is not a function` (not exported yet).

- [ ] **Step 3: Implement `cogsAreEquivalent` in StepOptimizer.js**

Add this function before `getOptimalSteps` (after the Cog import guard, before line 6):

```js
function cogsAreEquivalent(a, b) {
  if (a.boostRadius || b.boostRadius) return false;
  if (a.isPlayer || b.isPlayer) return false;
  if (a.isFlag || b.isFlag) return false;
  if (a.buildRate !== b.buildRate) return false;
  if (a.expBonus !== b.expBonus) return false;
  if (a.flaggy !== b.flaggy) return false;
  // Icon can be a string ("Blank") or object with .path
  const iconA = typeof a.icon === 'string' ? a.icon : (a.icon && a.icon.path);
  const iconB = typeof b.icon === 'string' ? b.icon : (b.icon && b.icon.path);
  if (iconA !== iconB) return false;
  return true;
}
```

Update the `module.exports` at the bottom of `StepOptimizer.js`:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getOptimalSteps, cogsAreEquivalent };
}
```

- [ ] **Step 4: Run tests — all 22 should pass**

Run: `node --test tests/StepOptimizer.test.js`

Expected: All 22 tests pass.

- [ ] **Step 5: Commit**

```bash
git add StepOptimizer.js tests/StepOptimizer.test.js
git commit -m "feat: add cogsAreEquivalent helper with tests"
```

---

### Task 2: Add equivalence elimination to `getOptimalSteps` with tests

**Files:**
- Modify: `StepOptimizer.js` (add elimination logic inside `getOptimalSteps`)
- Modify: `tests/StepOptimizer.test.js` (add test suite)

- [ ] **Step 1: Write failing tests for equivalence elimination**

Add this describe block to `tests/StepOptimizer.test.js`:

```js
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
```

- [ ] **Step 2: Run tests — expect 1 new test to fail (identical swap still produces 1 step)**

Run: `node --test tests/StepOptimizer.test.js`

The "eliminates swap of two identical cogs" and "eliminates one pair while keeping other moves" tests should fail (producing steps instead of 0). The others should pass since they test existing behavior that doesn't change.

- [ ] **Step 3: Add elimination logic to `getOptimalSteps`**

In `StepOptimizer.js`, inside `getOptimalSteps`, add this block **after** the `interimCogs` map is built (after the `for` loop at line 14-16) and **before** the cycle decomposition `while` loop:

```js
  // Eliminate 2-cycles of equivalent cogs (they cancel out)
  const interimKeys = Object.keys(interimCogs);
  const eliminated = new Set();
  for (const key of interimKeys) {
    if (eliminated.has(key)) continue;
    const cogA = interimCogs[key];
    const otherKey = String(cogA.key);
    const cogB = interimCogs[otherKey];
    // Check: is this a direct 2-swap (A at B's original pos, B at A's original pos)?
    if (cogB && String(cogB.key) === key && cogsAreEquivalent(cogA, cogB)) {
      eliminated.add(key);
      eliminated.add(otherKey);
    }
  }
  for (const key of eliminated) {
    delete interimCogs[key];
  }
```

- [ ] **Step 4: Run tests — all 26 should pass (12 existing + 10 equivalence helper + 4 elimination)**

Run: `node --test tests/StepOptimizer.test.js`

Expected: All 26 tests pass. Critically, the baseline replay tests must still pass — the elimination must not break existing step correctness.

- [ ] **Step 5: Commit**

```bash
git add StepOptimizer.js tests/StepOptimizer.test.js
git commit -m "feat: eliminate swaps of equivalent cogs in getOptimalSteps"
```

---

### Task 3: Add geographic step ordering with tests

**Files:**
- Modify: `StepOptimizer.js` (add `cycleId` to steps, add sort after decomposition)
- Modify: `tests/StepOptimizer.test.js` (add test suite)

- [ ] **Step 1: Write failing tests for geographic ordering**

Add this describe block to `tests/StepOptimizer.test.js`:

```js
describe('getOptimalSteps — geographic ordering', () => {

  it('board-only single-step cycles sorted row-major', () => {
    // Three independent swaps at board positions 50, 10, 30
    // Each is a 2-cycle (swap with different cog), so each produces 1 step
    const cogs = cogDict([
      makeCog(51, 50, { buildRate: 1 }),
      makeCog(50, 51, { buildRate: 2 }),
      makeCog(11, 10, { buildRate: 3 }),
      makeCog(10, 11, { buildRate: 4 }),
      makeCog(31, 30, { buildRate: 5 }),
      makeCog(30, 31, { buildRate: 6 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 3);
    // Should be sorted by min(keyFrom, keyTo): 10, 30, 50
    assert.ok(Math.min(steps[0].keyFrom, steps[0].keyTo) <= Math.min(steps[1].keyFrom, steps[1].keyTo));
    assert.ok(Math.min(steps[1].keyFrom, steps[1].keyTo) <= Math.min(steps[2].keyFrom, steps[2].keyTo));
  });

  it('spare single-step cycles sorted by spare key ascending', () => {
    // Three independent swaps involving spare positions 130, 110, 120
    const cogs = cogDict([
      makeCog(130, 5, { buildRate: 1 }),
      makeCog(5, 130, { buildRate: 2 }),
      makeCog(110, 15, { buildRate: 3 }),
      makeCog(15, 110, { buildRate: 4 }),
      makeCog(120, 25, { buildRate: 5 }),
      makeCog(25, 120, { buildRate: 6 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 3);
    // Extract spare keys from each step
    const spareKeys = steps.map(s => s.keyFrom >= 108 ? s.keyFrom : s.keyTo);
    assert.ok(spareKeys[0] <= spareKeys[1], `${spareKeys[0]} should be <= ${spareKeys[1]}`);
    assert.ok(spareKeys[1] <= spareKeys[2], `${spareKeys[1]} should be <= ${spareKeys[2]}`);
  });

  it('output bucket order: board-only, then build-area, then spare', () => {
    // One swap in each region
    const cogs = cogDict([
      // Spare swap
      makeCog(110, 5, { buildRate: 1 }),
      makeCog(5, 110, { buildRate: 2 }),
      // Board swap
      makeCog(21, 20, { buildRate: 3 }),
      makeCog(20, 21, { buildRate: 4 }),
      // Build-area swap
      makeCog(97, 96, { buildRate: 5 }),
      makeCog(96, 97, { buildRate: 6 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 3);
    // First step should be board-only (keys < 96)
    assert.ok(steps[0].keyFrom < 96 && steps[0].keyTo < 96,
      `First step should be board-only, got keyFrom=${steps[0].keyFrom} keyTo=${steps[0].keyTo}`);
    // Second step should be build-area (at least one key 96-107, none >= 108)
    const s1Keys = [steps[1].keyFrom, steps[1].keyTo];
    assert.ok(s1Keys.some(k => k >= 96 && k <= 107),
      `Second step should involve build area`);
    // Third step should be spare-involved (at least one key >= 108)
    assert.ok(steps[2].keyFrom >= 108 || steps[2].keyTo >= 108,
      `Third step should involve spare`);
  });

  it('steps within a multi-step cycle preserve internal order', () => {
    // A 3-cycle produces 2 steps. After sorting, their relative order must be preserved.
    // Use board keys so it's in the board-only bucket.
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10 }),
      makeCog(2, 1, { buildRate: 20 }),
      makeCog(0, 2, { buildRate: 30 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 2);

    // Replay must still produce correct result (this is the critical check)
    const grid = replaySteps(steps, cogs);
    for (const c of Object.values(cogs)) {
      assert.strictEqual(grid[c.key], c.initialKey,
        `Position ${c.key} should contain cog from ${c.initialKey}, got cog from ${grid[c.key]}`);
    }
  });

  it('spare cycles secondary-sorted by other key', () => {
    // Two swaps involving the same spare page but different board positions
    // Spare keys are on the same page (both 108-122), board keys differ
    const cogs = cogDict([
      makeCog(109, 50, { buildRate: 1 }),
      makeCog(50, 109, { buildRate: 2 }),
      makeCog(108, 10, { buildRate: 3 }),
      makeCog(10, 108, { buildRate: 4 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 2);
    // Both involve spare page 0. Secondary sort is by the other (non-spare) key.
    // Step with board key 10 should come before step with board key 50.
    const otherKey0 = steps[0].keyFrom < 108 ? steps[0].keyFrom : steps[0].keyTo;
    const otherKey1 = steps[1].keyFrom < 108 ? steps[1].keyFrom : steps[1].keyTo;
    assert.ok(otherKey0 <= otherKey1,
      `Other key ${otherKey0} should be <= ${otherKey1}`);
  });

  it('build-area cycles sorted by key ascending', () => {
    const cogs = cogDict([
      makeCog(100, 5, { buildRate: 1 }),
      makeCog(5, 100, { buildRate: 2 }),
      makeCog(96, 15, { buildRate: 3 }),
      makeCog(15, 96, { buildRate: 4 }),
      makeCog(104, 25, { buildRate: 5 }),
      makeCog(25, 104, { buildRate: 6 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 3);
    // min keys should be ascending
    const mins = steps.map(s => Math.min(s.keyFrom, s.keyTo));
    assert.ok(mins[0] <= mins[1], `${mins[0]} should be <= ${mins[1]}`);
    assert.ok(mins[1] <= mins[2], `${mins[1]} should be <= ${mins[2]}`);
  });

});
```

- [ ] **Step 2: Run tests — expect ordering tests to fail (no sorting yet)**

Run: `node --test tests/StepOptimizer.test.js`

The ordering tests should fail (steps are not sorted). The existing baseline and replay tests should still pass.

- [ ] **Step 3: Add `cycleId` tagging to cycle decomposition**

In `StepOptimizer.js`, inside `getOptimalSteps`, replace the existing `while` loop (the cycle decomposition) with a version that tags each step with a `cycleId`. The cycle boundary is when `targetCog === cog` (self-loop = cycle fully unwound). Increment `cycleId` there.

Replace the entire `while` loop with:

```js
  // Multi-step movements — tag each step with its cycleId for sorting
  let cycleId = 0;
  let tuple;
  while (tuple = Object.entries(interimCogs)[0]) {
    const [key, cog] = tuple;
    const targetCog = interimCogs[cog.key] || { icon: "Blank", key, position: cog.position.bind(cog) };
    if (targetCog === cog) {
      delete interimCogs[key];
      cycleId++;
      continue;
    }
    interimCogs[key] = targetCog;
    steps.push({
      board,
      cog,
      targetCog,
      keyFrom: Number.parseInt(key),
      keyTo: Number.parseInt(cog.key),
      cycleId
    });
    delete interimCogs[cog.key];
  }
```

- [ ] **Step 4: Add geographic sort after the cycle decomposition**

After the `while` loop and before `return steps;`, add the sorting logic:

```js
  // Geographic sort — reorder cycles, preserving intra-cycle step order
  const SPARE_START = 108;
  const BUILD_START = 96;
  const BUILD_END = 107;

  function cycleSortKey(step) {
    const kf = step.keyFrom;
    const kt = step.keyTo;
    // Classification priority: spare first, then build, then board
    if (kf >= SPARE_START || kt >= SPARE_START) {
      const spareKey = kf >= SPARE_START ? kf : kt;
      const otherKey = kf >= SPARE_START ? kt : kf;
      return { bucket: 2, primary: spareKey, secondary: otherKey };
    }
    if ((kf >= BUILD_START && kf <= BUILD_END) || (kt >= BUILD_START && kt <= BUILD_END)) {
      return { bucket: 1, primary: Math.min(kf, kt), secondary: 0 };
    }
    return { bucket: 0, primary: Math.min(kf, kt), secondary: 0 };
  }

  // Group steps by cycleId, compute sort key from first step of each cycle
  const cycleMap = new Map();
  for (const step of steps) {
    if (!cycleMap.has(step.cycleId)) {
      cycleMap.set(step.cycleId, { steps: [], sortKey: cycleSortKey(step) });
    }
    cycleMap.get(step.cycleId).steps.push(step);
  }

  // Sort cycles by bucket, then primary, then secondary
  const sortedCycles = [...cycleMap.values()].sort((a, b) => {
    if (a.sortKey.bucket !== b.sortKey.bucket) return a.sortKey.bucket - b.sortKey.bucket;
    if (a.sortKey.primary !== b.sortKey.primary) return a.sortKey.primary - b.sortKey.primary;
    return a.sortKey.secondary - b.sortKey.secondary;
  });

  // Flatten back to step array, preserving intra-cycle order
  steps.length = 0;
  for (const cycle of sortedCycles) {
    for (const step of cycle.steps) {
      steps.push(step);
    }
  }
```

- [ ] **Step 5: Run tests — all should pass**

Run: `node --test tests/StepOptimizer.test.js`

Expected: All 32 tests pass:
- 7 baseline behavior tests
- 5 replay correctness tests
- 10 equivalence helper tests
- 4 elimination tests
- 6 ordering tests

- [ ] **Step 6: Commit**

```bash
git add StepOptimizer.js tests/StepOptimizer.test.js
git commit -m "feat: add geographic step ordering with cycle-aware sorting"
```
