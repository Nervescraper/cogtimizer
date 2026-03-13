importScripts(
  'BoostPositions.js',
  'CogInventory.js',
  'IncrementalScorer.js',
  'SeededRng.js',
  'GreedyInit.js',
  'Serializer.js',
  'Solver.js',
  'StepOptimizer.js'
);

let cancelled = false;
let workerBest = null;

self.onmessage = function(e) {
  const { command } = e.data;

  if (command === 'cancel') {
    cancelled = true;
    return;
  }

  if (command === 'solve') {
    cancelled = false;
    const { inventory: serializedInv, algorithm, settings } = e.data;

    // Deserialize
    const inventory = deserialize(serializedInv);

    // Greedy init
    const weights = settings.weights || { buildRate: 1, expBonus: 1, flaggy: 1 };
    const targets = settings.targets || null;
    const greedyState = greedyInit(inventory, weights, targets);

    const playerCount = inventory.playerCount || 10;
    const flagCount = Math.max(inventory.flagPose.length, 1);

    // Post greedy result as first progress
    self.postMessage({
      type: 'progress',
      score: getScoreSum(greedyState.score, weights, targets, playerCount, flagCount),
      elapsed: 0,
      iterations: 0,
      phase: 'greedy'
    });

    // For now, run the existing SA solver synchronously
    // Phase 2 will add algorithm selection and incremental scoring integration
    const startTime = Date.now();

    self.postMessage({
      type: 'done',
      inventory: serialize(greedyState),
      score: getScoreSum(greedyState.score, weights, targets, playerCount, flagCount),
      stats: { elapsed: Date.now() - startTime, iterations: 0 }
    });
  }
};
