// tests/BlockCrossover.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { CogInventory, Cog } = require('../CogInventory.js');
const { makeCog, buildInventory } = require('./helpers.js');
const { SeededRng } = require('../SeededRng.js');
const { blockCrossover } = require('../BlockCrossover.js');

// ─── invariant checker ────────────────────────────────────────────────────────

/**
 * Assert all valid-board invariants on an inventory produced by crossover.
 * - No cog key appears at more than one position
 * - Fixed cogs are at their initialKey (unmoved)
 * - Blocked positions are empty
 * - Only positions in availableSlotKeys are occupied
 */
function assertValidBoard(inv, label = '') {
  const prefix = label ? `[${label}] ` : '';

  // 1. No duplicate cog positions: each cog key appears exactly once
  const positions = Object.keys(inv.cogs).map(Number);
  const uniquePositions = new Set(positions);
  assert.strictEqual(
    uniquePositions.size, positions.length,
    `${prefix}duplicate positions detected: ${positions}`
  );

  // 2. Fixed cogs must be at their initialKey
  for (const cog of Object.values(inv.cogs)) {
    if (cog.fixed) {
      assert.strictEqual(
        cog.key, cog.initialKey,
        `${prefix}fixed cog ${cog.initialKey} moved to ${cog.key}`
      );
    }
  }

  // 3. Blocked positions must be empty
  const blockedSlots = Object.values(inv.slots).filter(s => s.blocked).map(s => s.key);
  for (const pos of blockedSlots) {
    assert.ok(
      inv.cogs[pos] === undefined,
      `${prefix}blocked position ${pos} is occupied`
    );
  }

  // 4. Spare positions are in range >= 108
  for (const key of Object.keys(inv.cogs).map(Number)) {
    if (key < 96) {
      assert.ok(
        inv.availableSlotKeys.includes(key) || inv.cogs[key]?.fixed,
        `${prefix}cog at non-available, non-fixed board position ${key}`
      );
    }
  }
}

/**
 * Build two parents with all 96 board positions filled, no fixed/blocked slots.
 * Cogs are assigned to random positions via SeededRng to give diverse parents.
 */
function makeTwoParents(seed = 0) {
  const rng = new SeededRng(seed);
  // Create 96 plain stat cogs, keys 0..95 (initialKey = key, not fixed)
  const allCogs = Array.from({ length: 96 }, (_, i) =>
    makeCog(i, { buildRate: rng.randInt(100) + 1 })
  );
  // Shuffle to create parentA
  const shuffledA = [...allCogs];
  for (let i = shuffledA.length - 1; i > 0; i--) {
    const j = rng.randInt(i + 1);
    [shuffledA[i], shuffledA[j]] = [shuffledA[j], shuffledA[i]];
  }
  // Re-assign keys to positions
  const cogsA = shuffledA.map((cog, pos) => makeCog(pos, {
    buildRate: cog.buildRate,
    initialKey: cog.initialKey
  }));

  const shuffledB = [...allCogs];
  for (let i = shuffledB.length - 1; i > 0; i--) {
    const j = rng.randInt(i + 1);
    [shuffledB[i], shuffledB[j]] = [shuffledB[j], shuffledB[i]];
  }
  const cogsB = shuffledB.map((cog, pos) => makeCog(pos, {
    buildRate: cog.buildRate,
    initialKey: cog.initialKey
  }));

  const parentA = buildInventory(cogsA);
  const parentB = buildInventory(cogsB);
  return { parentA, parentB };
}

// ─── basic structure tests ────────────────────────────────────────────────────

describe('blockCrossover — basic structural invariants', () => {
  it('child passes all valid-board invariants on simple full board', () => {
    const rng = new SeededRng(1);
    const { parentA, parentB } = makeTwoParents(1);
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'simple full board');
  });

  it('child has same number of cogs as parents', () => {
    const rng = new SeededRng(2);
    const { parentA, parentB } = makeTwoParents(2);
    const blockRect = { rowStart: 2, colStart: 4, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assert.strictEqual(
      Object.keys(child.cogs).length,
      Object.keys(parentA.cogs).length,
      'child cog count must equal parent cog count'
    );
  });

  it('positions in block region come from parent A', () => {
    const rng = new SeededRng(3);
    const { parentA, parentB } = makeTwoParents(3);
    const blockRect = { rowStart: 1, colStart: 2, rows: 2, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);

    // Collect positions in block that are in availableSlotKeys
    const INV_COLUMNS = 12;
    const blockPositions = [];
    for (let r = blockRect.rowStart; r < blockRect.rowStart + blockRect.rows; r++) {
      for (let c = blockRect.colStart; c < blockRect.colStart + blockRect.cols; c++) {
        const key = r * INV_COLUMNS + c;
        if (parentA.availableSlotKeys.includes(key)) blockPositions.push(key);
      }
    }

    // For each block position, the cog in the child should have the same initialKey
    // as the cog from parent A at that position
    for (const pos of blockPositions) {
      const cogInParentA = parentA.cogs[pos];
      const cogInChild = child.cogs[pos];
      if (cogInParentA) {
        assert.ok(cogInChild, `child missing cog at block position ${pos}`);
        assert.strictEqual(
          cogInChild.initialKey, cogInParentA.initialKey,
          `block position ${pos}: expected cog ${cogInParentA.initialKey} from parent A, got ${cogInChild?.initialKey}`
        );
      }
    }
  });

  it('no cog appears at two positions (no duplicates)', () => {
    const rng = new SeededRng(4);
    const { parentA, parentB } = makeTwoParents(4);
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    const initialKeys = Object.values(child.cogs).map(c => c.initialKey);
    const uniqueKeys = new Set(initialKeys);
    assert.strictEqual(uniqueKeys.size, initialKeys.length,
      `Duplicate initialKeys found: ${initialKeys}`);
  });

  it('child does not contain cogs from neither parent (no invented cogs)', () => {
    const rng = new SeededRng(5);
    const { parentA, parentB } = makeTwoParents(5);
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);

    // All initialKeys in child must appear in parentA OR parentB
    const allParentInitialKeys = new Set([
      ...Object.values(parentA.cogs).map(c => c.initialKey),
      ...Object.values(parentB.cogs).map(c => c.initialKey)
    ]);
    for (const cog of Object.values(child.cogs)) {
      assert.ok(
        allParentInitialKeys.has(cog.initialKey),
        `child has invented cog with initialKey ${cog.initialKey}`
      );
    }
  });
});

// ─── fixed cog invariants ─────────────────────────────────────────────────────

describe('blockCrossover — fixed cog invariants', () => {
  it('fixed cogs remain at their original position after crossover', () => {
    const rng = new SeededRng(10);
    // Build parents where positions 0 and 11 are fixed
    const cogsA = Array.from({ length: 96 }, (_, i) =>
      makeCog(i, { buildRate: i + 1, fixed: (i === 0 || i === 11) })
    );
    const cogsB = cogsA.map(c => makeCog(c.key, {
      buildRate: c.buildRate * 2,
      fixed: c.fixed
    }));
    const parentA = buildInventory(cogsA);
    const parentB = buildInventory(cogsB);

    // Block overlaps both fixed positions
    const blockRect = { rowStart: 0, colStart: 0, rows: 2, cols: 6 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);

    // Fixed cogs must be at their initialKey
    for (const cog of Object.values(child.cogs)) {
      if (cog.fixed) {
        assert.strictEqual(cog.key, cog.initialKey,
          `Fixed cog ${cog.initialKey} found at position ${cog.key}`);
      }
    }
    assertValidBoard(child, 'fixed cogs test');
  });

  it('block region containing fixed positions still produces valid child', () => {
    const rng = new SeededRng(11);
    // Fixed cog at position 14 (row=1, col=2)
    const cogsA = Array.from({ length: 96 }, (_, i) =>
      makeCog(i, { buildRate: i + 1, fixed: i === 14 })
    );
    const cogsB = Array.from({ length: 96 }, (_, i) =>
      makeCog(i, { buildRate: (96 - i), fixed: i === 14 })
    );
    const parentA = buildInventory(cogsA);
    const parentB = buildInventory(cogsB);

    // Block centered on fixed cog
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 4 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'fixed in block');
    assert.strictEqual(child.cogs[14]?.initialKey, 14, 'fixed cog at 14 must stay at 14');
  });
});

// ─── blocked position invariants ──────────────────────────────────────────────

describe('blockCrossover — blocked positions', () => {
  it('blocked positions remain empty in child', () => {
    const rng = new SeededRng(20);
    // Positions 5 and 17 are blocked
    const blockedKeys = [5, 17];
    const cogsA = Array.from({ length: 94 }, (_, i) => {
      // Skip blocked positions: keys 0..4, 6..16, 18..95
      const key = i < 5 ? i : i < 16 ? i + 1 : i + 2;
      return makeCog(key, { buildRate: key + 1 });
    });
    const cogsB = cogsA.map(c => makeCog(c.key, { buildRate: c.buildRate + 1 }));
    const parentA = buildInventory(cogsA, { blockedKeys });
    const parentB = buildInventory(cogsB, { blockedKeys });

    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'blocked positions');
    assert.ok(!child.cogs[5], 'position 5 must be empty (blocked)');
    assert.ok(!child.cogs[17], 'position 17 must be empty (blocked)');
  });
});

// ─── property-based / repeated run checks ────────────────────────────────────

describe('blockCrossover — property-based checks (30 random runs)', () => {
  it('all invariants hold across 30 different seeds and block positions', () => {
    const INV_COLUMNS = 12;
    for (let seed = 100; seed < 130; seed++) {
      const rng = new SeededRng(seed);
      const { parentA, parentB } = makeTwoParents(seed);

      // Random block rect within bounds
      const rowStart = rng.randInt(5);          // 0..4
      const colStart = rng.randInt(9);          // 0..8
      const rows = rng.randInt(3) + 2;          // 2..4
      const cols = rng.randInt(3) + 2;          // 2..4
      const blockRect = { rowStart, colStart, rows, cols };

      const child = blockCrossover(parentA, parentB, blockRect, rng);
      assertValidBoard(child, `seed=${seed} block=${JSON.stringify(blockRect)}`);

      // No duplicate initialKeys
      const initialKeys = Object.values(child.cogs).map(c => c.initialKey);
      assert.strictEqual(new Set(initialKeys).size, initialKeys.length,
        `seed=${seed}: duplicate initialKeys`);

      // Cog count preserved
      assert.strictEqual(Object.keys(child.cogs).length, Object.keys(parentA.cogs).length,
        `seed=${seed}: cog count changed`);
    }
  });
});

// ─── score correctness ────────────────────────────────────────────────────────

describe('blockCrossover — score accuracy', () => {
  it('child score matches fullRecompute from IncrementalScorer', () => {
    const { IncrementalScorer } = require('../IncrementalScorer.js');
    const rng = new SeededRng(200);
    const { parentA, parentB } = makeTwoParents(200);
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);

    const scorer = new IncrementalScorer(child);
    const incremental = scorer.score;
    const recomputed = scorer.fullRecompute();

    assert.strictEqual(incremental.buildRate, recomputed.buildRate, 'buildRate mismatch');
    assert.strictEqual(incremental.expBonus, recomputed.expBonus, 'expBonus mismatch');
    assert.strictEqual(incremental.flaggy, recomputed.flaggy, 'flaggy mismatch');
    assert.strictEqual(incremental.expBoost, recomputed.expBoost, 'expBoost mismatch');
    assert.strictEqual(incremental.flagBoost, recomputed.flagBoost, 'flagBoost mismatch');
  });
});

// ─── edge cases ───────────────────────────────────────────────────────────────

describe('blockCrossover — edge cases', () => {
  it('block covering entire board: child is a clone of parentA', () => {
    const rng = new SeededRng(300);
    const { parentA, parentB } = makeTwoParents(300);
    // Full board block
    const blockRect = { rowStart: 0, colStart: 0, rows: 8, cols: 12 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'full block');
    // All positions should match parentA
    for (const pos of parentA.availableSlotKeys) {
      const cogA = parentA.cogs[pos];
      const cogC = child.cogs[pos];
      if (cogA) {
        assert.ok(cogC, `position ${pos} empty in child but occupied in parentA`);
        assert.strictEqual(cogC.initialKey, cogA.initialKey,
          `position ${pos}: child has ${cogC.initialKey}, parentA has ${cogA.initialKey}`);
      }
    }
  });

  it('block covering zero available positions: child is assembled from parentB', () => {
    const rng = new SeededRng(301);
    const { parentA, parentB } = makeTwoParents(301);
    // Block at positions off the available list would be unusual; use a 0x0 block
    const blockRect = { rowStart: 0, colStart: 0, rows: 0, cols: 0 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'zero block');
  });

  it('identical parents produce a valid child', () => {
    const rng = new SeededRng(302);
    const { parentA } = makeTwoParents(302);
    const parentB = parentA.clone();
    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'identical parents');
    const keysA = Object.values(parentA.cogs).map(c => c.initialKey).sort((a,b)=>a-b);
    const keysC = Object.values(child.cogs).map(c => c.initialKey).sort((a,b)=>a-b);
    assert.deepStrictEqual(keysC, keysA, 'child should have same cog set as parents');
  });

  it('board with spare-area cogs: no spare cog ends up on the main board', () => {
    const rng = new SeededRng(303);
    // 80 board cogs + 16 spare cogs
    const boardCogs = Array.from({ length: 80 }, (_, i) => makeCog(i, { buildRate: i + 1 }));
    const spareCogs = Array.from({ length: 16 }, (_, i) =>
      makeCog(108 + i, { buildRate: i + 200 })
    );
    const allCogs = [...boardCogs, ...spareCogs];

    // Shuffle for parentB
    const allCogsB = allCogs.map(c => {
      // reassign to same positions (just vary buildRate slightly)
      return makeCog(c.key, { buildRate: c.buildRate + 1 });
    });

    // Build parentA with spare cogs in spare area
    const cogsADict = {};
    allCogs.forEach(c => cogsADict[c.key] = c);
    const cogsBDict = {};
    allCogsB.forEach(c => cogsBDict[c.key] = c);

    const slotsA = {};
    for (let i = 0; i < 96; i++) slotsA[i] = new Cog({ key: i, icon: 'Blank' });
    const parentA = new CogInventory(cogsADict, slotsA);
    parentA.availableSlotKeys = boardCogs.map(c => c.key);
    parentA.flagPose = [];
    parentA.flaggyShopUpgrades = 0;
    parentA.playerCount = 5;

    const parentB = new CogInventory(cogsBDict, { ...slotsA });
    parentB.availableSlotKeys = boardCogs.map(c => c.key);
    parentB.flagPose = [];
    parentB.flaggyShopUpgrades = 0;
    parentB.playerCount = 5;

    const blockRect = { rowStart: 0, colStart: 0, rows: 4, cols: 3 };
    const child = blockCrossover(parentA, parentB, blockRect, rng);
    assertValidBoard(child, 'spare cogs test');

    // No spare cog should be on the main board
    for (const [key, cog] of Object.entries(child.cogs)) {
      if (Number(key) < 96 && !cog.fixed) {
        assert.ok(
          cog.initialKey < 108 || cog.initialKey >= 108 && cog.fixed,
          `spare cog ${cog.initialKey} ended up at main board position ${key}`
        );
      }
    }
  });
});
