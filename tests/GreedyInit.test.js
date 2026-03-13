const { describe, it } = require('node:test');
const assert = require('node:assert');
const { greedyInit } = require('../GreedyInit.js');
const { makeCog, buildInventory } = require('./helpers.js');
const { SeededRng } = require('../SeededRng.js');

describe('greedyInit', () => {
  it('returns a valid board state', () => {
    const cogs = [];
    for (let i = 0; i < 30; i++) {
      cogs.push(makeCog(i, { buildRate: 100 + i * 10 }));
    }
    const inv = buildInventory(cogs);
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const result = greedyInit(inv, weights);

    const keys = Object.keys(result.cogs);
    const keySet = new Set(keys);
    assert.strictEqual(keys.length, keySet.size, 'duplicate cog keys');
  });

  it('produces higher score than random shuffle', () => {
    const rng = new SeededRng(42);
    const cogs = [];
    for (let i = 0; i < 40; i++) {
      cogs.push(makeCog(i, { buildRate: rng.randInt(500) + 50 }));
    }
    cogs.push(makeCog(50, { boostRadius: 'adjacent', buildRadiusBoost: 30 }));
    cogs.push(makeCog(51, { boostRadius: 'diagonal', buildRadiusBoost: 20 }));
    for (let i = 0; i < 20; i++) {
      cogs.push(makeCog(110 + i, { buildRate: rng.randInt(300) }));
    }

    const inv = buildInventory(cogs);
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const greedyResult = greedyInit(inv, weights);
    const greedyScore = greedyResult.score.buildRate;

    let shuffleBetter = 0;
    for (let trial = 0; trial < 50; trial++) {
      const clone = inv.clone();
      const allSlots = clone.availableSlotKeys;
      for (let s = 0; s < 200; s++) {
        const a = allSlots[rng.randInt(allSlots.length)];
        const allKeys = clone.cogKeys;
        const b = allKeys[rng.randInt(allKeys.length)];
        const cogA = clone.get(a);
        const cogB = clone.get(b);
        if (cogA && cogA.fixed) continue;
        if (cogB && cogB.fixed) continue;
        clone.move(a, b);
      }
      if (clone.score.buildRate > greedyScore) shuffleBetter++;
    }
    assert.ok(shuffleBetter < 10, `Greedy lost to ${shuffleBetter}/50 shuffles`);
  });

  it('places boost cogs on the board', () => {
    const cogs = [
      makeCog(0, { buildRate: 100 }),
      makeCog(110, { boostRadius: 'adjacent', buildRadiusBoost: 50 }),
    ];
    const inv = buildInventory(cogs);
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const result = greedyInit(inv, weights);

    const boostCog = Object.values(result.cogs).find(c => c.boostRadius === 'adjacent');
    assert.ok(boostCog, 'boost cog should exist');
    assert.ok(boostCog.key < 96, 'boost cog should be on the board');
  });

  it('does not move fixed cogs', () => {
    const cogs = [
      makeCog(0, { fixed: true, boostRadius: 'everything', buildRadiusBoost: 10 }),
      makeCog(1, { buildRate: 100 }),
    ];
    const inv = buildInventory(cogs);
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const result = greedyInit(inv, weights);

    assert.strictEqual(result.get(0).key, 0, 'fixed cog should not move');
    assert.strictEqual(result.get(0).boostRadius, 'everything');
  });

  it('respects blocked positions', () => {
    const cogs = [
      makeCog(0, { buildRate: 100 }),
      makeCog(1, { buildRate: 200 }),
    ];
    const inv = buildInventory(cogs, { blockedKeys: [5] });
    const weights = { buildRate: 1, expBonus: 0, flaggy: 0 };
    const result = greedyInit(inv, weights);

    assert.ok(!result.cogs[5] || result.get(5).blocked, 'blocked position should be empty');
  });
});
