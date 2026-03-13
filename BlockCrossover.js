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

if (typeof require !== 'undefined') {
  var _mod = require('./CogInventory.js');
  var CogInventory = _mod.CogInventory;
  var Cog = _mod.Cog;
}

var INV_COLUMNS = 12;

/**
 * @param {CogInventory} parentA
 * @param {CogInventory} parentB
 * @param {{ rowStart: number, colStart: number, rows: number, cols: number }} blockRect
 * @param {SeededRng} rng  - used only in repair step tie-breaking
 * @returns {CogInventory}
 */
function blockCrossover(parentA, parentB, blockRect, rng) {
  // ── Step 1: Clone parentA as base (preserves all metadata: flagPose, etc.) ──
  var child = parentA.clone();

  // Clear all non-fixed cogs from child (we will re-fill them)
  var childKeys = Object.keys(child.cogs).map(Number);
  for (var ki = 0; ki < childKeys.length; ki++) {
    var key = childKeys[ki];
    var cog = child.cogs[key];
    if (!cog.fixed) {
      delete child.cogs[key];
    }
  }

  // ── Step 2: Collect block positions (available, non-fixed) ────────────────
  var blockPositionSet = new Set();
  for (var r = blockRect.rowStart; r < blockRect.rowStart + blockRect.rows; r++) {
    for (var c = blockRect.colStart; c < blockRect.colStart + blockRect.cols; c++) {
      var bkey = r * INV_COLUMNS + c;
      if (parentA.availableSlotKeys.includes(bkey)) {
        blockPositionSet.add(bkey);
      }
    }
  }

  // ── Step 3: Inherit block positions from parentA ──────────────────────────
  var placedInitialKeys = new Set();

  // Fixed cogs are already in child.cogs — mark them as placed
  var fixedCogs = Object.values(child.cogs);
  for (var fi = 0; fi < fixedCogs.length; fi++) {
    if (fixedCogs[fi].fixed) placedInitialKeys.add(fixedCogs[fi].initialKey);
  }

  var blockPosIter = blockPositionSet.values();
  var bpResult = blockPosIter.next();
  while (!bpResult.done) {
    var pos = bpResult.value;
    var cogA = parentA.cogs[pos];
    if (!cogA || cogA.fixed) { bpResult = blockPosIter.next(); continue; }
    if (placedInitialKeys.has(cogA.initialKey)) { bpResult = blockPosIter.next(); continue; }
    var cloned = new Cog({ ...cogA, key: pos });
    cloned._position = null;
    child.cogs[pos] = cloned;
    placedInitialKeys.add(cogA.initialKey);
    bpResult = blockPosIter.next();
  }

  // ── Step 4: Fill remaining available positions from parentB ──────────────
  var remainingPositions = parentA.availableSlotKeys.filter(
    function(pos) { return !blockPositionSet.has(pos) && !child.cogs[pos]; }
  );

  for (var ri = 0; ri < remainingPositions.length; ri++) {
    var rpos = remainingPositions[ri];
    var cogB = parentB.cogs[rpos];
    if (!cogB || cogB.fixed) continue;
    if (placedInitialKeys.has(cogB.initialKey)) continue;
    var clonedB = new Cog({ ...cogB, key: rpos });
    clonedB._position = null;
    child.cogs[rpos] = clonedB;
    placedInitialKeys.add(cogB.initialKey);
  }

  // ── Step 5: Repair — fill still-empty positions from leftover pool ────────
  // Leftover pool: any cog from parentA that hasn't been placed yet
  var leftoverPool = Object.values(parentA.cogs)
    .filter(function(cog) { return !cog.fixed && !placedInitialKeys.has(cog.initialKey); });

  // Also add leftover cogs from parentB that aren't already covered
  // Track which initialKeys are already in the pool to avoid duplicates
  var poolInitialKeys = new Set(leftoverPool.map(function(c) { return c.initialKey; }));
  var parentBCogs = Object.values(parentB.cogs);
  for (var li = 0; li < parentBCogs.length; li++) {
    var lCog = parentBCogs[li];
    if (!lCog.fixed && !placedInitialKeys.has(lCog.initialKey) && !poolInitialKeys.has(lCog.initialKey)) {
      leftoverPool.push(lCog);
      poolInitialKeys.add(lCog.initialKey);
    }
  }

  // Sort pool descending by buildRate as a simple heuristic (stable, deterministic)
  leftoverPool.sort(function(a, b) { return (b.buildRate || 0) - (a.buildRate || 0); });

  var stillEmpty = parentA.availableSlotKeys.filter(function(pos) { return !child.cogs[pos]; });
  var poolIndex = 0;
  for (var si = 0; si < stillEmpty.length; si++) {
    if (poolIndex >= leftoverPool.length) break;
    var donor = leftoverPool[poolIndex++];
    var clonedD = new Cog({ ...donor, key: stillEmpty[si] });
    clonedD._position = null;
    child.cogs[stillEmpty[si]] = clonedD;
    placedInitialKeys.add(donor.initialKey);
  }

  // ── Step 6: Invalidate score cache ───────────────────────────────────────
  child._score = null;

  return child;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { blockCrossover };
}
