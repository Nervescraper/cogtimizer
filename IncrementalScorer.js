if (typeof require !== 'undefined') {
  var { getBoostPositions, INV_ROWS, INV_COLUMNS } = require('./BoostPositions.js');
}

// Match CogInventory.score floating-point behavior: divide first, then multiply, then ceil
function ceilBonus(base, bonusPct) {
  return Math.ceil(base * (bonusPct / 100));
}

class IncrementalScorer {
  constructor(inventory) {
    this._inv = inventory;
    this._initFromScratch();
  }

  get inventory() { return this._inv; }

  _initFromScratch() {
    const inv = this._inv;
    this._availableSet = new Set(inv.availableSlotKeys);
    this._flagPoseSet = new Set(inv.flagPose);

    // Bonus grid: 8x12, four fields per cell
    this._bonusGrid = Array.from({ length: INV_ROWS }, () =>
      Array.from({ length: INV_COLUMNS }, () => ({
        buildRate: 0, flaggy: 0, expBoost: 0, flagBoost: 0
      }))
    );

    // Per-position contribution cache
    this._contrib = {};

    // Running totals (pre-flaggy-multiplier)
    this._totals = { buildRate: 0, expBonus: 0, flaggy: 0, expBoost: 0, flagBoost: 0 };

    // Step 1: Build bonus grid from boost cogs
    for (const key of inv.availableSlotKeys) {
      const cog = inv.get(key);
      if (!cog || !cog.boostRadius) continue;
      const pos = cog.position();
      const affected = getBoostPositions(cog.boostRadius, pos.y, pos.x);
      for (const [r, c] of affected) {
        if (r < 0 || r >= INV_ROWS || c < 0 || c >= INV_COLUMNS) continue;
        const cell = this._bonusGrid[r][c];
        cell.buildRate += cog.buildRadiusBoost || 0;
        cell.flaggy += cog.flaggyRadiusBoost || 0;
        cell.expBoost += cog.expRadiusBoost || 0;
        cell.flagBoost += cog.flagBoost || 0;
      }
    }

    // Step 2: Accumulate base stats and bonus-modified stats
    for (const key of inv.availableSlotKeys) {
      const cog = inv.get(key);
      if (!cog) continue;
      const pos = cog.position();
      const bonus = this._bonusGrid[pos.y][pos.x];

      const baseBR = cog.buildRate || 0;
      const baseXP = cog.expBonus || 0;
      const baseFl = cog.flaggy || 0;
      const ceilBR = ceilBonus(baseBR, bonus.buildRate);
      const ceilFl = ceilBonus(baseFl, bonus.flaggy);

      const contribEntry = { baseBR, baseXP, baseFl, ceilBR, ceilFl };

      if (cog.isPlayer) {
        contribEntry.expBoost = bonus.expBoost || 0;
      }
      if (this._flagPoseSet.has(Number(key))) {
        contribEntry.flagBoostContrib = bonus.flagBoost || 0;
      }
      this._contrib[key] = contribEntry;

      this._totals.buildRate += baseBR + ceilBR;
      this._totals.expBonus += baseXP;
      this._totals.flaggy += baseFl + ceilFl;

      if (cog.isPlayer) {
        this._totals.expBoost += bonus.expBoost || 0;
      }
      if (this._flagPoseSet.has(Number(key))) {
        this._totals.flagBoost += bonus.flagBoost || 0;
      }
    }

    // Step 3: Flag position flagBoost (flag positions NOT in availableSlotKeys)
    for (const key of inv.flagPose) {
      if (this._availableSet.has(key)) continue; // handled in Step 2
      const cog = inv.get(key);
      if (!cog) continue;
      const pos = cog.position();
      if (pos.y < 0 || pos.y >= INV_ROWS || pos.x < 0 || pos.x >= INV_COLUMNS) continue;
      const bonus = this._bonusGrid[pos.y][pos.x];
      this._totals.flagBoost += bonus.flagBoost || 0;
    }
  }

  get score() {
    const flaggyMult = 1 + (this._inv.flaggyShopUpgrades || 0) * 0.5;
    return {
      buildRate: this._totals.buildRate,
      expBonus: this._totals.expBonus,
      flaggy: Math.floor(this._totals.flaggy * flaggyMult),
      expBoost: this._totals.expBoost,
      flagBoost: this._totals.flagBoost
    };
  }

  fullRecompute() {
    this._inv._score = null;
    return this._inv.score;
  }

  swap(posA, posB) {
    if (posA === posB) return;
    this._withdraw(posA);
    this._withdraw(posB);
    this._inv.move(posA, posB);
    this._deposit(posA);
    this._deposit(posB);
  }

  _withdraw(pos) {
    const cog = this._inv.get(pos);
    if (!cog) return;

    // Remove base stat contributions
    const contrib = this._contrib[pos];
    if (contrib) {
      this._totals.buildRate -= contrib.baseBR + contrib.ceilBR;
      this._totals.expBonus -= contrib.baseXP;
      this._totals.flaggy -= contrib.baseFl + contrib.ceilFl;

      if (cog.isPlayer && contrib.expBoost !== undefined) {
        this._totals.expBoost -= contrib.expBoost;
      }

      if (this._flagPoseSet.has(pos) && contrib.flagBoostContrib !== undefined) {
        this._totals.flagBoost -= contrib.flagBoostContrib;
      }

      delete this._contrib[pos];
    } else if (this._flagPoseSet.has(pos)) {
      // Flag position not in availableSlotKeys — handle flagBoost withdrawal
      const p = cog.position();
      if (p.y >= 0 && p.y < INV_ROWS && p.x >= 0 && p.x < INV_COLUMNS) {
        this._totals.flagBoost -= this._bonusGrid[p.y][p.x].flagBoost || 0;
      }
    }

    // Boost cog: remove radius contributions from bonus grid
    if (cog.boostRadius) {
      this._withdrawBoost(cog);
    }
  }

  _deposit(pos) {
    const cog = this._inv.get(pos);
    if (!cog) return;

    // Boost cog: add radius contributions to bonus grid FIRST (before computing contrib)
    if (cog.boostRadius) {
      this._depositBoost(cog);
    }

    const p = cog.position();
    const onBoard = p.y >= 0 && p.y < INV_ROWS && p.x >= 0 && p.x < INV_COLUMNS;

    if (onBoard && this._availableSet.has(pos)) {
      const bonus = this._bonusGrid[p.y][p.x];
      const baseBR = cog.buildRate || 0;
      const baseXP = cog.expBonus || 0;
      const baseFl = cog.flaggy || 0;
      const ceilBR = ceilBonus(baseBR, bonus.buildRate);
      const ceilFl = ceilBonus(baseFl, bonus.flaggy);

      const contribEntry = { baseBR, baseXP, baseFl, ceilBR, ceilFl };

      this._totals.buildRate += baseBR + ceilBR;
      this._totals.expBonus += baseXP;
      this._totals.flaggy += baseFl + ceilFl;

      if (cog.isPlayer) {
        contribEntry.expBoost = bonus.expBoost || 0;
        this._totals.expBoost += contribEntry.expBoost;
      }

      if (this._flagPoseSet.has(pos)) {
        contribEntry.flagBoostContrib = bonus.flagBoost || 0;
        this._totals.flagBoost += contribEntry.flagBoostContrib;
      }

      this._contrib[pos] = contribEntry;
    } else if (this._flagPoseSet.has(pos) && onBoard) {
      // Flag position not in availableSlotKeys but still needs flagBoost tracking
      const bonus = this._bonusGrid[p.y][p.x];
      this._totals.flagBoost += bonus.flagBoost || 0;
    }
  }

  _withdrawBoost(cog) {
    const p = cog.position();
    const affected = getBoostPositions(cog.boostRadius, p.y, p.x);

    for (const [r, c] of affected) {
      if (r < 0 || r >= INV_ROWS || c < 0 || c >= INV_COLUMNS) continue;
      const cell = this._bonusGrid[r][c];

      cell.buildRate -= cog.buildRadiusBoost || 0;
      cell.flaggy -= cog.flaggyRadiusBoost || 0;
      cell.expBoost -= cog.expRadiusBoost || 0;
      cell.flagBoost -= cog.flagBoost || 0;

      const affectedKey = r * INV_COLUMNS + c;
      this._updateContribAt(affectedKey);

      // Flag positions NOT in availableSlotKeys need separate flagBoost handling
      if (this._flagPoseSet.has(affectedKey) && !this._availableSet.has(affectedKey)) {
        this._totals.flagBoost -= cog.flagBoost || 0;
      }
    }
  }

  _depositBoost(cog) {
    const p = cog.position();
    const affected = getBoostPositions(cog.boostRadius, p.y, p.x);

    for (const [r, c] of affected) {
      if (r < 0 || r >= INV_ROWS || c < 0 || c >= INV_COLUMNS) continue;
      const cell = this._bonusGrid[r][c];

      cell.buildRate += cog.buildRadiusBoost || 0;
      cell.flaggy += cog.flaggyRadiusBoost || 0;
      cell.expBoost += cog.expRadiusBoost || 0;
      cell.flagBoost += cog.flagBoost || 0;

      const affectedKey = r * INV_COLUMNS + c;
      this._updateContribAt(affectedKey);

      if (this._flagPoseSet.has(affectedKey) && !this._availableSet.has(affectedKey)) {
        this._totals.flagBoost += cog.flagBoost || 0;
      }
    }
  }

  _updateContribAt(key) {
    if (!this._availableSet.has(key)) return;
    const cog = this._inv.get(key);
    if (!cog) return;

    const oldContrib = this._contrib[key];
    if (!oldContrib) return;

    const p = cog.position();
    const bonus = this._bonusGrid[p.y][p.x];

    // Update ceiled buildRate
    const newCeilBR = ceilBonus(cog.buildRate || 0, bonus.buildRate);
    this._totals.buildRate += newCeilBR - oldContrib.ceilBR;
    oldContrib.ceilBR = newCeilBR;

    // Update ceiled flaggy
    const newCeilFl = ceilBonus(cog.flaggy || 0, bonus.flaggy);
    this._totals.flaggy += newCeilFl - oldContrib.ceilFl;
    oldContrib.ceilFl = newCeilFl;

    // Player cog expBoost
    if (cog.isPlayer) {
      const oldExpBoost = oldContrib.expBoost || 0;
      const newExpBoost = bonus.expBoost || 0;
      this._totals.expBoost += newExpBoost - oldExpBoost;
      oldContrib.expBoost = newExpBoost;
    }

    // Flag position flagBoost (for positions that ARE in availableSlotKeys)
    if (this._flagPoseSet.has(key)) {
      const oldFlagBoost = oldContrib.flagBoostContrib || 0;
      const newFlagBoost = bonus.flagBoost || 0;
      this._totals.flagBoost += newFlagBoost - oldFlagBoost;
      oldContrib.flagBoostContrib = newFlagBoost;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { IncrementalScorer };
}
