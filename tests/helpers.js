const { Cog, CogInventory } = require('../CogInventory.js');

function makeCog(key, opts = {}) {
  return new Cog({
    key,
    initialKey: opts.initialKey !== undefined ? opts.initialKey : key,
    icon: opts.icon || { path: 'icons/cogs/Cog_Nooby.png' },
    buildRate: opts.buildRate || 0,
    expBonus: opts.expBonus || 0,
    flaggy: opts.flaggy || 0,
    isPlayer: opts.isPlayer || false,
    isFlag: opts.isFlag || false,
    boostRadius: opts.boostRadius || undefined,
    buildRadiusBoost: opts.buildRadiusBoost || 0,
    expRadiusBoost: opts.expRadiusBoost || 0,
    flaggyRadiusBoost: opts.flaggyRadiusBoost || 0,
    flagBoost: opts.flagBoost || 0,
    fixed: opts.fixed || false,
    blocked: opts.blocked || false,
    ...opts
  });
}

function buildInventory(cogs, opts = {}) {
  const cogDict = {};
  for (const cog of cogs) {
    cogDict[cog.key] = cog;
  }
  const slots = {};
  const blockedKeys = new Set(opts.blockedKeys || []);
  for (let i = 0; i < 96; i++) {
    const isBlocked = blockedKeys.has(i);
    slots[i] = new Cog({
      key: i,
      icon: 'Blank',
      fixed: isBlocked,
      blocked: isBlocked
    });
  }
  const inv = new CogInventory(cogDict, slots);
  inv.flagPose = opts.flagPose || [];
  inv.flaggyShopUpgrades = opts.flaggyShopUpgrades || 0;
  inv.playerCount = opts.playerCount || 10;
  inv.spareSlotCount = opts.spareSlotCount || 96;
  inv.availableSlotKeys = opts.availableSlotKeys ||
    Object.values(slots)
      .filter(s => !s.fixed && s.key < 96)
      .map(s => s.key);
  return inv;
}

function assertScoresEqual(actual, expected, message = '') {
  const assert = require('node:assert');
  const prefix = message ? message + ': ' : '';
  assert.strictEqual(actual.buildRate, expected.buildRate, `${prefix}buildRate mismatch`);
  assert.strictEqual(actual.expBonus, expected.expBonus, `${prefix}expBonus mismatch`);
  assert.strictEqual(actual.flaggy, expected.flaggy, `${prefix}flaggy mismatch`);
  assert.strictEqual(actual.expBoost, expected.expBoost, `${prefix}expBoost mismatch`);
  assert.strictEqual(actual.flagBoost, expected.flagBoost, `${prefix}flagBoost mismatch`);
}

module.exports = { makeCog, buildInventory, assertScoresEqual };
