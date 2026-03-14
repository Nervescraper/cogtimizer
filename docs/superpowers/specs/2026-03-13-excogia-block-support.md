# Excogia Block Support

## Problem

Excogia cogs (formed by combining 4 Yin pieces into a 2x2 block) are currently hardcoded as `fixed` and never moved by the solver. This prevents the solver from exploring whether different Excogia placements — or even breaking them apart — would produce a better board.

Additionally, the scorer doesn't validate whether Excogia pieces are actually in a valid 2x2 arrangement. It trusts the raw data's `boostRadius` field, which means:
- Assembled Excogia pieces get the "everything" boost even if the solver splits them apart
- Broken Yin pieces never get the boost even if the solver reassembles them

## Background

### Excogia in IdleOn

Players can purchase up to 8 Yin/Yang cog pairs from the gem shop. 4 Yin cogs can be combined into an Excogia — a 2x2 block that gains a powerful "Boosts Everything" radius. A player can have 0-2 complete Excogia sets.

**Yin piece (standalone):** Has base stats (buildRate, expBonus, flaggy) but no boost radius. Behaves like a regular stat cog.

**Excogia (assembled 2x2):** Same base stats, plus "everything" boost. Each of the 4 pieces independently emits its boost to every other position on the board (`buildRadiusBoost: 1.25`, `expRadiusBoost: 20`). The 4 pieces must be in the correct arrangement:
- Top-Left at (r, c)
- Top-Right at (r, c+1)
- Bottom-Left at (r+1, c)
- Bottom-Right at (r+1, c+1)

### Data format

Yin/Excogia pieces are identified post-load by icon path containing `Yin_`:
- `icons/cogs/Yin_Top_Left_Cog.png` → Top-Left (TL)
- `icons/cogs/Yin_Top_Right_Cog.png` → Top-Right (TR)
- `icons/cogs/Yin_Bottom_Left_Cog.png` → Bottom-Left (BL)
- `icons/cogs/Yin_Bottom_Right_Cog.png` → Bottom-Right (BR)

These originate from raw icon names `CogZA00` (TL), `CogZA01` (TR), `CogZA02` (BL), `CogZA03` (BR).

Yang cogs (`CogY`, icon `Yang_Cog.png`) are separate — they have `boostRadius: "around"` and are unrelated to Excogia assembly.

**Assembled pieces** in the raw data have `boostRadius: "everything"`, `buildRadiusBoost: 1.25`, `expRadiusBoost: 20`.

**Broken pieces** in the raw data have `boostRadius: null`, `buildRadiusBoost: null`, `expRadiusBoost: null`.

All Yin/Excogia pieces have identical base stats regardless of which gem shop purchase they came from.

### Excogia boost constants

When a valid 2x2 block is detected, each piece gets:
- `boostRadius: "everything"`
- `buildRadiusBoost: 1.25`
- `expRadiusBoost: 20`

These are constants — they don't vary between pieces or sets.

## Design

### 1. Normalize Yin pieces at load time

**CogInventory.js (`load`):**

When loading cog data, strip `boostRadius` and boost values from all Yin/Excogia pieces (detected by icon path containing `Yin_`). Set them to `null`. This ensures the raw data's assembly state doesn't leak into scoring — the scorer determines boost status dynamically from board positions.

Also remove `fixed: c.h === "everything"`. Excogia pieces move freely like any other cog.

### 2. Scorer: position-based Excogia validation

**CogInventory.js (`get score`):**

Before building the boost grid, the scorer determines which Yin pieces are in valid 2x2 blocks:

1. Collect all Yin pieces on the board, grouped by quadrant (match icon path for `Top_Left`, `Top_Right`, `Bottom_Left`, `Bottom_Right`)
2. For each TL piece at board position (r, c), check if a TR exists at (r, c+1), BL at (r+1, c), and BR at (r+1, c+1)
3. Valid block: all 4 pieces are treated as having `boostRadius: "everything"` with the constant boost values (`buildRadiusBoost: 1.25`, `expRadiusBoost: 20`) for this scoring pass
4. Pieces not in a valid 2x2: no boost radius — base stats only

A "complete Excogia set" requires exactly one piece of each quadrant type (TL, TR, BL, BR). With up to 8 Yin pieces, at most 2 sets can be formed.

This works in both directions:
- Assembled Excogia that the solver breaks apart → lose the boost
- Broken Yin pieces that the solver reassembles → gain the boost

**IncrementalScorer.js:**

When a swap involves a Yin piece, fall back to a full recompute rather than incremental update. The "everything" radius affects all 95 other board positions, and forming/breaking a block changes the boost status of up to 4 pieces simultaneously. The full recompute is the simplest correct approach. Since Yin pieces are a small fraction of total cogs, the performance impact of occasional full recomputes is acceptable.

### 3. GreedyInit: pre-assemble Excogia blocks

**GreedyInit.js:**

Before the normal cog classification (localBoostCogs / statCogs / etc.), identify Yin pieces and remove them from the regular placement pool:

1. Extract all Yin pieces from the movable cog list (icon path contains `Yin_`)
2. Group by quadrant. Form complete sets (one TL + one TR + one BL + one BR each)
3. Place each complete set as a 2x2 block, preferring corners in priority order: top-left (0,1,12,13), bottom-right (82,83,94,95), top-right (10,11,22,23), bottom-left (72,73,84,85). If a corner's 4 positions aren't all in `availableSlotKeys`, skip to the next corner. If no corner works, fall back to any available 2x2 on the board.
4. Remaining Yin pieces (incomplete sets) go into the regular `statCogs` pool for normal placement
5. Proceed with normal greedy placement for all other cogs

### 4. No solver changes

Solvers treat Excogia pieces like any other cog. The score signal from the validated scorer provides the natural incentive to keep blocks together (the "everything" boost is very valuable) or break them if better options exist.

## Files changed

- **CogInventory.js** — strip boostRadius/fixed for Yin pieces at load, add `isYinPiece(cog)` helper, add 2x2 validation in scorer
- **IncrementalScorer.js** — fall back to full recompute when a Yin piece is swapped
- **GreedyInit.js** — pre-assemble Excogia blocks in corners before regular placement
- **Tests** — scorer correctly grants/removes boost based on 2x2 arrangement; GreedyInit places blocks correctly
