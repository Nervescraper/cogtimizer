# Step Optimization Design

Optimize the steps shown to users after the solver runs, reducing unnecessary moves and ordering them for easier execution.

## Context

After the solver finds an optimal cog board configuration, `getOptimalSteps()` decomposes the permutation (original -> solved positions) into transpositions (swaps). The user then follows these steps to transform their in-game board. Two problems:

1. **Unnecessary swaps** — The solver may shuffle functionally identical cogs between positions, producing steps that don't affect the score.
2. **Chaotic ordering** — Steps come out in whatever order the cycle decomposition produces, forcing users to jump around the board and spare pages.

## Implementation Phases

### Phase 1: Refactor & Baseline Tests

Extract `getOptimalSteps` into a testable module and write tests covering the existing behavior. No logic changes — purely structural. This creates a safety net before optimization work.

See: `docs/superpowers/plans/2026-03-13-step-refactor.md`

### Phase 2: Step Optimizations

Add equivalent cog elimination and geographic ordering to the extracted module, with tests.

See: plan TBD (written after Phase 1 is complete)

---

## Phase 1: Refactor

### New file: `StepOptimizer.js`

Extract the existing `getOptimalSteps()` function from `index.html` (line 362) into its own file. The function signature is:

```js
function getOptimalSteps(board, cogs) → Array<Step>
```

Where each `Step` has the shape `{ board, cog, targetCog, keyFrom, keyTo }` — identical to today. The `board` parameter is a pass-through reference (the `FakeBoard` instance) used by `printMove` for display; `getOptimalSteps` does not inspect it. Tests can use any placeholder value.

Uses a `module.exports` guard for Node compatibility while remaining a browser global when loaded via `<script>`:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getOptimalSteps };
}
```

### Modify: `CogInventory.js`

Add the same `module.exports` guard at the bottom so `Cog` can be imported in tests:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Cog };
}
```

### Modify: `index.html`

- Add `<script src="StepOptimizer.js"></script>` after `CogInventory.js`
- Replace the inline `f.getOptimalSteps` closure with a call to the extracted global `getOptimalSteps(board, cogs)`
- Keep `printOptimalSteps` and `printMove` in `index.html` (they touch the DOM)

### Testing framework

Node.js test runner (`node --test`) — zero dependencies, available in Node 18+. No package.json or npm install required.

### New file: `tests/StepOptimizer.test.js`

Tests import `Cog` from `CogInventory.js` and `{ getOptimalSteps }` from `StepOptimizer.js`.

### Phase 1 test cases (existing behavior)

1. **No moved cogs** — returns empty array
2. **Single cog moved to empty slot** — returns 1 step with correct keyFrom/keyTo
3. **Two cogs swapped (2-cycle)** — returns 1 step
4. **Three cogs rotated (3-cycle)** — returns 2 steps
5. **Two independent 2-cycles** — returns 2 steps
6. **Unmoved cog among moved cogs** — one cog at its initial position alongside moved cogs; the unmoved cog produces no step
7. **Step shape** — each step has `board`, `cog`, `targetCog`, `keyFrom`, `keyTo`

---

## Phase 2: Optimizations

### Optimization 1: Equivalent Cog Elimination

#### New exported helper: `cogsAreEquivalent(cogA, cogB)`

Two cogs are functionally identical when ALL of these hold:
- `buildRate` values match
- `expBonus` values match
- `flaggy` values match
- Neither has a `boostRadius` (i.e., `boostRadius` is falsy on both)
- Neither is a player cog (`isPlayer` is falsy on both)
- Neither is a flag (`isFlag` is falsy on both)
- Icons match — compare `icon.path` when icon is an object, or compare directly when icon is a string (handles the `"Blank"` string case)

Boost cogs are **never** considered interchangeable because their positional context (neighboring cogs) makes them non-equivalent even with identical stats. Note: when `boostRadius` is falsy, the boost sub-properties (`buildRadiusBoost`, `expRadiusBoost`, `flaggyRadiusBoost`, `flagBoost`) have no effect on scoring (guarded by `if (!entry.boostRadius) continue;` in the scoring loop), so they do not need to be compared.

The `expBoost` score component is contributed by boost cogs radiating onto player positions, not by the cog itself, so it is safe to omit from equivalence checks. Similarly, `expGain` and `nothing` are not referenced in the scoring loop and are excluded from equivalence.

#### Algorithm

1. Build the moved-cog map as today: `interimCogs[initialKey] = cog`
2. **New step**: Before the cycle decomposition loop, scan entries of `interimCogs` for pairs where:
   - `cog_A.key === cog_B.initialKey` AND `cog_B.key === cog_A.initialKey` (they swapped positions)
   - `cogsAreEquivalent(cog_A, cog_B)` returns true
3. Delete both cogs from `interimCogs` — they cancel out.
4. Proceed with cycle decomposition on the reduced map.

Note: the elimination step (step 2) only inspects cogs present in `interimCogs`. The synthetic fallback object created during decomposition (for cogs moving to empty slots) is only constructed in step 4 and is never seen by the elimination logic.

#### Scope

This catches direct 2-cycles of identical non-boost cogs. Longer cycles (3+ identical cogs rotating) are mathematically possible but rare in practice and not worth the complexity.

### Optimization 2: Geographic Step Ordering

#### Cycle-aware sorting constraint

The `stepsChangeHandler` replays steps sequentially on a cloned board (`clone.move(step.keyFrom, step.keyTo)` for each prior step). Steps within a single cycle are order-dependent — reordering them produces a different permutation and corrupts the board state. Steps from *different* cycles are independent and can be freely reordered.

**Solution**: Tag each step with a `cycleId` during decomposition. The sort reorders *cycles* relative to each other based on geographic priority, but preserves the internal order of steps within each cycle.

#### Sorting strategy

Each cycle gets a sort key based on its first step. Cycles are ordered into three output buckets, in this order:

1. **Board-only cycles** — first step has both `keyFrom` and `keyTo` < 96
   - Sort by `min(keyFrom, keyTo)` ascending (row-major order)
2. **Build-area cycles** — first step has at least one key in 96-107 (and none >= 108)
   - Sort by `min(keyFrom, keyTo)` ascending
3. **Spare-involved cycles** — first step has at least one of `keyFrom`/`keyTo` >= 108
   - Primary sort: spare key ascending (so user moves through spare pages in order)
   - Secondary sort: other key ascending (groups moves within same spare page)

**Classification priority** (for steps that could match multiple buckets): spare-involved is checked first, then build-area, then board-only. This only affects which bucket a cycle falls into, not the output order of buckets.

**Cycle sort key heuristic**: based on the first step of the cycle. A cycle that starts on the board but later touches spare could be "misclassified" — this is acceptable as a simple heuristic for an 8x12 board.

#### Spare page context

The spare renderer displays 3 columns and 5 visible rows per page (15 keys per page). Page formula: `page = floor((key - 108) / 15)`. Sorting spare-involved steps by ascending spare key ensures the user progresses through pages sequentially without backtracking.

### Phase 2 test cases

#### `cogsAreEquivalent`

8. **Identical non-boost cogs** — same stats, same icon, no boost/player/flag → true
9. **Different buildRate** → false
10. **Different expBonus** → false
11. **Different flaggy** → false
12. **Different icon.path** → false
13. **One has boostRadius** → false
14. **Both have boostRadius** → false
15. **One is a player** → false
16. **One is a flag** → false
17. **Both have string icon "Blank"** — handled gracefully, returns true if stats match

#### `getOptimalSteps` — equivalence elimination

18. **Two identical cogs swapped** — produces 0 steps
19. **Two different cogs swapped** — produces 1 step (kept)
20. **Three cogs in a cycle, two identical** — cycle preserved (not a direct 2-swap)
21. **Mixed: one eliminable pair + one real move** — only the real move remains

#### `getOptimalSteps` — geographic ordering

22. **Board-only single-step cycles sorted row-major** — keys 50, 10, 30 → output order 10, 30, 50
23. **Spare single-step cycles sorted by spare key** — spare keys 130, 110, 120 → output 110, 120, 130
24. **Output bucket order** — board-only cycles, then build-area, then spare-involved
25. **Steps within a multi-step cycle preserve internal order** — a 3-cycle's step order is unchanged
26. **Spare cycles secondary-sorted by other key** — within same spare page, other keys ascending
27. **Build-area cycles sorted by key** — keys 100, 96, 104 → output 96, 100, 104

## Files

- **Create:** `StepOptimizer.js` — extracted `getOptimalSteps` + `cogsAreEquivalent` + geographic sorting
- **Create:** `tests/StepOptimizer.test.js` — unit tests (Phase 1 baseline + Phase 2 optimization tests)
- **Modify:** `CogInventory.js` — add `module.exports` guard for `Cog`
- **Modify:** `index.html` — add `<script>` tag, replace inline `getOptimalSteps` with call to extracted function
