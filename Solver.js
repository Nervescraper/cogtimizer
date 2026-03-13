function yield() {
  return new Promise(r=>setTimeout(r,1));
}

class Solver {
  constructor(weights={}) {
    this.setWeights(weights.buildRate, weights.expBonus, weights.flaggy)
  }
  
  setWeights(buildRate, expBonus, flaggy) {
    this.weights = {
      buildRate: buildRate,
      expBonus: expBonus,
      flaggy: flaggy
    }
    this.targets = null;
  }

  setTargets(targets) {
    this.targets = targets; // { buildRate, expBonus, flaggy }
  }

  getScoreSum(score, playerCount, flagCount) {
    if (this.targets) {
      // Target-based scoring: each stat contributes min(actual/target, 1.0)
      // Stats below threshold are prioritized; stats above stop contributing
      let res = 0;
      const br = this.targets.buildRate > 0 ? Math.min(score.buildRate / this.targets.buildRate, 1.0) : 1.0;
      const xpEff = score.expBonus * (score.expBoost + playerCount) / playerCount;
      const xp = this.targets.expBonus > 0 ? Math.min(xpEff / this.targets.expBonus, 1.0) : 1.0;
      const flEff = score.flaggy * (score.flagBoost + flagCount) / flagCount;
      const fl = this.targets.flaggy > 0 ? Math.min(flEff / this.targets.flaggy, 1.0) : 1.0;
      // Use product so missing any one target tanks the score (encourages balance)
      res = br * xp * fl;
      return res;
    }
    let res = 0;
    res += score.buildRate * this.weights.buildRate;
    res += score.expBonus * this.weights.expBonus * (score.expBoost + playerCount) / playerCount;
    res += score.flaggy * this.weights.flaggy * (score.flagBoost + flagCount) / flagCount;
    return res;
  }
  
  static _yield() {
    return new Promise(r=>setTimeout(r,1));
  }
  
  /**
   * solveTime: Number - Time in ms how long the solver should run
   */
  async solve(inventory, solveTime=1000) {
    if (inventory.flagPose.length === 0) {
      // No flaggs placed means no use for flaggy rate
      this.weights.flaggy = 0;
    }
    console.log("Solving with goal:", this.weights);
    const playerCount = inventory.playerCount || 10;
    const flagCount = Math.max(inventory.flagPose.length, 1);
    let lastYield = Date.now();
    let state = inventory.clone();
    const solutions = [state];
    const startTime = Date.now();
    const allSlots = inventory.availableSlotKeys;
    let counter = 0;
    let currentScore = this.getScoreSum(state.score, playerCount, flagCount);
    let temperature = this.targets
      ? 0.05  // Target mode scores are 0-1, so use a small temperature
      : Math.max(Math.abs(currentScore) * 0.05, 100);
    const coolingRate = 0.9997;

    console.log("Trying to optimize");
    while(Date.now() - startTime < solveTime) {
      if(Date.now() - lastYield > 100) {
        // Prevent UI from freezing with very high solve times
        await Solver._yield();
        lastYield = Date.now();
      }
      counter++;
      if (counter % 10000 === 0) {
        state = inventory.clone();
        this.shuffle(state);
        currentScore = this.getScoreSum(state.score, playerCount, flagCount);
        temperature = this.targets
          ? 0.05
          : Math.max(Math.abs(currentScore) * 0.05, 100);
        solutions.push(state);
      }
      const slotKey = allSlots[Math.floor(Math.random() * allSlots.length)];
      // Moving a cog to an empty space changes the list of cog keys, so we need to re-fetch this
      const allKeys = state.cogKeys;
      const cogKey = allKeys[Math.floor(Math.random() * allKeys.length)];
      const slot = state.get(slotKey);
      const cog = state.get(cogKey);

      if (slot.fixed || cog.fixed || cog.position().location === "build") continue;
      state.move(slotKey, cogKey);
      const scoreSumUpdate = this.getScoreSum(state.score, playerCount, flagCount);
      const delta = scoreSumUpdate - currentScore;
      if (delta > 0 || Math.random() < Math.exp(delta / temperature)) {
        currentScore = scoreSumUpdate;
      } else {
        state.move(slotKey, cogKey);
      }
      temperature *= coolingRate;
    }
    console.log(`Tried ${counter} switches`);
    const scores = solutions.map((s)=>this.getScoreSum(s.score, playerCount, flagCount));
    console.log(`Made ${solutions.length} different attempts with final scores: ${scores}`);
    const bestIndex = scores.indexOf(scores.reduce((a,b)=>Math.max(a,b)));
    let best = solutions[bestIndex];
    if (g.best === null || this.getScoreSum(g.best.score, playerCount, flagCount) < scores[bestIndex]) {
      console.log("Best solution was number", bestIndex);
      g.best = best;
    } else {
      best = g.best;
    }
    this.removeUselesMoves(best);
    return best;
  }
  
  shuffle(inventory, n = 500) {
    const allSlots = inventory.availableSlotKeys;
    for (let i = 0; i < n; i++) {
      const slotKey = allSlots[Math.floor(Math.random() * allSlots.length)];
      // Moving a cog to an empty space changes the list of cog keys, so we need to re-fetch this
      const allKeys = inventory.cogKeys;
      const cogKey = allKeys[Math.floor(Math.random() * allKeys.length)];
      const slot = inventory.get(slotKey);
      const cog = inventory.get(cogKey);

      if (slot.fixed || cog.fixed || cog.position().location === "build") continue;
      inventory.move(slotKey, cogKey);
    }
  }
  
  removeUselesMoves(inventory) {
    const goal = inventory.score;
    let removed = true;
    while (removed) {
      removed = false;
      const cogsToMove = Object.values(inventory.cogs)
        .filter((c) => c.key !== c.initialKey);
      for (let i = 0; i < cogsToMove.length; i++) {
        const cog1 = cogsToMove[i];
        const cog1Key = cog1.key;
        const cog2Key = cog1.initialKey;
        inventory.move(cog1Key, cog2Key);
        const changed = inventory.score;
        if (changed.buildRate === goal.buildRate
          && changed.flaggy === goal.flaggy
          && changed.expBonus === goal.expBonus
          && changed.expBoost === goal.expBoost
          && changed.flagBoost === goal.flagBoost) {
          console.log(`Removed useless move ${cog1Key} to ${cog2Key}`);
          removed = true;
          break;
        }
        inventory.move(cog1Key, cog2Key);
      }
    }
  }
}