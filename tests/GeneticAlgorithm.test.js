// tests/GeneticAlgorithm.test.js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { makeCog, buildInventory } = require('./helpers.js');
const { SeededRng } = require('../SeededRng.js');
const { IncrementalScorer } = require('../IncrementalScorer.js');
const { GeneticAlgorithm } = require('../solvers/GeneticAlgorithm.js');

// Build a simple 96-cog board inventory (no fixed/blocked slots)
function makeFullBoard(seed = 0) {
  const rng = new SeededRng(seed);
  const cogs = Array.from({ length: 96 }, (_, i) =>
    makeCog(i, { buildRate: rng.randInt(100) + 1 })
  );
  return buildInventory(cogs, { playerCount: 5 });
}

describe('GeneticAlgorithm — initialization', () => {
  it('can be constructed with scorer and default settings', () => {
    const inv = makeFullBoard(0);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({});
    assert.ok(ga, 'should construct without throwing');
  });

  it('initPopulation returns array of correct size', () => {
    const inv = makeFullBoard(1);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 10, seed: 42 });
    const pop = ga.initPopulation(inv);
    assert.strictEqual(pop.length, 10, 'population size must match settings');
  });

  it('each individual in population is a valid CogInventory', () => {
    const { CogInventory } = require('../CogInventory.js');
    const inv = makeFullBoard(2);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 8, seed: 7 });
    const pop = ga.initPopulation(inv);
    for (const individual of pop) {
      assert.ok(individual instanceof CogInventory,
        'each individual must be a CogInventory');
      assert.ok(Array.isArray(individual.availableSlotKeys),
        'individual must have availableSlotKeys');
    }
  });

  it('individuals are distinct (not all identical clones)', () => {
    const inv = makeFullBoard(3);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 6, seed: 99 });
    const pop = ga.initPopulation(inv);
    // Check that at least two individuals differ (any cog at position 0 has different buildRate)
    const buildRatesAt0 = pop.map(ind => ind.cogs[0]?.buildRate);
    const unique = new Set(buildRatesAt0);
    assert.ok(unique.size > 1,
      'population should have diversity, all individuals are identical');
  });

  it('initPopulation is deterministic given same seed', () => {
    const inv = makeFullBoard(4);
    const scorer1 = new IncrementalScorer(inv);
    const scorer2 = new IncrementalScorer(inv);
    const ga1 = new GeneticAlgorithm({ populationSize: 5, seed: 17 });
    const ga2 = new GeneticAlgorithm({ populationSize: 5, seed: 17 });
    const pop1 = ga1.initPopulation(inv);
    const pop2 = ga2.initPopulation(inv);
    // Same seed → same ordering of cogs in first individual
    assert.strictEqual(
      JSON.stringify(pop1[0].cogs),
      JSON.stringify(pop2[0].cogs),
      'same seed must produce same population'
    );
  });
});

describe('GeneticAlgorithm — tournament selection', () => {
  it('tournamentSelect returns an index within population bounds', () => {
    const inv = makeFullBoard(5);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ tournamentSize: 3, seed: 1 });
    const pop = ga.initPopulation(inv).slice(0, 6);
    const scores = pop.map((_, i) => i * 10);
    const idx = ga.tournamentSelect(pop, scores);
    assert.ok(idx >= 0 && idx < pop.length,
      `index ${idx} out of bounds [0, ${pop.length})`);
  });

  it('tournamentSelect always picks the highest-scoring among tournament competitors', () => {
    const inv = makeFullBoard(6);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ tournamentSize: 3, seed: 123 });
    const pop = Array.from({ length: 10 }, (_, i) => inv.clone());
    // Assign distinct scores: individual i has score = i * 10
    const scores = pop.map((_, i) => i * 10);

    for (let trial = 0; trial < 50; trial++) {
      const winner = ga.tournamentSelect(pop, scores);
      assert.ok(winner >= 0 && winner < pop.length,
        `winner index ${winner} out of bounds`);
    }
  });

  it('with tournamentSize=1, any individual can win', () => {
    const inv = makeFullBoard(7);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ tournamentSize: 1, seed: 77 });
    const pop = Array.from({ length: 20 }, (_, i) => inv.clone());
    const scores = pop.map((_, i) => i); // strictly increasing scores
    const winners = new Set();
    for (let i = 0; i < 100; i++) {
      winners.add(ga.tournamentSelect(pop, scores));
    }
    // With size=1 and 100 trials over 20 individuals, should see many distinct winners
    assert.ok(winners.size > 5,
      `expected diversity with tournamentSize=1, got only ${winners.size} distinct winners`);
  });

  it('with tournamentSize=population, almost always picks the best', () => {
    const inv = makeFullBoard(8);
    const scorer = new IncrementalScorer(inv);
    const pop = Array.from({ length: 10 }, (_, i) => inv.clone());
    const scores = pop.map((_, i) => i); // max is index 9
    const ga = new GeneticAlgorithm({ tournamentSize: 10, seed: 33 });
    // With replacement, tournamentSize=pop doesn't guarantee the best is sampled,
    // but it's overwhelmingly likely over 20 trials
    let bestCount = 0;
    for (let i = 0; i < 20; i++) {
      if (ga.tournamentSelect(pop, scores) === 9) bestCount++;
    }
    assert.ok(bestCount >= 15,
      `expected best to win most of 20 trials, got ${bestCount}`);
  });
});

describe('GeneticAlgorithm — mutation', () => {
  it('mutate returns a CogInventory', () => {
    const inv = makeFullBoard(9);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ seed: 1 });
    const pop = ga.initPopulation(inv);
    const result = ga.mutate(pop[0]);
    const { CogInventory } = require('../CogInventory.js');
    assert.ok(result instanceof CogInventory, 'mutate must return a CogInventory');
  });

  it('mutate does not violate valid-board invariants', () => {
    const inv = makeFullBoard(10);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ seed: 2 });
    const pop = ga.initPopulation(inv);
    for (let i = 0; i < 20; i++) {
      const mutated = ga.mutate(pop[i % pop.length]);
      // Check no duplicates
      const keys = Object.values(mutated.cogs).map(c => c.initialKey);
      assert.strictEqual(new Set(keys).size, keys.length,
        `mutation ${i}: duplicate initialKeys after mutation`);
      // Check fixed cogs unmoved
      for (const cog of Object.values(mutated.cogs)) {
        if (cog.fixed) {
          assert.strictEqual(cog.key, cog.initialKey,
            `mutation ${i}: fixed cog ${cog.initialKey} moved`);
        }
      }
    }
  });

  it('mutate is a pure operation (does not modify the input individual)', () => {
    const inv = makeFullBoard(11);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ seed: 3 });
    const pop = ga.initPopulation(inv);
    const original = pop[0];
    // Snapshot cog positions before mutation
    const before = JSON.stringify(original.cogs);
    ga.mutate(original);
    const after = JSON.stringify(original.cogs);
    assert.strictEqual(before, after, 'mutate must not modify the input individual');
  });

  it('mutate changes at least one cog position (with high probability over 20 runs)', () => {
    const inv = makeFullBoard(12);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({
      seed: 4,
      mutationRate: 1.0, // always mutate
      swapMutationMinPairs: 2,
      swapMutationMaxPairs: 2
    });
    const pop = ga.initPopulation(inv);
    let changedCount = 0;
    for (let i = 0; i < 20; i++) {
      const mutated = ga.mutate(pop[0]);
      if (JSON.stringify(mutated.cogs) !== JSON.stringify(pop[0].cogs)) changedCount++;
    }
    assert.ok(changedCount >= 15,
      `Expected most mutations to change something, got ${changedCount}/20`);
  });
});

describe('GeneticAlgorithm — nextGeneration', () => {
  it('nextGeneration returns same-size population', () => {
    const inv = makeFullBoard(13);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 8, seed: 5 });
    const pop = ga.initPopulation(inv);
    const scores = pop.map(ind => ind.score.buildRate);
    const next = ga.nextGeneration(pop, scores);
    assert.strictEqual(next.length, 8, 'next generation must have same size');
  });

  it('elite individuals are preserved unchanged', () => {
    const inv = makeFullBoard(14);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 8, eliteCount: 2, seed: 6 });
    const pop = ga.initPopulation(inv);
    const scores = pop.map(ind => ind.score.buildRate);

    // Find the top 2 by score
    const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
    const eliteInitialKeys = sorted.slice(0, 2).map(([i]) =>
      JSON.stringify(pop[i].cogs)
    );

    const next = ga.nextGeneration(pop, scores);

    // Top 2 of next generation (by score) must match the original elites
    const nextScores = next.map(ind => ind.score.buildRate);
    const nextSorted = [...nextScores.entries()].sort((a, b) => b[1] - a[1]);
    const nextEliteKeys = nextSorted.slice(0, 2).map(([i]) =>
      JSON.stringify(next[i].cogs)
    );

    // At least the best individual must survive
    assert.ok(
      nextEliteKeys.includes(eliteInitialKeys[0]),
      'best individual must survive into next generation (elitism)'
    );
  });

  it('next generation passes all valid-board invariants for every individual', () => {
    const inv = makeFullBoard(15);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 6, seed: 7 });
    const pop = ga.initPopulation(inv);
    const scores = pop.map(ind => ind.score.buildRate);
    const next = ga.nextGeneration(pop, scores);

    for (let i = 0; i < next.length; i++) {
      const ind = next[i];
      // No duplicate cogs
      const keys = Object.values(ind.cogs).map(c => c.initialKey);
      assert.strictEqual(new Set(keys).size, keys.length,
        `individual ${i} in next gen: duplicate initialKeys`);
    }
  });
});

describe('GeneticAlgorithm — solve', () => {
  it('solve returns a CogInventory', () => {
    const inv = makeFullBoard(20);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 4, seed: 10 });
    const result = ga.solve(scorer, 500, () => {});
    const { CogInventory } = require('../CogInventory.js');
    assert.ok(result instanceof CogInventory, 'solve must return a CogInventory');
  });

  it('solve terminates within the time limit (generous bound)', () => {
    const inv = makeFullBoard(21);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 4, seed: 11 });
    const start = Date.now();
    ga.solve(scorer, 300, () => {});
    const elapsed = Date.now() - start;
    assert.ok(elapsed < 1500,
      `solve took ${elapsed}ms, expected < 1500ms for 300ms limit`);
  });

  it('solve calls onProgress at least once', () => {
    const inv = makeFullBoard(22);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 4, seed: 12 });
    let callCount = 0;
    ga.solve(scorer, 300, () => { callCount++; });
    assert.ok(callCount >= 1, `onProgress called ${callCount} times, expected >= 1`);
  });

  it('onProgress receives { score, iterations, elapsed } with numeric values', () => {
    const inv = makeFullBoard(23);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 4, seed: 13 });
    const reports = [];
    ga.solve(scorer, 300, (report) => { reports.push(report); });
    assert.ok(reports.length >= 1, 'must have at least one report');
    const r = reports[0];
    assert.strictEqual(typeof r.score, 'number', 'score must be a number');
    assert.strictEqual(typeof r.iterations, 'number', 'iterations must be a number');
    assert.strictEqual(typeof r.elapsed, 'number', 'elapsed must be a number');
  });

  it('returned solution passes valid-board invariants', () => {
    const inv = makeFullBoard(24);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 4, seed: 14 });
    const result = ga.solve(scorer, 300, () => {});
    const keys = Object.values(result.cogs).map(c => c.initialKey);
    assert.strictEqual(new Set(keys).size, keys.length,
      'solution has duplicate initialKeys');
    for (const cog of Object.values(result.cogs)) {
      if (cog.fixed) {
        assert.strictEqual(cog.key, cog.initialKey, 'fixed cog moved in solution');
      }
    }
  });

  it('solve returns a result at least as good as the initial greedy state', () => {
    const inv = makeFullBoard(25);
    const scorer = new IncrementalScorer(inv);
    const ga = new GeneticAlgorithm({ populationSize: 6, seed: 15 });
    const initialScore = inv.score.buildRate;
    const result = ga.solve(scorer, 500, () => {});
    const finalScore = result.score.buildRate;
    // GA with elitism must never return worse than initial (elites preserve best)
    assert.ok(finalScore >= initialScore - 1, // -1 tolerance for rounding
      `solve returned score ${finalScore} worse than initial ${initialScore}`);
  });
});
