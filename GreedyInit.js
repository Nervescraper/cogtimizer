// GreedyInit.js
if (typeof require !== 'undefined') {
  var { getBoostPositions, INV_ROWS, INV_COLUMNS } = require('./BoostPositions.js');
}
var SPARE_START = 108;

function greedyInit(inventory, weights, targets = null) {
  const inv = inventory.clone();
  const availableSlots = [...inv.availableSlotKeys];

  // Collect all movable cogs (board + spare), excluding fixed and build-area
  const allCogs = Object.values(inv.cogs).filter(c => {
    if (c.fixed) return false;
    const pos = c.position();
    if (pos.location === 'build') return false;
    return true;
  });

  // Remove all movable cogs to avoid displacement during placement
  for (const cog of allCogs) {
    delete inv.cogs[cog.key];
  }

  function placeCog(cog, pos) {
    cog.key = pos;
    cog._position = null;
    inv.cogs[pos] = cog;
  }

  // Classify cogs
  const localBoostCogs = allCogs.filter(c => c.boostRadius && c.boostRadius !== 'everything');
  const everythingCogs = allCogs.filter(c => c.boostRadius === 'everything');
  const statCogs = allCogs.filter(c => !c.boostRadius);

  function rawScore(cog) {
    let s = 0;
    s += (cog.buildRate || 0) * (weights.buildRate || 0);
    s += (cog.expBonus || 0) * (weights.expBonus || 0);
    s += (cog.flaggy || 0) * (weights.flaggy || 0);
    return s;
  }

  function boostScore(cog) {
    const coverage = getBoostPositions(cog.boostRadius, 4, 6)
      .filter(([r, c]) => r >= 0 && r < INV_ROWS && c >= 0 && c < INV_COLUMNS).length;
    const magnitude = (cog.buildRadiusBoost || 0) * (weights.buildRate || 0)
      + (cog.flaggyRadiusBoost || 0) * (weights.flaggy || 0)
      + (cog.expRadiusBoost || 0) * (weights.expBonus || 0)
      + (cog.flagBoost || 0) * (weights.flaggy || 0);
    return magnitude * coverage + rawScore(cog);
  }

  localBoostCogs.sort((a, b) => boostScore(b) - boostScore(a));
  statCogs.sort((a, b) => rawScore(b) - rawScore(a));

  const openPositions = new Set(availableSlots.filter(k => {
    const cog = inv.get(k);
    return !cog || !cog.fixed;
  }));
  const placedCogs = new Set();

  // Step 1: Place local boost cogs at positions with max on-board coverage
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

  for (const evCog of everythingCogs) {
    if (openPositions.size === 0) break;
    if (evCog.fixed) continue;

    const evScore = rawScore(evCog);
    let bestPos = -1;
    let bestDiff = Infinity;

    const topStatCog = statCogs.find(c => !placedCogs.has(c));
    const topStatScore = topStatCog ? rawScore(topStatCog) : 0;

    for (const pos of openPositions) {
      const row = Math.floor(pos / INV_COLUMNS);
      const col = pos % INV_COLUMNS;
      const bonus = bonusGrid[row][col];

      const evAtPos = evScore + Math.ceil((evCog.buildRate || 0) * (bonus.buildRate || 0) / 100)
        + Math.ceil((evCog.flaggy || 0) * (bonus.flaggy || 0) / 100);

      const statAtPos = topStatCog
        ? topStatScore + Math.ceil((topStatCog.buildRate || 0) * (bonus.buildRate || 0) / 100)
          + Math.ceil((topStatCog.flaggy || 0) * (bonus.flaggy || 0) / 100)
        : 0;

      const diff = statAtPos - evAtPos;
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

  // Step 3: Place stat cogs - highest raw score cogs to highest bonus positions
  const openPosArray = [...openPositions].sort((a, b) => {
    const rowA = Math.floor(a / INV_COLUMNS), colA = a % INV_COLUMNS;
    const rowB = Math.floor(b / INV_COLUMNS), colB = b % INV_COLUMNS;
    const bonusA = (bonusGrid[rowA][colA].buildRate || 0) * (weights.buildRate || 0)
      + (bonusGrid[rowA][colA].flaggy || 0) * (weights.flaggy || 0);
    const bonusB = (bonusGrid[rowB][colB].buildRate || 0) * (weights.buildRate || 0)
      + (bonusGrid[rowB][colB].flaggy || 0) * (weights.flaggy || 0);
    return bonusB - bonusA;
  });

  const remainingStats = statCogs.filter(c => !placedCogs.has(c));

  for (let i = 0; i < openPosArray.length && i < remainingStats.length; i++) {
    const pos = openPosArray[i];
    const cog = remainingStats[i];
    placeCog(cog, pos);
    placedCogs.add(cog);
  }

  // Remaining unplaced cogs go to spare positions
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
