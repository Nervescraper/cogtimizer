// TabuSearch.js
if (typeof require !== 'undefined') {
  var _tabuListMod = require('./TabuList.js');
  TabuList = _tabuListMod.TabuList;
  var { getScoreSum } = require('./Solver.js');
}

/**
 * Tabu Search solver implementing the SolverAlgorithm interface.
 *
 * Core idea: at each step, evaluate N candidate swaps via incremental scoring
 * (apply -> read -> undo), pick the best non-tabu move, apply it, add it to
 * the tabu list. Aspiration: allow a tabu move if it produces a new global best.
 * Diversification: after many steps without improvement, perturb and clear the list.
 */
class TabuSearch {
  /**
   * @param {import('./IncrementalScorer.js').IncrementalScorer} scorer
   * @param {Object} settings
   * @param {number} [settings.sampleSize=200]   Candidate moves evaluated per step
   * @param {number} [settings.tabuTenure=50]    Steps a move stays tabu
   * @param {number} [settings.diversifyAfter=1000] Steps without improvement before perturb
   * @param {number} [settings.perturbSize=8]    Random swaps applied during perturbation
   * @param {Object} [settings.rng]              SeededRng instance (optional; falls back to Math.random)
   * @param {Object} [settings.weights]          Score weights { buildRate, expBonus, flaggy }
   * @param {Object} [settings.targets]          Score targets { buildRate, expBonus, flaggy }
   */
  constructor(scorer, settings) {
    if (!settings) settings = {};
    this.scorer = scorer;
    this.sampleSize    = settings.sampleSize    ?? 200;
    this.tabuTenure    = settings.tabuTenure    ?? 50;
    this.diversifyAfter = settings.diversifyAfter ?? 1000;
    this.perturbSize   = settings.perturbSize   ?? 8;
    this._rng          = settings.rng           ?? { random: function() { return Math.random(); } };
    this._weights      = settings.weights       ?? { buildRate: 1, expBonus: 1, flaggy: 1 };
    this._targets      = settings.targets       ?? null;
    this._tabuList     = new TabuList(this.tabuTenure);
    this._bestInventory = null;
  }

  static get displayName() { return 'Tabu Search'; }
  static get description() {
    return 'Deterministic local search with short-term memory. Most consistent results between runs.';
  }

  /**
   * Compute a scalar score from the five-field score object.
   * Mirrors Solver.getScoreSum logic.
   * @param {Object} score  { buildRate, expBonus, flaggy, expBoost, flagBoost }
   * @param {number} playerCount
   * @param {number} flagCount
   * @returns {number}
   */
  _scalarScore(score, playerCount, flagCount) {
    return getScoreSum(score, this._weights, this._targets, playerCount, flagCount);
  }

  /**
   * Pick a random element from an array using the configured RNG.
   * @param {Array} arr
   * @returns {*}
   */
  _pick(arr) {
    return arr[Math.floor(this._rng.random() * arr.length)];
  }

  /**
   * Run the Tabu Search.
   * @param {import('./IncrementalScorer.js').IncrementalScorer} scorer
   *   The scorer already initialized to the starting board state.
   * @param {number} timeLimit Time budget in milliseconds.
   * @param {function} onProgress Called every ~500ms with { score, iterations, elapsed }.
   * @returns {Object} The best inventory clone found during the search.
   */
  solve(scorer, timeLimit, onProgress) {
    this.scorer = scorer;
    var inventory  = scorer.inventory;
    var playerCount = inventory.playerCount || 10;
    var flagCount   = Math.max((inventory.flagPose || []).length, 1);
    var allSlots    = inventory.availableSlotKeys;

    var startTime   = Date.now();
    var lastProgress  = startTime;
    var iterations    = 0;
    var stepsSinceImprovement = 0;

    // Score the initial state
    var currentScalar = this._scalarScore(scorer.score, playerCount, flagCount);
    var bestScalar    = currentScalar;
    var bestInventory = inventory.clone();

    this._tabuList.clear();

    while (Date.now() - startTime < timeLimit) {
      // --- Generate N candidate moves ---
      var bestCandidateScore = -Infinity;
      var bestCandidateA     = -1;
      var bestCandidateB     = -1;

      for (var s = 0; s < this.sampleSize; s++) {
        // Draw two distinct slot keys at random
        var posA = this._pick(allSlots);
        var posB = this._pick(allSlots);
        // Ensure distinct (retry once; collisions are rare)
        if (posB === posA) posB = this._pick(allSlots);
        if (posB === posA) continue;

        var isTabu = this._tabuList.has(posA, posB);

        // Apply swap
        scorer.swap(posA, posB);
        var candidateScalar = this._scalarScore(scorer.score, playerCount, flagCount);
        // Undo swap (symmetric)
        scorer.swap(posA, posB);

        // Aspiration: always allow if new global best
        var isGlobalBest = candidateScalar > bestScalar;

        if (isTabu && !isGlobalBest) continue; // skip tabu, non-improving

        if (candidateScalar > bestCandidateScore) {
          bestCandidateScore = candidateScalar;
          bestCandidateA     = posA;
          bestCandidateB     = posB;
        }
      }

      // If no viable candidate found (e.g., all candidates were tabu), skip step
      if (bestCandidateA === -1) {
        iterations++;
        stepsSinceImprovement++;
        // Check diversification even when no candidate found
        if (stepsSinceImprovement >= this.diversifyAfter) {
          this._perturb(scorer, allSlots);
          this._tabuList.clear();
          stepsSinceImprovement = 0;
          currentScalar = this._scalarScore(scorer.score, playerCount, flagCount);
        }
        continue;
      }

      // Apply the chosen move
      scorer.swap(bestCandidateA, bestCandidateB);
      currentScalar = bestCandidateScore;
      this._tabuList.add(bestCandidateA, bestCandidateB);
      iterations++;

      // Track global best
      if (currentScalar > bestScalar) {
        bestScalar    = currentScalar;
        bestInventory = inventory.clone();
        stepsSinceImprovement = 0;
      } else {
        stepsSinceImprovement++;
      }

      // Diversification check
      if (stepsSinceImprovement >= this.diversifyAfter) {
        this._perturb(scorer, allSlots);
        this._tabuList.clear();
        stepsSinceImprovement = 0;
        currentScalar = this._scalarScore(scorer.score, playerCount, flagCount);
      }

      // Progress callback ~every 500ms
      var now = Date.now();
      if (now - lastProgress >= 500) {
        onProgress && onProgress({
          score: bestScalar,
          iterations: iterations,
          elapsed: now - startTime,
        });
        lastProgress = now;
      }
    }

    // Store best found solution
    this._bestInventory = bestInventory;
    return bestInventory;
  }

  /**
   * Perform perturbSize random swaps to escape a local optimum.
   * @param {Object} scorer
   * @param {number[]} allSlots
   */
  _perturb(scorer, allSlots) {
    for (var i = 0; i < this.perturbSize; i++) {
      var posA = this._pick(allSlots);
      var posB = this._pick(allSlots);
      if (posB === posA) posB = this._pick(allSlots);
      if (posB === posA) continue;
      scorer.swap(posA, posB);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { TabuSearch };
}
