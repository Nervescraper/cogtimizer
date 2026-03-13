function getOptimalSteps(board, cogs) {
  const steps = [];

  const cogsToMove = Object.values(cogs)
    .map(c => { return new Cog(c) })
    .filter((c) => c.key !== c.initialKey);

  const interimCogs = {};
  for (const cog of cogsToMove) {
    interimCogs[cog.initialKey] = cog;
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
  module.exports = { getOptimalSteps };
}
