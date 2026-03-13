# StepOptimizer Redesign

## Problem

The current `getOptimalSteps` uses cycle decomposition over ALL cog positions (board + spare), then applies a geographic sort that reorders cycles. This causes two bugs:

1. **Empty board slots in step replay.** Open chains (cycles terminating at empty spare positions) get reordered after closed chains that fill the same board positions, causing the geographic sort to overwrite correct placements with empties.
2. **Inflated step count.** Chaining through spare positions creates unnecessary intermediate steps (119 steps for 96 board positions in a real scenario).

## Design

Replace the cycle decomposition + geographic sort with a selection-sort approach over board positions only.

### Algorithm

Process board positions 0–95 in row-major order. For each position, if the cog there doesn't match what the solution expects, find the correct cog (anywhere: board, spare, build) and emit a swap. Track positions as we go.

**Tracking state:**
- `current[pos]` — which cog (by `initialKey`) is at each position. Initialized so each cog starts at its `initialKey`.
- `posOf[initialKey]` — reverse index: current position of each cog.

**Per board position P (0–95):**
1. Look up `targetIk = solution[P].initialKey` — the cog the solution wants here.
2. If `current[P] === targetIk`, skip (already correct).
3. Otherwise: `srcPos = posOf[targetIk]`. Emit step `swap(P, srcPos)`. Update both tracking maps for both positions.

**Post-processing:** Filter out steps where `cogsAreEquivalent(cog, targetCog)` is true (swaps of visually/statistically identical cogs are invisible to the user).

### Step shape

```javascript
{
  board,          // pass-through board reference for rendering
  cog,            // Cog object being moved TO this position
  targetCog,      // Cog object being displaced (or Blank placeholder)
  keyFrom,        // board position being fixed (0–95)
  keyTo           // source position of the correct cog (board, spare, or build)
}
```

The `cycleId` field is dropped — it was only used for the geographic sort.

### Guarantees

- **Optimal step count:** Exactly `N - C` swaps, where N = board positions needing changes, C = number of cycles in the board permutation. Mathematically minimal.
- **Never exceeds 96 steps.**
- **Correct final state:** Each step permanently fixes its target position. No step revisits a position that was already fixed.
- **No reordering needed:** Output order = execution order. The bug class caused by the geographic sort is eliminated entirely.
- **Naturally geographic:** Row-major processing means the user moves left-to-right, top-to-bottom through the board.

### Scope

- Only board positions (0–95) are processed. Spare and build areas are sources/destinations but not targets.
- `cogsAreEquivalent` is unchanged.
- The step rendering pipeline (`printOptimalSteps`, `stepsChangeHandler`, `printMove`) is unchanged — only the step data changes.

### Files changed

- `StepOptimizer.js` — rewrite `getOptimalSteps`, keep `cogsAreEquivalent`
- `tests/StepOptimizer.test.js` — update tests for new behavior, add coverage for:
  - Board-spare swaps don't inflate step count
  - Equivalent cog elimination still works
  - Replay of steps produces correct final board state
  - Step count = N - C (optimal)
  - No empty board slots at any intermediate step (where the starting board was full)
  - Steps never exceed 96
