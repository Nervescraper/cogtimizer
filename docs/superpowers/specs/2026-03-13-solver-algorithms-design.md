# Solver Algorithms — Design Spec

**Date:** 2026-03-13
**Status:** Draft
**Goal:** Improve solver speed, consistency, and offer multiple algorithm choices

## Problem Statement

The Cogtimizer solver uses simulated annealing to optimize cog placement on an 8×12 board. Current limitations:

- **Speed:** Full score recomputation on every swap wastes the majority of compute time
- **Consistency:** Stochastic results vary significantly between runs
- **Single approach:** Users have no way to try alternative strategies

### Problem Domain

- **Board:** 8×12 = 96 main positions. 12 build-area positions exist but the solver does not move build-area cogs. Some board positions may be blocked/locked and are excluded from `availableSlotKeys`.
- **Cog pool:** Up to ~272 cogs (96 board + variable spare area starting at position 108). Most common case: full board, full spare area.
- **Objective:** Maximize a weighted combination of buildRate, expBonus, and flaggy (two scoring modes: weighted sum and target-based product)
- **Spatial coupling:** Boost cogs radiate bonuses to neighbors via radius patterns (adjacent, diagonal, row, column, up/down/left/right, corners, around, everything)
- **Constraints:** Fixed cogs (including "everything" boost cogs) cannot be moved. Blocked positions cannot receive cogs. Build-area cogs are not moved.

### Search Space

Selecting cogs from the pool and placing them optimally is astronomically large. In practice, the best cogs are often obvious (gem-store cogs), so the real problem is placement optimization + fringe cog selection.

---

## Architecture Overview

```
┌──────────────────────────────────────────────────┐
│                    UI (index.html)                │
│  Algorithm selector ─ Settings ─ Progress display │
└──────────────────┬───────────────────────────────┘
                   │ postMessage (serialized inventory + settings)
                   ▼
┌──────────────────────────────────────────────────┐
│                 SolverWorker.js                   │
│                                                  │
│  ┌────────────┐  ┌──────────────────────────┐    │
│  │  Greedy    │──▶  Selected Algorithm       │    │
│  │  Init      │  │  (SA / Tabu / GA)        │    │
│  └────────────┘  └──────────┬───────────────┘    │
│                             │                    │
│                  ┌──────────▼───────────────┐    │
│                  │  IncrementalScorer       │    │
│                  │  (shared infrastructure) │    │
│                  └──────────────────────────┘    │
└──────────────────────────────────────────────────┘
```

Two phases of work:
1. **Infrastructure** (prerequisite): IncrementalScorer, GreedyInit, Web Worker, common algorithm interface
2. **Algorithms** (parallelizable): Improved SA, Tabu Search, Genetic Algorithm

---

## Phase 1: Infrastructure

### 1.1 Incremental Scoring Engine

#### Motivation

The current `CogInventory.score` getter rebuilds the entire 8×12 bonus grid and re-sums all cog contributions on every access. The `move()` method invalidates the cache (`this._score = null`). This means every single swap in the solver triggers a full O(board_size) recomputation.

For iterative solvers doing thousands of swaps per second, this is the dominant bottleneck.

#### Scoring Logic Reference

The existing `score` getter (CogInventory.js lines 407-507) works as follows:

1. **Bonus grid construction:** For each position in `availableSlotKeys` that contains a boost cog, write its radius contributions into an 8×12 grid. Note: `availableSlotKeys` only includes non-fixed, non-blocked main board positions (key < 96). Spare-area cogs do not participate in the bonus grid. The grid has **four fields per cell**: `buildRate`, `flaggy`, `expBoost`, `flagBoost`. Different boost cog properties write to different grid fields:
   - `buildRadiusBoost` → grid cell's `buildRate`
   - `flaggyRadiusBoost` → grid cell's `flaggy`
   - `expRadiusBoost` → grid cell's `expBoost`
   - `flagBoost` → grid cell's `flagBoost`

2. **Base stat accumulation:** For each cog on the board, sum base stats: `buildRate`, `expBonus`, `flaggy`.

3. **Bonus-modified stats:** For `buildRate` and `flaggy`, add `Math.ceil(baseStat * gridBonus / 100)` at each position. Note: `expBonus` is not directly modified by the bonus grid — it is a simple sum of base values. However, `expBoost` (accumulated from the bonus grid at player cog positions, see step 4) amplifies `expBonus` in the `getScoreSum` weighting formula: `expBonus * weight * (expBoost + playerCount) / playerCount`. So boost cogs with `expRadiusBoost` near player cogs indirectly increase the value of `expBonus`.

4. **Player cog expBoost:** For each player cog (`isPlayer === true`), add the `expBoost` value **read from the bonus grid** at that cog's position.

5. **Flag position flagBoost:** For each flag position, add the `flagBoost` value **read from the bonus grid** at that position.

6. **Final multiplier:** `flaggy = Math.floor(flaggy * (1 + flaggyShopUpgrades * 0.5))`

**Important distinction:** Boost cogs **write to** the bonus grid. Player cogs and flag positions **read from** the bonus grid. These are different roles.

**Note on `tinyMultipliers`:** These are load-time constants computed from tiny cogs (positions 228-251). They are used only for UI display formatting, not in the `score` getter. The IncrementalScorer does not need to track them.

#### Design

**`IncrementalScorer`** — a class that wraps a `CogInventory` and maintains:

- **Persistent bonus grid** (`bonusGrid[row][col]`): the four-field accumulated boost contributions at each position, updated incrementally
- **Running score totals**: the five score fields (buildRate, expBonus, flaggy, expBoost, flagBoost) updated incrementally. The `flaggy` running total is stored **pre-multiplier** (before the `flaggyShopUpgrades` multiplication). The multiplier is applied only when reading the final score.
- **Per-position contribution cache**: the exact ceiled contribution each cog makes at its current position, so we can subtract the exact value when withdrawing. This is necessary because `Math.ceil` is non-linear: `ceil(a*x) + ceil(b*x) ≠ ceil((a+b)*x)`.

#### Swap Protocol

On a swap of positions A and B:

**Step 1 — Withdraw both positions:**
For each position (A, then B):
- Subtract the cog's cached contribution from running totals:
  - Base `buildRate`, `expBonus`, `flaggy`
  - Ceiled bonus-modified `buildRate` and `flaggy` (using the cached ceiled value)
- If the cog is a **boost cog**: remove its radius contributions from the bonus grid (subtract from the four grid fields at each affected position). Then, for every position affected by that radius change that contains a cog, recompute that cog's bonus-modified contribution and update the running totals (subtract old cached value, add new value, update cache).
- If the cog is a **player cog**: subtract the `expBoost` value at this position from the bonus grid from the running `expBoost` total.
- If this is a **flag position**: subtract the `flagBoost` value at this position from the bonus grid from the running `flagBoost` total.

**Step 2 — Perform the swap** in the underlying `CogInventory`.

**Step 3 — Deposit both positions:**
Reverse of withdraw — add back all contributions with the new cog at each position. Cache the new per-position ceiled contributions.

**Step 4 — Read score:**
Return the five raw running totals with `flaggy` multiplied by `(1 + flaggyShopUpgrades * 0.5)` and floored. The IncrementalScorer returns these five raw fields; the algorithm layer (each `SolverAlgorithm`) applies the weighting/target logic via `getScoreSum()` to produce a single scalar for comparison.

**Important: withdraw ordering.** If both positions contain boost cogs, withdrawing A changes the bonus grid, which affects B's bonus-modified contributions. Both positions must be fully withdrawn before either is deposited. The sequence is: withdraw A, withdraw B, swap, deposit A, deposit B.

#### Undo Semantics

Undoing a swap is simply performing the same swap again (swapping the same two positions). The withdraw/deposit protocol is symmetric — applying it twice returns to the original state. This is critical for Tabu Search's candidate evaluation (apply → read → undo). The per-position contribution cache ensures no floating-point or rounding drift accumulates, since we always subtract the exact cached value that was previously added.

#### Complexity per swap

| Cog type swapped | Cost |
|---|---|
| Non-boost cog | O(1) — update two positions only |
| Local boost cog (adjacent, diagonal, corners, around, up/down/left/right) | O(k) where k = 4-12 affected positions |
| Row/column boost cog | O(row or column length) |
| "Everything" boost cog | N/A — these are fixed, never swapped |

Common case is O(1) to O(12), a massive improvement over O(96) every time.

#### Verification Strategy

- `IncrementalScorer` exposes a `fullRecompute()` method that uses the existing `CogInventory.score` logic
- In tests: after every swap in a sequence, assert `incrementalScore === fullRecompute()` for all 5 score fields
- Test with saved board fixtures (malthorin.json, etc.) + random swap sequences
- Stress test: 100,000 random swaps on each fixture, assert match throughout
- Edge cases: swaps involving boost cogs of every radius type, mutual boost-cog swaps, player cogs, flag positions, board edges/corners, positions where bonus grid values are zero
- Debug mode flag that runs this assertion every N moves during live solves

---

### 1.2 Greedy Construction Heuristic

#### Motivation

The current solver starts from a 500-random-swap shuffle, which produces a low-quality starting solution. A greedy heuristic can produce a dramatically better starting point in milliseconds, meaning every algorithm spends its time refining a good solution rather than climbing out of a bad one.

#### Algorithm

**Step 1 — Classify and rank cogs:**
- Score each cog by raw base stats weighted by current goal
- Boost cogs get a heuristic bonus: `magnitude × coverage_area`
- Select top ~110-120 candidates as the working pool (two-phase decomposition)
- Respect `availableSlotKeys` — only positions in this list are eligible for placement (blocked/locked positions are excluded)

**Step 2 — Place local boost cogs first (sorted by impact: magnitude × coverage):**
- For each boost cog (excluding "everything" cogs), try each open position, pick the one that maximizes radius coverage of available positions (all positions in `availableSlotKeys`, not just currently occupied ones — they will all eventually contain cogs)
- Prefer central positions for large-radius boosts (around), edge-aligned positions for directional boosts (up/down/left/right)
- Simple greedy: O(boost_cogs × open_positions)

**Step 3 — Place "everything" boost cogs:**
- All "everything" cogs come from the gem store and have identical stats — they are fully interchangeable
- They boost every position equally regardless of placement, so their position doesn't affect their boost contribution
- However, they occupy a position that receives local boosts from other cogs, and their own base stats are meaningful
- **Placement by marginal value:** For each remaining open position, compare the score gain from placing an everything cog there vs. placing the best available stat cog there. Put the everything cog in the position where the **difference is smallest** (i.e., where the everything cog is nearly as good as the best stat cog alternative, minimizing opportunity cost)
- Once placed, these remain fixed for all subsequent optimization

**Step 4 — Place stat/player/flag cogs:**
- Sort remaining open positions by accumulated bonus (from placed boost cogs), highest first
- For each position, place the best available cog:
  - Player cogs → positions with highest expBoost accumulation
  - Flag-position cogs → prioritize cogs with high flaggy
  - Other positions → highest weighted stat contribution including bonus at that position

#### Correctness

- Output must be a valid board state (no duplicate cogs, fixed cogs unmoved, blocked positions empty)
- Score computed by the existing full-recompute `CogInventory.score` getter (greedy runs once, doesn't need incremental scoring)
- Test: greedy solution score ≥ median of 100 random shuffles on all fixture boards

---

### 1.3 Web Worker

#### Motivation

The solver currently runs on the main thread with `setTimeout` yields every 100ms to prevent UI freeze. This wastes compute time and limits solver throughput.

#### Design

**`SolverWorker.js`** — a Web Worker that:

**Inbound messages:**
- `{ command: "solve", inventory: <serialized>, algorithm: "sa"|"tabu"|"ga", settings: {...} }` — start solving
- `{ command: "cancel" }` — stop early, return best found so far

**Outbound messages:**
- `{ type: "progress", score: <number>, elapsed: <ms>, iterations: <count> }` — posted every ~500ms
- `{ type: "done", inventory: <serialized>, score: <number>, stats: {...} }` — final result

**Serialization:** `CogInventory` and `Cog` objects need custom serialization since they contain class instances, a Proxy-based `FakeBoard`, and method references. The approach: serialize the raw cog data (the plain properties of each `Cog`) and reconstruct `CogInventory` in the worker. The `clone()` method's pattern of copying individual fields is the model — the serializer does the same thing to/from JSON. This is more involved than plain `JSON.stringify` but bounded in complexity.

**Global state:** The current solver uses a global `g.best` to persist the best solution across solver invocations. In the worker context, this state lives in the worker's module scope instead. The worker posts the best result back; the UI stores it.

**Cancellation:** The worker checks a flag between iterations and stops early if cancelled.

**Single worker to start.** Multiple workers (e.g., for GA population parallelism) are possible later but add complexity.

#### Fallback

If Web Workers are unavailable (unlikely in modern browsers), fall back to the current main-thread approach with `setTimeout` yields.

---

### 1.4 Common Algorithm Interface

All three algorithms implement the same interface:

```js
class SolverAlgorithm {
  /**
   * @param {IncrementalScorer} scorer - Scoring engine
   * @param {Object} settings - Algorithm-specific settings
   */
  constructor(scorer, settings) { }

  /**
   * Run the solver.
   * @param {CogInventory} inventory - Initial board state (from greedy init)
   * @param {number} timeLimit - Time budget in ms
   * @param {function} onProgress - Called periodically with { score, iterations, elapsed }
   * @returns {CogInventory} - Best solution found
   */
  solve(inventory, timeLimit, onProgress) { }

  /** Human-readable name for UI display */
  static get displayName() { return ""; }

  /** Brief description for UI tooltip */
  static get description() { return ""; }
}
```

The orchestration flow in the worker:

```
1. Deserialize inventory
2. Run greedy construction → initial state
3. Instantiate selected algorithm with IncrementalScorer
4. algorithm.solve(initialState, timeLimit, postProgress)
5. removeUselessMoves(best)
6. Serialize and post result
```

---

## Phase 2: Algorithms

### 2.1 Improved Simulated Annealing

The current approach, substantially improved.

#### Changes from current implementation

| Aspect | Current | Improved |
|---|---|---|
| Scoring | Full recompute every swap | Incremental scoring |
| Initial state | 500 random swaps | Greedy construction |
| Restart strategy | Multi-start: every 10k iterations, clone original, re-shuffle, reset temp, keep all solutions, pick best at end | Reheat: preserve current solution, bump temperature when stalled (see tradeoff note) |
| Neighborhood | Uniform random slot + random cog | Weighted: prefer swapping boost cogs and cogs near boost positions. Mix of board-board and board-spare swaps |
| Cooling | Fixed rate 0.9997 | Adaptive: target ~30% acceptance rate. If acceptance too high, cool faster; if too low, cool slower |
| Thread | Main thread with yields | Web Worker |

#### Tradeoff: Reheat vs Multi-Start

The current multi-start approach provides diversity — each restart explores from a different random starting point, which can discover qualitatively different solutions. The proposed reheat strategy preserves the current good solution while re-enabling exploration, which is better at refining a single solution but provides less diversity. With a greedy initial solution (which is already high quality), reheat is likely more effective since the starting point is good. The multi-start diversity is somewhat replaced by the GA algorithm for users who want exploration.

#### Neighborhood Operators

- **Board-board swap** (70% of moves): swap two cogs on the board. Weighted toward positions near boost cogs (higher spatial impact).
- **Board-spare swap** (30% of moves): swap a board cog with a spare-pool cog. Allows the algorithm to discover that a different cog belongs on the board.

#### Reheat Strategy

- Track iterations since last improvement
- If stalled for `staleLimit` iterations (e.g., 5000), set `temperature = initialTemperature * 0.5`
- This preserves the current good solution while re-enabling exploration
- Reset stale counter after reheat

#### Settings

```js
{
  coolingTarget: 0.30,   // Target acceptance rate
  staleLimit: 5000,      // Iterations before reheat
  reheatFactor: 0.5,     // Reheat to this fraction of initial temp
  boardSpareRatio: 0.3   // Fraction of moves that are board-spare swaps
}
```

---

### 2.2 Tabu Search

Deterministic local search with short-term memory.

#### Core Loop

```
1. Start from greedy initial solution
2. Each step:
   a. Generate a sample of N candidate moves (e.g., 200 random swaps)
   b. Evaluate each using incremental scoring (apply swap, read score, undo swap)
   c. Pick the BEST candidate that is NOT in the tabu list
      - Exception (aspiration): allow a tabu move if it produces a new global best
   d. Apply the chosen move
   e. Add the move to the tabu list (ring buffer)
3. Repeat until time budget exhausted
```

#### Key Parameters

```js
{
  sampleSize: 200,       // Candidate moves evaluated per step
  tabuTenure: 50,        // How many steps a move stays tabu
  diversifyAfter: 1000,  // Steps without improvement before perturbation
  perturbSize: 8         // Number of random swaps in perturbation
}
```

#### Tabu List Representation

Store moves as `(posA, posB)` pairs in a ring buffer of size `tabuTenure`. Lookup via a Set for O(1) membership checks. Normalize pairs so `(a,b)` and `(b,a)` are the same entry.

#### Diversification

If no improvement for `diversifyAfter` steps:
- Perform `perturbSize` random swaps (mix of board-board and board-spare)
- Clear the tabu list
- Resume search from the perturbed state

#### Why Tabu Search

- **Consistency:** Given the same starting point (greedy init), tabu search follows a largely deterministic path. Much less variance between runs than SA.
- **No temperature tuning:** The tabu mechanism replaces the cooling schedule.
- **Competitive quality:** Research consistently shows tabu search matching or beating SA on assignment and permutation problems.

#### Candidate Evaluation via Undo

Each candidate evaluation requires: apply swap → read score → undo swap. The undo is simply performing the same swap again (see IncrementalScorer undo semantics above). With incremental scoring:
- Apply: O(1) to O(12) depending on cog type
- Read: O(1)
- Undo: O(1) to O(12) (identical cost, symmetric operation)

So evaluating 200 candidates per step costs ~200 × O(small_constant), which is very fast.

---

### 2.3 Genetic Algorithm

Population-based evolutionary approach.

#### Representation

Each individual is a `CogInventory` (board state). The population is an array of individuals.

#### Memory Considerations

Each `CogInventory.clone()` creates a deep copy of all cogs and slots (~272 Cog objects + ~120 slot objects). With a population of 40, this is ~40 × 400 = ~16,000 small objects. This is manageable in browser memory.

For scoring during the generation loop: individuals do **not** each maintain their own `IncrementalScorer`. Instead, a single `IncrementalScorer` is used. When evaluating an individual, the scorer is initialized from that individual's inventory state via `fullRecompute()`. Incremental scoring is then used within crossover/mutation evaluation (candidate comparisons during repair), not across generation boundaries. Full recomputation per individual per generation is acceptable since it happens once per individual (~40 times per generation) rather than thousands of times per iteration.

#### Initialization

- Population size: 40
- Top 5 individuals: greedy construction with slight variations (randomly swap 5-10 cogs after greedy placement to introduce diversity)
- Remaining 35: greedy construction followed by 50-200 random swaps each (varying perturbation levels)

#### Selection

**Tournament selection:** pick 3 random individuals, the one with the highest score wins. This provides selection pressure without being as aggressive as rank-based selection.

#### Crossover — Block Crossover

Designed to preserve spatial relationships:

1. Pick a random rectangular sub-region of the board (e.g., 4×3 = 12 positions, only counting positions in `availableSlotKeys`)
2. Child inherits all cog assignments within that region from Parent A
3. For remaining positions, assign cogs from Parent B's arrangement:
   - If a cog from Parent B is already placed (in the inherited region), skip it
   - Fill conflicts greedily from the remaining cog pool (best cog for each position considering local bonus)
4. Validate: no duplicate cogs, all constraints satisfied (fixed cogs unmoved, blocked positions empty)

This preserves local spatial clusters (boost cog + its beneficiaries) which is where the scoring structure lives.

#### Mutation

Applied to each child with probability `mutationRate`:

- **Swap mutation** (80%): swap 1-3 random pairs of board cogs
- **Spare mutation** (20%): swap a random board cog with a spare-pool cog

#### Elitism

The top 3 individuals survive unchanged into the next generation. This guarantees the best-known solution is never lost.

#### Generation Loop

```
1. Evaluate all individuals (score each via full recompute)
2. Post progress: best score, generation number, elapsed time
3. Select parents via tournament selection
4. Create children via crossover + mutation
5. Replace population (keep elite, fill rest with children)
6. Repeat until time budget exhausted
```

#### Progressive Results

Each generation takes ~100-500ms (depending on population size and crossover repair cost). This naturally produces visible improvement every few hundred milliseconds — ideal for UI feedback.

#### Settings

```js
{
  populationSize: 40,
  tournamentSize: 3,
  eliteCount: 3,
  mutationRate: 0.15,
  crossoverBlockSize: [4, 3],  // rows × cols of crossover region
  spareSwapRate: 0.20          // fraction of mutations that are board-spare
}
```

#### Correctness Risks and Mitigations

Crossover is the trickiest part — it can produce invalid states if not careful:

- **Duplicate cogs:** The repair step must ensure no cog appears twice. Test with property-based checks after every crossover.
- **Fixed cog violations:** Crossover must never move fixed cogs. The inherited region and repair both skip fixed positions.
- **Score accuracy:** Each individual's score must match full recomputation. Verified in tests.

---

## Correctness Strategy (All Algorithms)

### Incremental Scoring Verification

- Unit tests: replay random swap sequences on fixture boards, assert incremental === full recompute after every swap
- Stress test: 100,000 random swaps on each fixture, assert match throughout
- Edge cases: swaps involving boost cogs of every radius type, mutual boost-cog swaps, player cogs, flag positions, board edges/corners, positions with zero bonus

### Valid State Invariants

After every operation (swap, crossover, mutation, greedy placement):
- No cog key appears in more than one position
- All `fixed` cogs are at their original positions
- All `blocked` positions are empty
- Only positions in `availableSlotKeys` are used for placement

### Regression Testing

- Save known board configs + algorithm results as golden test data
- Cross-validate: run all three algorithms on the same input, verify all produce valid boards with correct scores
- The existing `removeUselessMoves` validates that solutions are "tight" (no swaps that don't change the score)

### Deterministic Replay

- All algorithms accept an optional RNG seed for reproducible results
- Tabu search is naturally deterministic given the same starting point
- SA and GA use a seeded PRNG instead of `Math.random()` in test mode

---

## UI Integration

### Algorithm Selector

Add a dropdown or radio group to the settings panel:
- **Simulated Annealing** — "Fast stochastic optimizer. Good general performance."
- **Tabu Search** — "Systematic search. Most consistent results."
- **Genetic Algorithm** — "Population-based. Explores diverse solutions."

### Progress Display

All algorithms post progress via the same interface. The UI shows:
- Current best score (updating live)
- Iterations/generations completed
- Elapsed time
- Optionally: a score-over-time chart

### Settings

Algorithm-specific settings are exposed under an "Advanced" toggle. Sensible defaults mean most users never need to touch them.

---

## Implementation Order

### Phase 1: Infrastructure (sequential, prerequisite)

1. **IncrementalScorer** — the foundation everything depends on. Build with comprehensive tests.
2. **Greedy construction heuristic** — tested independently against fixture boards.
3. **Common algorithm interface** — define the `SolverAlgorithm` contract.
4. **Web Worker** — wrap the orchestration flow. Test with the existing SA first (ported to the new interface).

### Phase 2: Algorithms (parallelizable, independent)

5. **Improved SA** — refactor existing `Solver.js` to use IncrementalScorer and new interface.
6. **Tabu Search** — new implementation.
7. **Genetic Algorithm** — new implementation, crossover needs most testing.

Phase 2 tasks are independent and can be developed/tested in parallel.
