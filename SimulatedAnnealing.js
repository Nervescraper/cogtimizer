// SimulatedAnnealing.js

if (typeof require !== 'undefined') {
  var _seededRngMod = require('./SeededRng.js');
  SeededRng = _seededRngMod.SeededRng;
  var _solverMod = require('./Solver.js');
  getScoreSum = _solverMod.getScoreSum;
}

var ADAPTIVE_WINDOW = 500;
var PROGRESS_INTERVAL_MS = 500;

/**
 * Default settings for the improved Simulated Annealing algorithm.
 */
var SA_DEFAULTS = {
  coolingTarget: 0.30,
  staleLimit: 5000,
  reheatFactor: 0.5,
  boardSpareRatio: 0.3
};

/**
 * Improved Simulated Annealing solver implementing the SolverAlgorithm interface.
 *
 * Key improvements over Solver.js:
 * - Uses IncrementalScorer instead of full recompute on every swap (O(1)-O(12) vs O(96))
 * - Weighted neighborhood: 70% board-board, 30% board-spare, skips fixed/build cogs
 * - Adaptive cooling: adjusts rate every 500 iterations to maintain ~30% acceptance
 * - Reheat on stall: bumps temp to reheatFactor * initialTemp after staleLimit iterations
 *   without losing the current best solution
 * - SeededRng for reproducible results given the same seed
 */
class SimulatedAnnealing {
  /**
   * @param {IncrementalScorer} scorer - Scoring engine wrapping the initial inventory
   * @param {Object} settings - Overrides for SA_DEFAULTS. Also accepts:
   *   - seed {number}: RNG seed for reproducibility
   *   - weights {Object}: { buildRate, expBonus, flaggy } for weighted scoring
   *   - targets {Object}: { buildRate, expBonus, flaggy } for target-based scoring
   */
  constructor(scorer, settings) {
    this.scorer = scorer;
    this.settings = Object.assign({}, SA_DEFAULTS, settings);
  }

  static get displayName() { return 'Simulated Annealing'; }
  static get description() {
    return 'Fast stochastic optimizer. Uses adaptive cooling and reheat to escape local optima.';
  }

  /**
   * Compute the starting temperature based on the current score magnitude.
   * @param {Object} score - 5-field score object from IncrementalScorer
   * @param {Object|null} weights - { buildRate, expBonus, flaggy }
   * @param {Object|null} targets - { buildRate, expBonus, flaggy }
   * @param {number} playerCount
   * @param {number} flagCount
   * @returns {number} Starting temperature
   */
  _computeInitialTemp(score, weights, targets, playerCount, flagCount) {
    if (targets) {
      // Target mode: scores are in [0, 1], use small fixed temperature
      return 0.05;
    }
    var scalar = getScoreSum(score, weights, null, playerCount, flagCount);
    // 5% of score magnitude, floored at 100 to avoid zero/tiny temps
    return Math.max(Math.abs(scalar) * 0.05, 100);
  }

  /**
   * Select two positions to swap using the weighted neighborhood strategy.
   *
   * 70% board-board: both positions from availableSlotKeys (key < 96).
   * 30% board-spare: one board position + one spare position (key >= 108).
   *
   * Fixed cogs and build-area cogs are never selected.
   *
   * @param {CogInventory} inventory
   * @param {SeededRng} rng
   * @returns {[number, number]} [posA, posB] - two distinct positions to swap
   */
  _pickMove(inventory, rng) {
    var boardSlots = inventory.availableSlotKeys; // key < 96, non-fixed
    var isSpareMove = rng.random() < this.settings.boardSpareRatio;

    if (isSpareMove) {
      // Board-spare: pick one board position + one spare cog key
      var spareKeys = inventory.cogKeys.filter(function(k) { return Number(k) >= 108; });
      if (spareKeys.length === 0) {
        // Fall back to board-board if no spare cogs
        return this._pickBoardBoardMove(inventory, boardSlots, rng);
      }
      var posA = rng.pick(boardSlots);
      var posB = Number(rng.pick(spareKeys));
      // Validate: posA cog must not be fixed; posB cog must not be fixed or build-area
      var cogA = inventory.get(posA);
      var cogB = inventory.get(posB);
      if ((cogA && cogA.fixed) || (cogB && cogB.fixed)) {
        // Retry once with a plain board-board move rather than looping
        return this._pickBoardBoardMove(inventory, boardSlots, rng);
      }
      if (cogB && cogB.position && cogB.position().location === 'build') {
        return this._pickBoardBoardMove(inventory, boardSlots, rng);
      }
      return [posA, posB];
    }

    return this._pickBoardBoardMove(inventory, boardSlots, rng);
  }

  /**
   * Pick two distinct non-fixed board positions for a board-board swap.
   * @param {CogInventory} inventory
   * @param {number[]} boardSlots
   * @param {SeededRng} rng
   * @returns {[number, number]}
   */
  _pickBoardBoardMove(inventory, boardSlots, rng) {
    var posA, posB, cogA, cogB, attempts;

    attempts = 0;
    do {
      posA = rng.pick(boardSlots);
      cogA = inventory.get(posA);
      attempts++;
    } while (cogA && cogA.fixed && attempts < 20);

    attempts = 0;
    do {
      posB = rng.pick(boardSlots);
      cogB = inventory.get(posB);
      attempts++;
    } while ((posB === posA || (cogB && cogB.fixed)) && attempts < 20);

    return [posA, posB];
  }

  /**
   * Adjust the cooling rate to maintain the target acceptance rate.
   *
   * If actual acceptance > target: cool faster (rate gets smaller).
   * If actual acceptance < target: cool slower (rate gets larger).
   *
   * @param {number} currentRate - Current cooling multiplier (e.g. 0.9997)
   * @param {number} actualAcceptance - Observed acceptance rate in recent window
   * @param {number} targetAcceptance - Desired acceptance rate (e.g. 0.30)
   * @returns {number} Adjusted cooling rate
   */
  _adaptCooling(currentRate, actualAcceptance, targetAcceptance) {
    var error = actualAcceptance - targetAcceptance;
    // Scale the adjustment: large error -> larger correction
    var adjustment = error * 0.0001;
    var newRate = currentRate - adjustment;
    // Clamp to safe range: [0.99, 0.9999]
    return Math.max(0.99, Math.min(0.9999, newRate));
  }

  /**
   * Returns true if the algorithm has stalled for long enough to warrant reheating.
   * @param {number} itersSinceImprovement - Iterations since last best score improvement
   * @returns {boolean}
   */
  _shouldReheat(itersSinceImprovement) {
    return itersSinceImprovement >= this.settings.staleLimit;
  }

  /**
   * Compute the reheated temperature.
   * Preserves the current solution - only the temperature is reset.
   * @param {number} initialTemp - The temperature used at the start of the run
   * @returns {number} New temperature after reheat
   */
  _applyReheat(initialTemp) {
    return initialTemp * this.settings.reheatFactor;
  }

  /**
   * Execute one SA iteration: pick a move, apply it, accept or reject.
   *
   * On accept: the scorer's internal state advances to the new position.
   * On reject: the swap is undone (swap again = undo, per IncrementalScorer semantics).
   *
   * @param {CogInventory} inventory - Current board state (mutated in place on accept)
   * @param {Object|null} weights - Score weights
   * @param {Object|null} targets - Score targets (mutually exclusive with weights)
   * @param {number} playerCount
   * @param {number} flagCount
   * @param {number} temperature - Current annealing temperature
   * @param {SeededRng} rng
   * @param {number} currentScalar - Current score as a scalar
   * @returns {{ accepted: boolean, newScalar: number }}
   */
  _step(inventory, weights, targets, playerCount, flagCount, temperature, rng, currentScalar) {
    var move = this._pickMove(inventory, rng);
    var posA = move[0];
    var posB = move[1];

    // Apply the swap via IncrementalScorer
    this.scorer.swap(posA, posB);

    var newScalar = getScoreSum(this.scorer.score, weights, targets, playerCount, flagCount);
    var delta = newScalar - currentScalar;

    var accepted = delta > 0 || rng.random() < Math.exp(delta / temperature);

    if (!accepted) {
      // Undo the swap (applying same swap twice restores original state)
      this.scorer.swap(posA, posB);
      return { accepted: false, newScalar: currentScalar };
    }

    return { accepted: true, newScalar: newScalar };
  }

  /**
   * Run the simulated annealing solver.
   *
   * @param {CogInventory} inventory - Initial board state
   * @param {number} timeLimit - Time budget in milliseconds
   * @param {function} onProgress - Called every ~500ms with { score, iterations, elapsed }
   * @returns {CogInventory} Best solution found
   */
  solve(inventory, timeLimit, onProgress) {
    var rng = new SeededRng(this.settings.seed || Date.now());

    var playerCount = inventory.playerCount || 10;
    var flagCount = Math.max((inventory.flagPose || []).length, 1);
    var weights = this.settings.weights || { buildRate: 1, expBonus: 1, flaggy: 1 };
    var targets = this.settings.targets || null;

    // Initialize incremental scorer from the provided inventory state
    this.scorer.fullRecompute();
    var currentScalar = getScoreSum(this.scorer.score, weights, targets, playerCount, flagCount);

    var initialTemp = this._computeInitialTemp(
      this.scorer.score, weights, targets, playerCount, flagCount
    );
    var temperature = initialTemp;
    var coolingRate = 0.9997;

    // Track best solution
    var bestScalar = currentScalar;
    var bestInventory = inventory.clone();

    var iterations = 0;
    var itersSinceImprovement = 0;
    var windowAccepted = 0;
    var windowTotal = 0;
    var lastProgressTime = Date.now();
    var startTime = Date.now();

    while (Date.now() - startTime < timeLimit) {
      var result = this._step(
        inventory, weights, targets, playerCount, flagCount, temperature, rng, currentScalar
      );

      currentScalar = result.newScalar;
      iterations++;
      windowTotal++;
      if (result.accepted) windowAccepted++;

      // Track best solution
      if (currentScalar > bestScalar) {
        bestScalar = currentScalar;
        bestInventory = inventory.clone();
        itersSinceImprovement = 0;
      } else {
        itersSinceImprovement++;
      }

      // Reheat if stalled
      if (this._shouldReheat(itersSinceImprovement)) {
        temperature = this._applyReheat(initialTemp);
        itersSinceImprovement = 0;
      } else {
        temperature *= coolingRate;
      }

      // Adaptive cooling: adjust rate every ADAPTIVE_WINDOW iterations
      if (windowTotal >= ADAPTIVE_WINDOW) {
        var actualAcceptance = windowAccepted / windowTotal;
        coolingRate = this._adaptCooling(coolingRate, actualAcceptance, this.settings.coolingTarget);
        windowAccepted = 0;
        windowTotal = 0;
      }

      // Progress callback
      var now = Date.now();
      if (now - lastProgressTime >= PROGRESS_INTERVAL_MS) {
        onProgress({ score: bestScalar, iterations: iterations, elapsed: now - startTime });
        lastProgressTime = now;
      }
    }

    return bestInventory;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SimulatedAnnealing, SA_DEFAULTS };
}
