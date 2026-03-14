// In Node (test environment), import Cog; in browser it is a global.
// Uses globalThis to avoid var hoisting which would shadow the browser global.
if (typeof module !== 'undefined' && module.exports) {
  globalThis.Cog = require('./CogInventory.js').Cog;
}

function cogsAreEquivalent(a, b) {
  if (a.boostRadius || b.boostRadius) return false;
  if (a.isPlayer || b.isPlayer) return false;
  if (a.isFlag || b.isFlag) return false;
  if (a.buildRate !== b.buildRate) return false;
  if (a.expBonus !== b.expBonus) return false;
  if (a.flaggy !== b.flaggy) return false;
  // Icon can be a string ("Blank") or object with .path
  const iconA = typeof a.icon === 'string' ? a.icon : (a.icon && a.icon.path);
  const iconB = typeof b.icon === 'string' ? b.icon : (b.icon && b.icon.path);
  if (iconA !== iconB) return false;
  return true;
}

function getOptimalSteps(board, cogs, originalCogs) {
  const allCogs = Object.values(cogs).map(c => new Cog(c));

  // Lookup: initialKey → Cog object
  const cogByIk = {};
  for (const cog of allCogs) {
    cogByIk[cog.initialKey] = cog;
  }

  // Include original cogs not present in the solution (displaced by spare/build cogs)
  if (originalCogs) {
    for (const c of Object.values(originalCogs)) {
      if (cogByIk[c.initialKey] === undefined) {
        cogByIk[c.initialKey] = new Cog(c);
      }
    }
  }

  // solution[pos] = initialKey of the cog that belongs at board position pos
  const solution = {};
  for (const cog of allCogs) {
    if (cog.key < 96) {
      solution[cog.key] = cog.initialKey;
    }
  }

  // Tracking state — each cog starts at its initialKey
  const current = {};  // pos → initialKey (undefined = blank)
  const posOf = {};    // initialKey → pos
  for (const ik in cogByIk) {
    current[ik] = Number(ik);
    posOf[ik] = Number(ik);
  }

  // Find a free spare slot for cog shelf displacement
  const SPARE_START = 108;
  const BUILD_START = 96;
  const BUILD_END = 107;
  let nextSpare = SPARE_START;
  function findFreeSpare() {
    while (current[nextSpare] !== undefined) nextSpare++;
    return nextSpare;
  }

  // Selection sort over board positions 0–95
  const steps = [];
  for (let p = 0; p < 96; p++) {
    const targetIk = solution[p];
    if (targetIk === undefined) continue;
    if (current[p] === targetIk) continue;

    const srcPos = posOf[targetIk];
    const displacedIk = current[p];

    const cog = cogByIk[targetIk];
    const targetCog = displacedIk !== undefined && cogByIk[displacedIk]
      ? cogByIk[displacedIk]
      : { icon: "Blank", key: p, position: cog.position.bind(cog) };

    // If the source is a cog shelf slot (96-107), we can't swap directly —
    // the displaced board cog must go to spare first, then the player moves in.
    if (srcPos >= BUILD_START && srcPos <= BUILD_END && displacedIk !== undefined) {
      const sparePos = findFreeSpare();
      const sparePlaceholder = { icon: "Blank", key: sparePos, position: cog.position.bind(cog) };

      // Step 1: move displaced board cog to spare
      steps.push({ board, cog: targetCog, targetCog: sparePlaceholder, keyFrom: p, keyTo: sparePos });
      current[sparePos] = displacedIk;
      current[p] = undefined;
      posOf[displacedIk] = sparePos;

      // Step 2: move player from cog shelf to board
      const shelfCog = cogByIk[targetIk];
      const shelfPlaceholder = { icon: "Blank", key: srcPos, position: cog.position.bind(cog) };
      steps.push({ board, cog: shelfCog, targetCog: shelfPlaceholder, keyFrom: p, keyTo: srcPos });
      current[p] = targetIk;
      current[srcPos] = undefined;
      posOf[targetIk] = p;
    } else {
      steps.push({ board, cog, targetCog, keyFrom: p, keyTo: srcPos });

      // Update tracking
      current[p] = targetIk;
      current[srcPos] = displacedIk;
      posOf[targetIk] = p;
      if (displacedIk !== undefined) posOf[displacedIk] = srcPos;
    }
  }

  // Post-processing: filter out swaps of equivalent cogs
  return steps.filter(step => !cogsAreEquivalent(step.cog, step.targetCog));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getOptimalSteps, cogsAreEquivalent };
}
