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
    inv.flaggyShopUpgrades = 0;
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
  const REGULAR = { path: 'icons/cogs/Cog_Nooby.png' };

  it('assembled 2x2 block gets everything boost in score', () => {
    // Place TL(0,0) TR(0,1) BL(1,0) BR(1,1) + one stat cog to receive boost
    const inv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 1, initialKey: 1, icon: TR, ...YIN_STATS },
      { key: 12, initialKey: 12, icon: BL, ...YIN_STATS },
      { key: 13, initialKey: 13, icon: BR, ...YIN_STATS },
      { key: 50, initialKey: 50, icon: REGULAR, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);
    const score = inv.score;
    // The stat cog at 50 should receive build boost from all 4 Excogia pieces
    // Total buildRate should be more than just base stats
    assert.ok(score.buildRate > 4 * YIN_STATS.buildRate + 1000,
      'Assembled Excogia should boost other cogs');
  });

  it('split pieces get no boost — score is lower than assembled', () => {
    // Place 4 Yin pieces NOT in 2x2 arrangement
    const splitInv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 10, initialKey: 10, icon: TR, ...YIN_STATS },  // not adjacent
      { key: 50, initialKey: 50, icon: BL, ...YIN_STATS },
      { key: 60, initialKey: 60, icon: BR, ...YIN_STATS },
      { key: 30, initialKey: 30, icon: REGULAR, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);

    // Same pieces in valid 2x2
    const assembledInv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 1, initialKey: 1, icon: TR, ...YIN_STATS },
      { key: 12, initialKey: 12, icon: BL, ...YIN_STATS },
      { key: 13, initialKey: 13, icon: BR, ...YIN_STATS },
      { key: 30, initialKey: 30, icon: REGULAR, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);

    assert.ok(splitInv.score.buildRate < assembledInv.score.buildRate,
      'Split pieces should score lower than assembled');
  });

  it('two assembled blocks both get boost', () => {
    const inv = makeInventory([
      // Block 1 at top-left
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 1, initialKey: 1, icon: TR, ...YIN_STATS },
      { key: 12, initialKey: 12, icon: BL, ...YIN_STATS },
      { key: 13, initialKey: 13, icon: BR, ...YIN_STATS },
      // Block 2 at bottom-right
      { key: 82, initialKey: 82, icon: TL, ...YIN_STATS },
      { key: 83, initialKey: 83, icon: TR, ...YIN_STATS },
      { key: 94, initialKey: 94, icon: BL, ...YIN_STATS },
      { key: 95, initialKey: 95, icon: BR, ...YIN_STATS },
      // Regular cog to receive boosts
      { key: 50, initialKey: 50, icon: REGULAR, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);

    // One block only
    const oneBlockInv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 1, initialKey: 1, icon: TR, ...YIN_STATS },
      { key: 12, initialKey: 12, icon: BL, ...YIN_STATS },
      { key: 13, initialKey: 13, icon: BR, ...YIN_STATS },
      { key: 50, initialKey: 50, icon: REGULAR, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);

    // Two blocks should boost more than one
    assert.ok(inv.score.buildRate > oneBlockInv.score.buildRate,
      'Two assembled blocks should provide more boost than one');
  });

  it('wrong quadrant arrangement does not get boost', () => {
    // TL and TR swapped — invalid 2x2
    const inv = makeInventory([
      { key: 0, initialKey: 0, icon: TR, ...YIN_STATS },  // wrong: TR at TL position
      { key: 1, initialKey: 1, icon: TL, ...YIN_STATS },  // wrong: TL at TR position
      { key: 12, initialKey: 12, icon: BL, ...YIN_STATS },
      { key: 13, initialKey: 13, icon: BR, ...YIN_STATS },
      { key: 50, initialKey: 50, icon: REGULAR, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);

    // Correct arrangement
    const correctInv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 1, initialKey: 1, icon: TR, ...YIN_STATS },
      { key: 12, initialKey: 12, icon: BL, ...YIN_STATS },
      { key: 13, initialKey: 13, icon: BR, ...YIN_STATS },
      { key: 50, initialKey: 50, icon: REGULAR, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);

    assert.ok(inv.score.buildRate < correctInv.score.buildRate,
      'Wrong quadrant arrangement should not get everything boost');
  });

  it('regular boost cogs still work normally alongside Excogia', () => {
    // Yang cog with "around" boost + assembled Excogia
    const inv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 1, initialKey: 1, icon: TR, ...YIN_STATS },
      { key: 12, initialKey: 12, icon: BL, ...YIN_STATS },
      { key: 13, initialKey: 13, icon: BR, ...YIN_STATS },
      { key: 50, initialKey: 50, icon: { path: 'icons/cogs/Yang_Cog.png' }, buildRate: 0, expBonus: 0, flaggy: 0, boostRadius: 'around', buildRadiusBoost: 165, expRadiusBoost: 204 },
      { key: 51, initialKey: 51, icon: REGULAR, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);

    // Without the Yang cog
    const noYangInv = makeInventory([
      { key: 0, initialKey: 0, icon: TL, ...YIN_STATS },
      { key: 1, initialKey: 1, icon: TR, ...YIN_STATS },
      { key: 12, initialKey: 12, icon: BL, ...YIN_STATS },
      { key: 13, initialKey: 13, icon: BR, ...YIN_STATS },
      { key: 51, initialKey: 51, icon: REGULAR, buildRate: 1000, expBonus: 0, flaggy: 0 },
    ]);

    assert.ok(inv.score.buildRate > noYangInv.score.buildRate,
      'Yang around boost should still contribute alongside Excogia');
  });
});
