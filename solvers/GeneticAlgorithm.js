// GeneticAlgorithm.js

if (typeof require !== 'undefined') {
  var _crossMod = require('./BlockCrossover.js');
  var blockCrossover = _crossMod.blockCrossover;
  var _rngMod = require('../SeededRng.js');
  var SeededRng = _rngMod.SeededRng;
  var _cogMod = require('../CogInventory.js');
  var CogInventory = _cogMod.CogInventory;
  var Cog = _cogMod.Cog;
  var _scorerMod = require('../IncrementalScorer.js');
  var IncrementalScorer = _scorerMod.IncrementalScorer;
  var _solverMod = require('../Solver.js');
  var getScoreSum = _solverMod.getScoreSum;
}

var GA_DEFAULTS = {
  populationSize: 40,
  eliteCount: 3,
  tournamentSize: 3,
  mutationRate: 0.15,
  crossoverBlockRows: 4,
  crossoverBlockCols: 3,
  spareSwapRate: 0.20,
  swapMutationMinPairs: 1,
  swapMutationMaxPairs: 3,
  greedyEliteCount: 5,
  greedyEliteSwaps: [5, 10],
  greedyRestSwaps: [50, 200],
  seed: 0
};

class GeneticAlgorithm {
  /**
   * @param {IncrementalScorer} scorer
   * @param {Object} settings
   */
  constructor(settings) {
    this.settings = { ...GA_DEFAULTS, ...settings };
    this.rng = new SeededRng(this.settings.seed);
  }

  static get displayName() { return 'Genetic Algorithm'; }
  static get description() { return 'Population-based. Explores diverse solutions.'; }

  /**
   * Initialize population from a starting inventory.
   * Top `greedyEliteCount` individuals: greedy + slight perturbation (5-10 swaps)
   * Remaining: greedy + heavier perturbation (50-200 swaps)
   *
   * @param {CogInventory} inventory - Starting inventory (already greedy-initialized)
   * @returns {CogInventory[]}
   */
  initPopulation(inventory) {
    var populationSize = this.settings.populationSize;
    var greedyEliteCount = this.settings.greedyEliteCount;
    var greedyEliteSwaps = this.settings.greedyEliteSwaps;
    var greedyRestSwaps = this.settings.greedyRestSwaps;
    var population = [];

    for (var i = 0; i < populationSize; i++) {
      var individual = inventory.clone();
      var isElite = i < greedyEliteCount;
      var swapRange = isElite ? greedyEliteSwaps : greedyRestSwaps;
      var minSwaps = swapRange[0];
      var maxSwaps = swapRange[1];
      var numSwaps = minSwaps + this.rng.randInt(maxSwaps - minSwaps + 1);
      this._randomSwap(individual, numSwaps);
      population.push(individual);
    }

    return population;
  }

  /**
   * Apply `n` random swaps to an inventory (in-place). Respects fixed constraints.
   * @param {CogInventory} inventory
   * @param {number} n
   */
  _randomSwap(inventory, n) {
    var slots = inventory.availableSlotKeys;

    for (var i = 0; i < n; i++) {
      var posA = slots[this.rng.randInt(slots.length)];
      var posB = slots[this.rng.randInt(slots.length)];
      if (posA === posB) continue;
      var cogA = inventory.cogs[posA];
      var cogB = inventory.cogs[posB];
      if (cogA && cogA.fixed) continue;
      if (cogB && cogB.fixed) continue;
      inventory.move(posA, posB);
    }
    inventory._score = null;
  }

  /**
   * Tournament selection: draw `tournamentSize` random competitors, return index of winner.
   * @param {CogInventory[]} population
   * @param {number[]} scores - parallel array of scalar scores
   * @returns {number} index of the selected individual
   */
  tournamentSelect(population, scores) {
    var tournamentSize = this.settings.tournamentSize;
    var bestIdx = this.rng.randInt(population.length);
    for (var i = 1; i < tournamentSize; i++) {
      var challenger = this.rng.randInt(population.length);
      if (scores[challenger] > scores[bestIdx]) {
        bestIdx = challenger;
      }
    }
    return bestIdx;
  }

  /**
   * Apply mutation to a clone of the individual. Returns the mutated clone.
   * Does not modify the input.
   * - 80%: swap mutation (1-3 random board-board swaps)
   * - 20%: spare mutation (swap one board cog with a spare-pool cog)
   *
   * @param {CogInventory} individual
   * @returns {CogInventory} mutated clone
   */
  mutate(individual) {
    var spareSwapRate = this.settings.spareSwapRate;
    var swapMutationMinPairs = this.settings.swapMutationMinPairs;
    var swapMutationMaxPairs = this.settings.swapMutationMaxPairs;
    var mutated = individual.clone();
    var slots = mutated.availableSlotKeys;

    if (this.rng.random() < spareSwapRate) {
      // Spare mutation: swap a random board cog with a spare-pool cog
      var boardKeys = slots.filter(function(k) { return mutated.cogs[k] && !mutated.cogs[k].fixed; });
      var spareKeys = Object.keys(mutated.cogs)
        .map(Number)
        .filter(function(k) { return k >= 108 && !mutated.cogs[k].fixed; });

      if (boardKeys.length > 0 && spareKeys.length > 0) {
        var boardPos = boardKeys[this.rng.randInt(boardKeys.length)];
        var sparePos = spareKeys[this.rng.randInt(spareKeys.length)];
        mutated.move(boardPos, sparePos);
      }
    } else {
      // Swap mutation: 1-3 random board-board swaps
      var pairCount = swapMutationMinPairs +
        this.rng.randInt(swapMutationMaxPairs - swapMutationMinPairs + 1);
      for (var p = 0; p < pairCount; p++) {
        var posA = slots[this.rng.randInt(slots.length)];
        var posB = slots[this.rng.randInt(slots.length)];
        if (posA === posB) continue;
        var cogA = mutated.cogs[posA];
        var cogB = mutated.cogs[posB];
        if (cogA && cogA.fixed) continue;
        if (cogB && cogB.fixed) continue;
        mutated.move(posA, posB);
      }
    }

    mutated._score = null;
    return mutated;
  }

  /**
   * Produce the next generation population.
   * - Elite top `eliteCount` individuals survive unchanged
   * - Remaining slots filled by crossover (tournament-selected parents) + mutation
   *
   * @param {CogInventory[]} population
   * @param {number[]} scores - parallel array of scalar scores
   * @returns {CogInventory[]} next generation
   */
  nextGeneration(population, scores) {
    var populationSize = this.settings.populationSize;
    var eliteCount = this.settings.eliteCount;
    var mutationRate = this.settings.mutationRate;
    var crossoverBlockRows = this.settings.crossoverBlockRows;
    var crossoverBlockCols = this.settings.crossoverBlockCols;
    var INV_COLUMNS = 12;

    // Sort by score descending to get elites
    var ranked = [];
    for (var si = 0; si < scores.length; si++) {
      ranked.push([si, scores[si]]);
    }
    ranked.sort(function(a, b) { return b[1] - a[1]; });
    var nextGen = [];

    // Preserve elite individuals
    for (var i = 0; i < Math.min(eliteCount, populationSize); i++) {
      nextGen.push(population[ranked[i][0]].clone());
    }

    // Fill remaining slots
    while (nextGen.length < populationSize) {
      // Tournament-select two parents
      var idxA = this.tournamentSelect(population, scores);
      var idxB = this.tournamentSelect(population, scores);
      // Ensure distinct parents when possible
      if (population.length > 1) {
        var attempts = 0;
        while (idxB === idxA && attempts < 5) {
          idxB = this.tournamentSelect(population, scores);
          attempts++;
        }
      }
      var parentA = population[idxA];
      var parentB = population[idxB];

      // Random block rect within board bounds
      var maxRowStart = Math.max(0, 8 - crossoverBlockRows);
      var maxColStart = Math.max(0, INV_COLUMNS - crossoverBlockCols);
      var rowStart = this.rng.randInt(maxRowStart + 1);
      var colStart = this.rng.randInt(maxColStart + 1);
      var blockRect = {
        rowStart: rowStart,
        colStart: colStart,
        rows: crossoverBlockRows,
        cols: crossoverBlockCols
      };

      var child = blockCrossover(parentA, parentB, blockRect, this.rng);

      // Apply mutation with probability mutationRate
      if (this.rng.random() < mutationRate) {
        child = this.mutate(child);
      }

      nextGen.push(child);
    }

    return nextGen;
  }

  /**
   * Score a single individual using IncrementalScorer.fullRecompute.
   *
   * @param {CogInventory} individual
   * @param {number} playerCount
   * @param {number} flagCount
   * @param {Object} weights
   * @param {Object|null} targets
   * @returns {number}
   */
  _scoreIndividual(individual, playerCount, flagCount, weights, targets) {
    var tempScorer = new IncrementalScorer(individual);
    var raw = tempScorer.fullRecompute();
    return getScoreSum(raw, weights, targets, playerCount, flagCount);
  }

  /**
   * Run the genetic algorithm.
   *
   * @param {IncrementalScorer} scorer - Scoring engine wrapping the initial inventory
   * @param {number} timeLimit - Time budget in milliseconds
   * @param {function} onProgress - Called each generation with { score, iterations, elapsed }
   * @returns {CogInventory} best solution found
   */
  solve(scorer, timeLimit, onProgress) {
    var inventory = scorer.inventory;
    var startTime = Date.now();
    var playerCount = inventory.playerCount || 10;
    var flagCount = Math.max((inventory.flagPose || []).length, 1);
    var weights = this.settings.weights || { buildRate: 1, expBonus: 0, flaggy: 0 };
    var targets = this.settings.targets || null;

    // Initialize population
    var population = this.initPopulation(inventory);

    // Score all individuals
    var self = this;
    var scores = population.map(function(ind) {
      return self._scoreIndividual(ind, playerCount, flagCount, weights, targets);
    });

    var bestScore = Math.max.apply(null, scores);
    var bestIndividual = population[scores.indexOf(bestScore)].clone();
    var generation = 0;

    // Report initial state
    onProgress({ score: bestScore, iterations: generation, elapsed: Date.now() - startTime });

    while (Date.now() - startTime < timeLimit) {
      generation++;

      // Evolve
      population = this.nextGeneration(population, scores);

      // Re-score new generation
      scores = population.map(function(ind) {
        return self._scoreIndividual(ind, playerCount, flagCount, weights, targets);
      });

      // Track best
      var genBest = Math.max.apply(null, scores);
      if (genBest > bestScore) {
        bestScore = genBest;
        bestIndividual = population[scores.indexOf(genBest)].clone();
      }

      onProgress({ score: bestScore, iterations: generation, elapsed: Date.now() - startTime });
    }

    return bestIndividual;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { GeneticAlgorithm };
}
