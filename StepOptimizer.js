// In Node (test environment), import Cog; in browser it is a global.
if (typeof module !== 'undefined' && module.exports) {
  var Cog = require('./CogInventory.js').Cog;
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

function getOptimalSteps(board, cogs) {
  const steps = [];

  const cogsToMove = Object.values(cogs)
    .map(c => { return new Cog(c) })
    .filter((c) => c.key !== c.initialKey);

  const interimCogs = {};
  for (const cog of cogsToMove) {
    interimCogs[cog.initialKey] = cog;
  }

  // Eliminate 2-cycles of equivalent cogs (they cancel out)
  const interimKeys = Object.keys(interimCogs);
  const eliminated = new Set();
  for (const key of interimKeys) {
    if (eliminated.has(key)) continue;
    const cogA = interimCogs[key];
    const otherKey = String(cogA.key);
    const cogB = interimCogs[otherKey];
    // Check: is this a direct 2-swap (A at B's original pos, B at A's original pos)?
    if (cogB && String(cogB.key) === key && cogsAreEquivalent(cogA, cogB)) {
      eliminated.add(key);
      eliminated.add(otherKey);
    }
  }
  for (const key of eliminated) {
    delete interimCogs[key];
  }

  // Multi-step movements
  let tuple;
  while (tuple = Object.entries(interimCogs)[0]) {
    const [key, cog] = tuple;
    const targetCog = interimCogs[cog.key] || { icon: "Blank", key, position: cog.position.bind(cog) };
    if (targetCog === cog) {
      delete interimCogs[key];
      continue;
    }
    interimCogs[key] = targetCog;
    steps.push({
      board,
      cog,
      targetCog,
      keyFrom: Number.parseInt(key),
      keyTo: Number.parseInt(cog.key)
    });
    delete interimCogs[cog.key];
  }

  return steps;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getOptimalSteps, cogsAreEquivalent };
}
