// Serializer.js
const { Cog, CogInventory } = typeof require !== 'undefined'
  ? require('./CogInventory.js')
  : { Cog, CogInventory };

const COG_FIELDS = [
  'key', 'initialKey', 'icon', 'buildRate', 'isPlayer', 'isFlag', 'expGain',
  'flaggy', 'expBonus', 'buildRadiusBoost', 'expRadiusBoost', 'flaggyRadiusBoost',
  'boostRadius', 'flagBoost', 'nothing', 'fixed', 'blocked'
];

function serializeCog(cog) {
  const obj = {};
  for (const f of COG_FIELDS) {
    if (cog[f] !== undefined && cog[f] !== null && cog[f] !== 0 && cog[f] !== false) {
      obj[f] = cog[f];
    }
  }
  obj.key = cog.key;
  if (cog.initialKey !== undefined) obj.initialKey = cog.initialKey;
  return obj;
}

function serialize(inventory) {
  const data = {
    cogs: {},
    slots: {},
    flagPose: inventory.flagPose,
    flaggyShopUpgrades: inventory.flaggyShopUpgrades,
    playerCount: inventory.playerCount,
    spareSlotCount: inventory.spareSlotCount,
    availableSlotKeys: inventory.availableSlotKeys,
    lockedSlotsRemaining: inventory.lockedSlotsRemaining || 0,
    tinyMultipliers: inventory.tinyMultipliers || { buildRate: 1, expBonus: 1, flaggy: 1 },
  };
  for (const [k, v] of Object.entries(inventory.cogs)) {
    data.cogs[k] = serializeCog(v);
  }
  for (const [k, v] of Object.entries(inventory.slots)) {
    data.slots[k] = serializeCog(v);
  }
  return JSON.stringify(data);
}

function deserialize(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json;
  const cogs = {};
  for (const [k, v] of Object.entries(data.cogs)) {
    cogs[k] = new Cog(v);
  }
  const slots = {};
  for (const [k, v] of Object.entries(data.slots)) {
    slots[k] = new Cog(v);
  }
  const inv = new CogInventory(cogs, slots);
  inv.flagPose = data.flagPose || [];
  inv.flaggyShopUpgrades = data.flaggyShopUpgrades || 0;
  inv.playerCount = data.playerCount || 10;
  inv.spareSlotCount = data.spareSlotCount || 96;
  inv.availableSlotKeys = data.availableSlotKeys || [];
  inv.lockedSlotsRemaining = data.lockedSlotsRemaining || 0;
  inv.tinyMultipliers = data.tinyMultipliers || { buildRate: 1, expBonus: 1, flaggy: 1 };
  return inv;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { serialize, deserialize };
}
