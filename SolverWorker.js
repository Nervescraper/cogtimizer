var _v = '?v=2';
importScripts(
  'BoostPositions.js' + _v,
  'CogInventory.js' + _v,
  'ExcogiaHelper.js' + _v,
  'IncrementalScorer.js' + _v,
  'SeededRng.js' + _v,
  'GreedyInit.js' + _v,
  'Serializer.js' + _v,
  'Solver.js' + _v,
  'StepOptimizer.js' + _v,
  'solvers/TabuList.js' + _v,
  'solvers/SimulatedAnnealing.js' + _v,
  'solvers/TabuSearch.js' + _v,
  'solvers/BlockCrossover.js' + _v,
  'solvers/GeneticAlgorithm.js' + _v
);

var ALGORITHMS = {
  sa: SimulatedAnnealing,
  tabu: TabuSearch,
  ga: GeneticAlgorithm
};

self.onmessage = function(e) {
  var data = e.data;

  if (data.command === 'solve') {
    try {
      var serializedInv = data.inventory;
      var algorithmKey = data.algorithm || 'sa';
      var settings = data.settings || {};
      var timeLimit = data.timeLimit || 2500;

      // Deserialize and greedy init
      var inventory = deserialize(serializedInv);
      var weights = settings.weights || { buildRate: 1, expBonus: 1, flaggy: 1 };
      var targets = settings.targets || null;
      var greedyState = greedyInit(inventory, weights, targets);

      var playerCount = inventory.playerCount || 10;
      var flagCount = Math.max(inventory.flagPose.length, 1);

      var greedyScore = getScoreSum(greedyState.score, weights, targets, playerCount, flagCount);

      // Post greedy result as first progress
      self.postMessage({
        type: 'progress',
        score: greedyScore,
        elapsed: 0,
        iterations: 0,
        phase: 'greedy'
      });

      // Set up and run the selected algorithm
      var AlgorithmClass = ALGORITHMS[algorithmKey];
      if (!AlgorithmClass) {
        self.postMessage({
          type: 'done',
          inventory: serialize(greedyState),
          score: greedyScore,
          algorithm: algorithmKey,
          stats: { elapsed: 0, iterations: 0 }
        });
        return;
      }

      var algoSettings = {
        weights: weights,
        targets: targets,
        seed: Date.now()
      };
      var algo = new AlgorithmClass(algoSettings);

      var scorer = new IncrementalScorer(greedyState);
      scorer.fullRecompute();

      var startTime = Date.now();
      var bestResult = algo.solve(scorer, timeLimit, function(progress) {
        self.postMessage({
          type: 'progress',
          score: progress.score,
          elapsed: progress.elapsed,
          iterations: progress.iterations,
          phase: algorithmKey
        });
      });

      var finalScore = getScoreSum(bestResult.score, weights, targets, playerCount, flagCount);

      // If algorithm didn't improve on greedy, return greedy
      if (finalScore < greedyScore) {
        bestResult = greedyState;
        finalScore = greedyScore;
      }

      self.postMessage({
        type: 'done',
        inventory: serialize(bestResult),
        score: finalScore,
        algorithm: algorithmKey,
        stats: { elapsed: Date.now() - startTime, iterations: 0 }
      });
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: err.message || String(err),
        algorithm: data.algorithm || 'sa'
      });
    }
  }
};
