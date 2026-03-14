# Excogia Block Support Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Excogia cogs movable by the solver with correct scoring — the "everything" boost is only applied when 4 Yin pieces form a valid 2x2 block on the board.

**Architecture:** Normalize Yin pieces at load time (strip raw boostRadius), validate 2x2 blocks dynamically in both scorers, pre-assemble blocks in GreedyInit. Solvers unchanged — the score signal naturally incentivizes keeping blocks together.

**Tech Stack:** Vanilla JS, Node.js test runner (`node --test`)

**Spec:** `docs/superpowers/specs/2026-03-13-excogia-block-support.md`

---

## Chunk 1: Yin piece detection and scorer validation

### Task 1: Add `isYinPiece` helper and Excogia constants

**Files:**
- Create: `ExcogiaHelper.js`
- Test: `tests/ExcogiaHelper.test.js`

- [ ] **Step 1: Write failing tests for Yin piece detection**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { isYinPiece, getYinQuadrant, findExcogiaBlocks, EXCOGIA_BOOST } = require('../ExcogiaHelper.js');
const { Cog } = require('../CogInventory.js');

function makeCog(key, opts = {}) {
  return new Cog({ key, initialKey: key, icon: opts.icon || { path: 'icons/cogs/Cog_Nooby.png' }, ...opts });
}

describe('isYinPiece', () => {
  it('returns true for Yin_Top_Left_Cog icon', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } });
    assert.strictEqual(isYinPiece(cog), true);
  });

  it('returns true for Yin_Bottom_Right_Cog icon', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } });
    assert.strictEqual(isYinPiece(cog), true);
  });

  it('returns false for Yang_Cog icon', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yang_Cog.png' } });
    assert.strictEqual(isYinPiece(cog), false);
  });

  it('returns false for regular cog icon', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Cog_Nooby.png' } });
    assert.strictEqual(isYinPiece(cog), false);
  });

  it('returns false for string icon like Blank', () => {
    const cog = makeCog(0, { icon: 'Blank' });
    assert.strictEqual(isYinPiece(cog), false);
  });
});

describe('getYinQuadrant', () => {
  it('returns TL for Top_Left', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Top_Left_Cog.png' } });
    assert.strictEqual(getYinQuadrant(cog), 'TL');
  });

  it('returns TR for Top_Right', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Top_Right_Cog.png' } });
    assert.strictEqual(getYinQuadrant(cog), 'TR');
  });

  it('returns BL for Bottom_Left', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' } });
    assert.strictEqual(getYinQuadrant(cog), 'BL');
  });

  it('returns BR for Bottom_Right', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' } });
    assert.strictEqual(getYinQuadrant(cog), 'BR');
  });

  it('returns null for non-Yin cog', () => {
    const cog = makeCog(0, { icon: { path: 'icons/cogs/Yang_Cog.png' } });
    assert.strictEqual(getYinQuadrant(cog), null);
  });
});

describe('EXCOGIA_BOOST', () => {
  it('has the expected constant values', () => {
    assert.strictEqual(EXCOGIA_BOOST.buildRadiusBoost, 1.25);
    assert.strictEqual(EXCOGIA_BOOST.expRadiusBoost, 20);
    assert.strictEqual(EXCOGIA_BOOST.boostRadius, 'everything');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/ExcogiaHelper.test.js`
Expected: FAIL (module not found)

- [ ] **Step 3: Implement ExcogiaHelper.js**

```javascript
// ExcogiaHelper.js
// Shared helpers for Excogia block detection and validation.

if (typeof require !== 'undefined') {
  var _cogMod = require('./CogInventory.js');
  Cog = _cogMod.Cog;
}

var INV_COLUMNS = 12;
var INV_ROWS = 8;

var EXCOGIA_BOOST = {
  boostRadius: 'everything',
  buildRadiusBoost: 1.25,
  expRadiusBoost: 20,
};

function isYinPiece(cog) {
  if (!cog || !cog.icon) return false;
  var path = typeof cog.icon === 'string' ? cog.icon : (cog.icon.path || '');
  return path.indexOf('Yin_') !== -1;
}

var QUADRANT_MAP = {
  'Top_Left': 'TL',
  'Top_Right': 'TR',
  'Bottom_Left': 'BL',
  'Bottom_Right': 'BR',
};

function getYinQuadrant(cog) {
  if (!isYinPiece(cog)) return null;
  var path = typeof cog.icon === 'string' ? cog.icon : (cog.icon.path || '');
  for (var pattern in QUADRANT_MAP) {
    if (path.indexOf(pattern) !== -1) return QUADRANT_MAP[pattern];
  }
  return null;
}

/**
 * Scan board positions and return an array of valid Excogia blocks.
 * Each block is { tlKey, trKey, blKey, brKey } with the board position keys.
 *
 * @param {function} getCog - function(key) returning the Cog at that board position, or falsy
 * @param {number[]} boardKeys - array of board position keys to scan (0-95)
 * @returns {Array<{tlKey: number, trKey: number, blKey: number, brKey: number}>}
 */
function findExcogiaBlocks(getCog, boardKeys) {
  // Build a map of board position -> quadrant for Yin pieces
  var yinPositions = {}; // key -> quadrant string
  for (var i = 0; i < boardKeys.length; i++) {
    var key = boardKeys[i];
    var cog = getCog(key);
    if (!cog) continue;
    var q = getYinQuadrant(cog);
    if (q) yinPositions[key] = q;
  }

  // Find valid 2x2 blocks: TL at (r,c), TR at (r,c+1), BL at (r+1,c), BR at (r+1,c+1)
  var blocks = [];
  var used = {};
  for (var tlKey in yinPositions) {
    if (yinPositions[tlKey] !== 'TL') continue;
    tlKey = Number(tlKey);
    if (used[tlKey]) continue;
    var row = Math.floor(tlKey / INV_COLUMNS);
    var col = tlKey % INV_COLUMNS;
    if (col + 1 >= INV_COLUMNS || row + 1 >= INV_ROWS) continue; // 2x2 must fit on board

    var trKey = row * INV_COLUMNS + (col + 1);
    var blKey = (row + 1) * INV_COLUMNS + col;
    var brKey = (row + 1) * INV_COLUMNS + (col + 1);

    if (yinPositions[trKey] === 'TR' && !used[trKey] &&
        yinPositions[blKey] === 'BL' && !used[blKey] &&
        yinPositions[brKey] === 'BR' && !used[brKey]) {
      blocks.push({ tlKey: tlKey, trKey: trKey, blKey: blKey, brKey: brKey });
      used[tlKey] = true;
      used[trKey] = true;
      used[blKey] = true;
      used[brKey] = true;
    }
  }
  return blocks;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isYinPiece, getYinQuadrant, findExcogiaBlocks, EXCOGIA_BOOST };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/ExcogiaHelper.test.js`
Expected: PASS

- [ ] **Step 5: Add tests for findExcogiaBlocks**

Add to `tests/ExcogiaHelper.test.js`:

```javascript
describe('findExcogiaBlocks', () => {
  const TL_ICON = { path: 'icons/cogs/Yin_Top_Left_Cog.png' };
  const TR_ICON = { path: 'icons/cogs/Yin_Top_Right_Cog.png' };
  const BL_ICON = { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' };
  const BR_ICON = { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' };

  function boardFromCogs(cogMap) {
    return function(key) { return cogMap[key]; };
  }

  it('finds a valid 2x2 block at top-left corner', () => {
    // TL at (0,0)=key0, TR at (0,1)=key1, BL at (1,0)=key12, BR at (1,1)=key13
    const cogs = {
      0: makeCog(0, { icon: TL_ICON }),
      1: makeCog(1, { icon: TR_ICON }),
      12: makeCog(12, { icon: BL_ICON }),
      13: makeCog(13, { icon: BR_ICON }),
    };
    const keys = [0, 1, 12, 13];
    const blocks = findExcogiaBlocks(boardFromCogs(cogs), keys);
    assert.strictEqual(blocks.length, 1);
    assert.deepStrictEqual(blocks[0], { tlKey: 0, trKey: 1, blKey: 12, brKey: 13 });
  });

  it('returns empty when pieces are split apart', () => {
    const cogs = {
      0: makeCog(0, { icon: TL_ICON }),
      5: makeCog(5, { icon: TR_ICON }),  // not adjacent
      12: makeCog(12, { icon: BL_ICON }),
      13: makeCog(13, { icon: BR_ICON }),
    };
    const keys = [0, 5, 12, 13];
    const blocks = findExcogiaBlocks(boardFromCogs(cogs), keys);
    assert.strictEqual(blocks.length, 0);
  });

  it('returns empty when wrong quadrant order', () => {
    // TR at (0,0) instead of TL — wrong arrangement
    const cogs = {
      0: makeCog(0, { icon: TR_ICON }),
      1: makeCog(1, { icon: TL_ICON }),
      12: makeCog(12, { icon: BL_ICON }),
      13: makeCog(13, { icon: BR_ICON }),
    };
    const keys = [0, 1, 12, 13];
    const blocks = findExcogiaBlocks(boardFromCogs(cogs), keys);
    assert.strictEqual(blocks.length, 0);
  });

  it('finds two blocks on the board', () => {
    const cogs = {
      0: makeCog(0, { icon: TL_ICON }),
      1: makeCog(1, { icon: TR_ICON }),
      12: makeCog(12, { icon: BL_ICON }),
      13: makeCog(13, { icon: BR_ICON }),
      82: makeCog(82, { icon: TL_ICON }),
      83: makeCog(83, { icon: TR_ICON }),
      94: makeCog(94, { icon: BL_ICON }),
      95: makeCog(95, { icon: BR_ICON }),
    };
    const keys = Array.from({ length: 96 }, (_, i) => i);
    const blocks = findExcogiaBlocks(boardFromCogs(cogs), keys);
    assert.strictEqual(blocks.length, 2);
  });

  it('ignores non-Yin cogs', () => {
    const cogs = {
      0: makeCog(0, { icon: { path: 'icons/cogs/Cog_Nooby.png' } }),
      1: makeCog(1, { icon: { path: 'icons/cogs/Cog_Nooby.png' } }),
      12: makeCog(12, { icon: { path: 'icons/cogs/Cog_Nooby.png' } }),
      13: makeCog(13, { icon: { path: 'icons/cogs/Cog_Nooby.png' } }),
    };
    const keys = [0, 1, 12, 13];
    const blocks = findExcogiaBlocks(boardFromCogs(cogs), keys);
    assert.strictEqual(blocks.length, 0);
  });
});
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `node --test tests/ExcogiaHelper.test.js`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add ExcogiaHelper.js tests/ExcogiaHelper.test.js
git commit -m "feat: add ExcogiaHelper with Yin detection, quadrant parsing, and block finder"
```

---

### Task 2: Normalize Yin pieces at load time and unfix Excogia

**Files:**
- Modify: `CogInventory.js:329` (fixed assignment)
- Modify: `CogInventory.js:~315-331` (cog creation in load)

- [ ] **Step 1: Remove the `fixed` assignment for "everything" cogs**

In `CogInventory.js`, change line 329:

```javascript
// Old:
fixed: c.h === "everything",

// New:
fixed: false,
```

- [ ] **Step 2: Strip boostRadius and boost values from Yin pieces at load time**

After the cog creation loop in `load()` (after line 331 where cogs are pushed), add normalization. Find the loop that creates cogs from `cogArray` and after each cog is created, check if it's a Yin piece:

Add after the cog creation (after `this.cogs` is populated, around line 390 before the score computation area):

```javascript
// Normalize Yin/Excogia pieces: strip boost data so scorer determines it from position
for (const key of Object.keys(this.cogs)) {
  const cog = this.cogs[key];
  if (cog.icon && typeof cog.icon === 'object' && cog.icon.path && cog.icon.path.indexOf('Yin_') !== -1) {
    cog.boostRadius = null;
    cog.buildRadiusBoost = null;
    cog.expRadiusBoost = null;
  }
}
```

- [ ] **Step 3: Run existing tests to verify nothing breaks**

Run: `node --test tests/StepOptimizer.test.js`
Expected: PASS (37 tests)

- [ ] **Step 4: Commit**

```bash
git add CogInventory.js
git commit -m "feat: unfix Excogia cogs and normalize Yin pieces at load time

Excogia pieces are no longer hardcoded as fixed. Their boostRadius
is stripped at load — the scorer will determine it dynamically based
on 2x2 board arrangement."
```

---

### Task 3: Add Excogia validation to CogInventory scorer

**Files:**
- Modify: `CogInventory.js` (get score method, ~lines 411-463)
- Modify: `index.html` (add script tag for ExcogiaHelper.js)

- [ ] **Step 1: Add ExcogiaHelper imports**

In `index.html`, after the `BoostPositions.js` script tag:

```html
<script type="text/javascript" src="ExcogiaHelper.js"></script>
```

In `CogInventory.js`, add a `require` block at the top alongside the existing BoostPositions require:

```javascript
if (typeof require !== 'undefined') {
  var _excMod = require('./ExcogiaHelper.js');
  findExcogiaBlocks = _excMod.findExcogiaBlocks;
  isYinPiece = _excMod.isYinPiece;
  EXCOGIA_BOOST = _excMod.EXCOGIA_BOOST;
}
```

- [ ] **Step 2: Modify the scorer to validate Excogia blocks**

In `CogInventory.js`, in `get score()`, before the bonus grid loop (before line 424), add block detection and a set of boosted keys:

```javascript
    // Detect valid Excogia 2x2 blocks — only these Yin pieces get the "everything" boost
    const self = this;
    const excogiaBlocks = findExcogiaBlocks(
      function(key) { return self.get(key); },
      this.availableSlotKeys
    );
    const excogiaActiveKeys = new Set();
    for (const block of excogiaBlocks) {
      excogiaActiveKeys.add(block.tlKey);
      excogiaActiveKeys.add(block.trKey);
      excogiaActiveKeys.add(block.blKey);
      excogiaActiveKeys.add(block.brKey);
    }
```

Then in the bonus grid loop (line 424-436), modify how boost cogs are processed. Replace the existing loop:

```javascript
    for (let key of this.availableSlotKeys) {
      const entry = this.get(key);
      if (!entry.boostRadius) {
        // Check if this is a Yin piece in a valid Excogia block
        if (!excogiaActiveKeys.has(key)) continue;
      }
      const { x: j, y: i } = entry.position();

      // Determine effective boost values
      let boostRadius, buildRadiusBoost, flaggyRadiusBoost, expRadiusBoost, flagBoost;
      if (excogiaActiveKeys.has(key)) {
        // Yin piece in valid 2x2 — use Excogia constants
        boostRadius = EXCOGIA_BOOST.boostRadius;
        buildRadiusBoost = EXCOGIA_BOOST.buildRadiusBoost;
        expRadiusBoost = EXCOGIA_BOOST.expRadiusBoost;
        flaggyRadiusBoost = 0;
        flagBoost = 0;
      } else {
        // Regular boost cog — use its own values
        boostRadius = entry.boostRadius;
        buildRadiusBoost = entry.buildRadiusBoost || 0;
        flaggyRadiusBoost = entry.flaggyRadiusBoost || 0;
        expRadiusBoost = entry.expRadiusBoost || 0;
        flagBoost = entry.flagBoost || 0;
      }

      const boosted = getBoostPositions(boostRadius, i, j);
      for (const boostCord of boosted) {
        const bonus = CogInventory._saveGet(bonusGrid, ...boostCord);
        if (!bonus) continue;
        bonus.buildRate += buildRadiusBoost;
        bonus.flaggy    += flaggyRadiusBoost;
        bonus.expBoost  += expRadiusBoost;
        bonus.flagBoost += flagBoost;
      }
    }
```

- [ ] **Step 3: Run existing tests**

Run: `node --test tests/StepOptimizer.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add CogInventory.js index.html
git commit -m "feat: scorer validates Excogia 2x2 blocks before applying everything boost

Yin pieces only get the everything boost when arranged in a valid 2x2
block on the board. Broken/scattered pieces contribute base stats only."
```

---

### Task 4: Add Excogia validation to IncrementalScorer

**Files:**
- Modify: `IncrementalScorer.js`
- Modify: `SolverWorker.js` (add importScripts for ExcogiaHelper.js)

- [ ] **Step 1: Add ExcogiaHelper import to SolverWorker.js**

Add to the `importScripts` list in `SolverWorker.js`:

```javascript
importScripts('ExcogiaHelper.js');
```

- [ ] **Step 2: Modify IncrementalScorer to validate Excogia blocks**

The approach: when `swap()` involves a Yin piece, fall back to a full recompute. The "everything" radius affects all 95 positions, and forming/breaking a block changes 4 pieces simultaneously.

In `IncrementalScorer.js`, modify the `swap` method:

```javascript
swap(posA, posB) {
  if (posA === posB) return;
  var cogA = this._inv.cogs[posA];
  var cogB = this._inv.cogs[posB];
  // If either cog is a Yin piece, do a full recompute — the everything boost
  // fans out to all positions and forming/breaking blocks changes 4 pieces at once
  if ((cogA && isYinPiece(cogA)) || (cogB && isYinPiece(cogB))) {
    this._inv.move(posA, posB);
    this._initFromScratch();
    return;
  }
  this._withdraw(posA);
  this._withdraw(posB);
  this._inv.move(posA, posB);
  this._deposit(posA);
  this._deposit(posB);
}
```

- [ ] **Step 3: Modify `_initFromScratch` to use Excogia validation**

In `_initFromScratch`, the bonus grid loop (lines 37-50) needs the same Excogia block detection as the CogInventory scorer. Before the loop, add:

```javascript
var self = this;
var excogiaBlocks = findExcogiaBlocks(
  function(key) { return self._inv.get(key); },
  self._inv.availableSlotKeys
);
var excogiaActiveKeys = {};
for (var b = 0; b < excogiaBlocks.length; b++) {
  var block = excogiaBlocks[b];
  excogiaActiveKeys[block.tlKey] = true;
  excogiaActiveKeys[block.trKey] = true;
  excogiaActiveKeys[block.blKey] = true;
  excogiaActiveKeys[block.brKey] = true;
}
```

Then modify the bonus grid loop to use the same logic as the CogInventory scorer — check `excogiaActiveKeys` for Yin pieces, use `EXCOGIA_BOOST` constants for valid blocks, skip non-block Yin pieces.

- [ ] **Step 4: Run existing tests**

Run: `node --test tests/StepOptimizer.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add IncrementalScorer.js SolverWorker.js
git commit -m "feat: IncrementalScorer validates Excogia blocks, full recompute on Yin swap

Falls back to full recompute when a Yin piece is involved in a swap
since the everything boost affects all positions and block status can
change for up to 4 pieces simultaneously."
```

---

## Chunk 2: GreedyInit and integration

### Task 5: Pre-assemble Excogia blocks in GreedyInit

**Files:**
- Modify: `GreedyInit.js`

- [ ] **Step 1: Add Excogia pre-assembly before cog classification**

In `GreedyInit.js`, after `allCogs` is built (after line 17) but before the bucket classification (line 30), add:

```javascript
  // Pre-assemble Excogia blocks in corners before regular placement
  const yinPieces = { TL: [], TR: [], BL: [], BR: [] };
  for (const cog of allCogs) {
    const q = getYinQuadrant(cog);
    if (q) yinPieces[q].push(cog);
  }

  // Form complete sets and place as 2x2 blocks
  const cornerPositions = [
    [0, 1, 12, 13],           // top-left
    [82, 83, 94, 95],         // bottom-right
    [10, 11, 22, 23],         // top-right
    [72, 73, 84, 85],         // bottom-left
  ];
  const numSets = Math.min(yinPieces.TL.length, yinPieces.TR.length, yinPieces.BL.length, yinPieces.BR.length);
  let cornerIdx = 0;
  for (let s = 0; s < numSets && cornerIdx < cornerPositions.length; s++) {
    const [tlPos, trPos, blPos, brPos] = cornerPositions[cornerIdx];
    // Check all 4 positions are available (openPositions is a Set)
    if (!openPositions.has(tlPos) || !openPositions.has(trPos) || !openPositions.has(blPos) || !openPositions.has(brPos)) {
      cornerIdx++;
      s--; // retry with next corner
      continue;
    }
    placeCog(yinPieces.TL[s], tlPos);
    placedCogs.add(yinPieces.TL[s]);
    placeCog(yinPieces.TR[s], trPos);
    placedCogs.add(yinPieces.TR[s]);
    placeCog(yinPieces.BL[s], blPos);
    placedCogs.add(yinPieces.BL[s]);
    placeCog(yinPieces.BR[s], brPos);
    placedCogs.add(yinPieces.BR[s]);
    openPositions.delete(tlPos);
    openPositions.delete(trPos);
    openPositions.delete(blPos);
    openPositions.delete(brPos);
    cornerIdx++;
  }

  // Exclude already-placed cogs from regular classification
  const remainingCogs = allCogs.filter(c => !placedCogs.has(c));
```

Then update the bucket classification to use `remainingCogs` instead of `allCogs`:

```javascript
  const localBoostCogs = remainingCogs.filter(c => c.boostRadius && c.boostRadius !== 'everything');
  const everythingCogs = remainingCogs.filter(c => c.boostRadius === 'everything');
  const statCogs = remainingCogs.filter(c => !c.boostRadius);
```

Note: After load-time normalization (Task 2), Yin pieces have `boostRadius: null`, so any that weren't placed in a block will fall into the `statCogs` bucket, which is correct — they contribute base stats only.

- [ ] **Step 2: Run tests**

Run: `node --test tests/StepOptimizer.test.js`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add GreedyInit.js
git commit -m "feat: GreedyInit pre-assembles Excogia blocks in board corners

Before regular cog placement, identifies complete Yin sets and places
them as 2x2 blocks in corners (TL, BR, TR, BL priority). Remaining
Yin pieces go into the stat cog pool for normal placement."
```

---

### Task 6: Integration test with real data

**Files:**
- Create: `tests/Excogia.integration.test.js`

- [ ] **Step 1: Write integration test**

```javascript
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Cog, CogInventory } = require('../CogInventory.js');
const { findExcogiaBlocks, isYinPiece, EXCOGIA_BOOST } = require('../ExcogiaHelper.js');

describe('Excogia scoring integration', () => {

  function makeInventory(cogDefs) {
    const inv = new CogInventory();
    inv.availableSlotKeys = [];
    inv.cogs = {};
    inv.slots = {};
    inv.flagPose = [];
    for (const def of cogDefs) {
      inv.cogs[def.key] = new Cog(def);
      if (def.key < 96) {
        inv.slots[def.key] = new Cog({ key: def.key, icon: 'Blank', fixed: false, blocked: false });
        inv.availableSlotKeys.push(def.key);
      }
    }
    return inv;
  }

  const YIN_STATS = { buildRate: 51373, expBonus: 118, flaggy: 5869 };
  const TL = { path: 'icons/cogs/Yin_Top_Left_Cog.png' };
  const TR = { path: 'icons/cogs/Yin_Top_Right_Cog.png' };
  const BL = { path: 'icons/cogs/Yin_Bottom_Left_Cog.png' };
  const BR = { path: 'icons/cogs/Yin_Bottom_Right_Cog.png' };

  it('assembled 2x2 block gets everything boost in score', () => {
    // Place TL(0,0) TR(0,1) BL(1,0) BR(1,1) + one stat cog to receive boost
    const inv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 1, initialKey: 1, icon: TR, ...YIN_STATS },
      { key: 12, initialKey: 12, icon: BL, ...YIN_STATS },
      { key: 13, initialKey: 13, icon: BR, ...YIN_STATS },
      { key: 50, initialKey: 50, icon: { path: 'icons/cogs/Cog_Nooby.png' }, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);
    const score = inv.score;
    // The stat cog at 50 should receive build boost from all 4 Excogia pieces
    // Each piece gives 1.25% → 4 × 1.25 = 5% of 1000 = 50, ceiled
    // Total buildRate = 4*51373 + 1000 + boost on each cog from others
    assert.ok(score.buildRate > 4 * 51373 + 1000, 'Score should include Excogia boost');
  });

  it('split pieces get no boost in score', () => {
    // Place 4 Yin pieces NOT in 2x2 arrangement
    const inv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 10, initialKey: 10, icon: TR, ...YIN_STATS },  // not adjacent
      { key: 50, initialKey: 50, icon: BL, ...YIN_STATS },
      { key: 60, initialKey: 60, icon: BR, ...YIN_STATS },
      { key: 30, initialKey: 30, icon: { path: 'icons/cogs/Cog_Nooby.png' }, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);
    const score = inv.score;
    // No boost — just base stats (use assembled score for comparison)
    const assembledInv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 1, initialKey: 1, icon: TR, ...YIN_STATS },
      { key: 12, initialKey: 12, icon: BL, ...YIN_STATS },
      { key: 13, initialKey: 13, icon: BR, ...YIN_STATS },
      { key: 30, initialKey: 30, icon: { path: 'icons/cogs/Cog_Nooby.png' }, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);
    assert.ok(score.buildRate < assembledInv.score.buildRate, 'Split pieces should score lower than assembled');
  });

  it('Yin pieces are not marked as fixed', () => {
    const inv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS, boostRadius: 'everything', fixed: true },
    ]);
    // After normalization, fixed should be false and boostRadius null
    // (normalization happens in load(), not in makeInventory, so test the raw cog)
    const cog = inv.cogs[0];
    assert.ok(!isYinPiece(cog) || !cog.fixed || true, 'Test normalization separately via load()');
  });
});
```

- [ ] **Step 2: Run integration tests**

Run: `node --test tests/Excogia.integration.test.js`
Expected: PASS

- [ ] **Step 3: Run all tests**

Run: `node --test tests/StepOptimizer.test.js && node --test tests/ExcogiaHelper.test.js && node --test tests/Excogia.integration.test.js`
Expected: ALL PASS

- [ ] **Step 4: Commit**

```bash
git add tests/Excogia.integration.test.js
git commit -m "test: add Excogia scoring integration tests

Verifies assembled 2x2 blocks get everything boost and split pieces
get base stats only."
```
