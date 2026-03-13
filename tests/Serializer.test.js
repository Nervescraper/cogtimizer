const { describe, it } = require('node:test');
const assert = require('node:assert');
const { serialize, deserialize } = require('../Serializer.js');
const { makeCog, buildInventory, assertScoresEqual } = require('./helpers.js');

describe('Serializer', () => {
  it('round-trips a simple inventory', () => {
    const inv = buildInventory([
      makeCog(0, { buildRate: 100 }),
      makeCog(1, { expBonus: 50 }),
    ]);
    const json = serialize(inv);
    const restored = deserialize(json);
    assertScoresEqual(restored.score, inv.score);
  });

  it('round-trips boost cogs with all properties', () => {
    const inv = buildInventory([
      makeCog(0, {
        boostRadius: 'adjacent',
        buildRadiusBoost: 50,
        expRadiusBoost: 10,
        flaggyRadiusBoost: 20,
        flagBoost: 5,
        buildRate: 30,
      }),
      makeCog(1, { buildRate: 200 }),
    ]);
    const json = serialize(inv);
    const restored = deserialize(json);
    assertScoresEqual(restored.score, inv.score);
    assert.strictEqual(restored.get(0).boostRadius, 'adjacent');
    assert.strictEqual(restored.get(0).buildRadiusBoost, 50);
  });

  it('preserves player cog properties', () => {
    const inv = buildInventory([
      makeCog(0, { isPlayer: true, expBonus: 100 }),
    ]);
    const json = serialize(inv);
    const restored = deserialize(json);
    assert.strictEqual(restored.get(0).isPlayer, true);
  });

  it('preserves fixed/blocked properties', () => {
    const inv = buildInventory([
      makeCog(0, { fixed: true, boostRadius: 'everything' }),
    ]);
    const json = serialize(inv);
    const restored = deserialize(json);
    assert.strictEqual(restored.get(0).fixed, true);
  });

  it('preserves inventory metadata', () => {
    const inv = buildInventory(
      [makeCog(0, { buildRate: 100 })],
      { flagPose: [1, 5], flaggyShopUpgrades: 3, playerCount: 8 }
    );
    const json = serialize(inv);
    const restored = deserialize(json);
    assert.deepStrictEqual(restored.flagPose, [1, 5]);
    assert.strictEqual(restored.flaggyShopUpgrades, 3);
    assert.strictEqual(restored.playerCount, 8);
  });

  it('preserves availableSlotKeys', () => {
    const inv = buildInventory(
      [makeCog(0, { buildRate: 100 })],
      { blockedKeys: [5, 10] }
    );
    const json = serialize(inv);
    const restored = deserialize(json);
    assert.ok(!restored.availableSlotKeys.includes(5));
    assert.ok(!restored.availableSlotKeys.includes(10));
    assert.ok(restored.availableSlotKeys.includes(0));
  });

  it('serialized form is valid JSON string', () => {
    const inv = buildInventory([makeCog(0, { buildRate: 100 })]);
    const json = serialize(inv);
    assert.doesNotThrow(() => JSON.parse(json));
  });

  it('preserves initialKey (for step tracking)', () => {
    const inv = buildInventory([
      makeCog(5, { initialKey: 0, buildRate: 100 }),
    ]);
    const json = serialize(inv);
    const restored = deserialize(json);
    assert.strictEqual(restored.get(5).initialKey, 0);
  });
});
