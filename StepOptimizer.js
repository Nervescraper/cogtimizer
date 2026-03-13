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

  // Multi-step movements — tag each step with its cycleId for sorting
  let cycleId = 0;
  let tuple;
  while (tuple = Object.entries(interimCogs)[0]) {
    const [key, cog] = tuple;
    const targetCog = interimCogs[cog.key] || { icon: "Blank", key, position: cog.position.bind(cog) };
    if (targetCog === cog) {
      delete interimCogs[key];
      cycleId++;
      continue;
    }
    interimCogs[key] = targetCog;
    steps.push({
      board,
      cog,
      targetCog,
      keyFrom: Number.parseInt(key),
      keyTo: Number.parseInt(cog.key),
      cycleId
    });
    delete interimCogs[cog.key];
  }

  // Geographic sort — reorder cycles, preserving intra-cycle step order
  const SPARE_START = 108;
  const BUILD_START = 96;
  const BUILD_END = 107;

  function cycleSortKey(step) {
    const kf = step.keyFrom;
    const kt = step.keyTo;
    // Classification priority: spare first, then build, then board
    if (kf >= SPARE_START || kt >= SPARE_START) {
      const spareKey = kf >= SPARE_START ? kf : kt;
      const otherKey = kf >= SPARE_START ? kt : kf;
      return { bucket: 2, primary: spareKey, secondary: otherKey };
    }
    if ((kf >= BUILD_START && kf <= BUILD_END) || (kt >= BUILD_START && kt <= BUILD_END)) {
      return { bucket: 1, primary: Math.min(kf, kt), secondary: 0 };
    }
    return { bucket: 0, primary: Math.min(kf, kt), secondary: 0 };
  }

  // Group steps by cycleId, compute sort key from first step of each cycle
  const cycleMap = new Map();
  for (const step of steps) {
    if (!cycleMap.has(step.cycleId)) {
      cycleMap.set(step.cycleId, { steps: [], sortKey: cycleSortKey(step) });
    }
    cycleMap.get(step.cycleId).steps.push(step);
  }

  // Sort cycles by bucket, then primary, then secondary
  const sortedCycles = [...cycleMap.values()].sort((a, b) => {
    if (a.sortKey.bucket !== b.sortKey.bucket) return a.sortKey.bucket - b.sortKey.bucket;
    if (a.sortKey.primary !== b.sortKey.primary) return a.sortKey.primary - b.sortKey.primary;
    return a.sortKey.secondary - b.sortKey.secondary;
  });

  // Flatten back to step array, preserving intra-cycle order
  steps.length = 0;
  for (const cycle of sortedCycles) {
    for (const step of cycle.steps) {
      steps.push(step);
    }
  }

  return steps;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getOptimalSteps, cogsAreEquivalent };
}
