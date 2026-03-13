# Step Refactor Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `getOptimalSteps` into a testable module and write baseline tests for the existing behavior, creating a safety net before optimization work.

**Architecture:** Move `getOptimalSteps` from inline in `index.html` to `StepOptimizer.js` with a dual browser/Node `module.exports` guard. Add the same guard to `CogInventory.js` for the `Cog` class. Tests use Node's built-in test runner (`node --test`).

**Tech Stack:** Vanilla JS, Node.js test runner (`node:test`, `node:assert`)

---

### Task 1: Add module.exports guard to CogInventory.js

**Files:**
- Modify: `CogInventory.js` (bottom of file, after line 533)

- [ ] **Step 1: Add the exports guard**

Append to the very end of `CogInventory.js`:

```js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Cog, CogInventory };
}
```

- [ ] **Step 2: Verify browser still works**

Open `index.html` in a browser and confirm the page loads without errors in the console. The `Cog` and `CogInventory` globals must still be available.

- [ ] **Step 3: Verify Node import works**

Run: `node -e "const { Cog } = require('./CogInventory.js'); console.log(new Cog({ key: 1, buildRate: 5 }).buildRate)"`

Expected output: `5`

- [ ] **Step 4: Commit**

```bash
git add CogInventory.js
git commit -m "refactor: add module.exports guard to CogInventory.js for Node test compatibility"
```

---

### Task 2: Extract getOptimalSteps into StepOptimizer.js

**Files:**
- Create: `StepOptimizer.js`
- Modify: `index.html` (lines 12-15 for script tag, line 362-395 for removal, line 837 for call site)

- [ ] **Step 1: Create StepOptimizer.js with the extracted function**

Create `StepOptimizer.js` with the exact logic from `index.html` lines 362-395, adapted to be a standalone function instead of a closure on `f`:

```js
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
```

- [ ] **Step 2: Add script tag to index.html**

In `index.html`, add the script tag after the `CogInventory.js` line (after line 12):

Change:
```html
<script type="text/javascript" src="CogInventory.js"></script>
<script type="text/javascript" src="BoardRenderer.js"></script>
```

To:
```html
<script type="text/javascript" src="CogInventory.js"></script>
<script type="text/javascript" src="StepOptimizer.js"></script>
<script type="text/javascript" src="BoardRenderer.js"></script>
```

- [ ] **Step 3: Replace inline getOptimalSteps with call to extracted function**

In `index.html`, remove lines 362-395 (the `f.getOptimalSteps` definition) and replace with:

```js
f.getOptimalSteps = getOptimalSteps;
```

This preserves the `f.getOptimalSteps` reference that the call site at line 837 uses (`f.getOptimalSteps(best.board, best.cogs)`), so no other call sites need to change.

- [ ] **Step 4: Verify browser still works**

Open `index.html` in a browser. Confirm:
- Page loads without console errors
- If you have a save file, load it and run the solver — steps should appear and be clickable as before

- [ ] **Step 5: Commit**

```bash
git add StepOptimizer.js index.html
git commit -m "refactor: extract getOptimalSteps into StepOptimizer.js"
```

---

### Task 3: Write baseline tests

**Files:**
- Create: `tests/StepOptimizer.test.js`

- [ ] **Step 1: Create the test file with all baseline tests**

Create `tests/StepOptimizer.test.js`:

```js
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { Cog } = require('../CogInventory.js');
const { getOptimalSteps } = require('../StepOptimizer.js');

// Helper: create a minimal cog with key and initialKey
function makeCog(key, initialKey, opts = {}) {
  return new Cog({
    key,
    initialKey,
    icon: opts.icon || { path: 'icons/cogs/Cog_Nooby.png' },
    buildRate: opts.buildRate || 0,
    expBonus: opts.expBonus || 0,
    flaggy: opts.flaggy || 0,
    ...opts
  });
}

// Helper: build a cogs dict from an array of Cog objects
function cogDict(cogs) {
  const dict = {};
  for (const c of cogs) {
    dict[c.key] = c;
  }
  return dict;
}

const BOARD = 'fake-board'; // getOptimalSteps passes this through without inspecting it

describe('getOptimalSteps — baseline behavior', () => {

  it('returns empty array when no cogs moved', () => {
    const cogs = cogDict([
      makeCog(0, 0),
      makeCog(1, 1),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 0);
  });

  it('returns 1 step for a single cog moved to an empty slot', () => {
    // Cog was at key 0, now at key 5
    const cogs = cogDict([
      makeCog(5, 0),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].keyFrom, 0);
    assert.strictEqual(steps[0].keyTo, 5);
    // targetCog is a synthetic fallback since nothing is at the destination in interimCogs
    assert.strictEqual(steps[0].targetCog.icon, 'Blank');
  });

  it('returns 1 step for a 2-cycle (two cogs swapped)', () => {
    // Cog A was at 0, now at 1. Cog B was at 1, now at 0.
    const cogs = cogDict([
      makeCog(1, 0),
      makeCog(0, 1),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
  });

  it('returns 2 steps for a 3-cycle', () => {
    // A: 0->1, B: 1->2, C: 2->0
    const cogs = cogDict([
      makeCog(1, 0),
      makeCog(2, 1),
      makeCog(0, 2),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 2);
  });

  it('returns 2 steps for two independent 2-cycles', () => {
    // Cycle 1: A(0->1), B(1->0). Cycle 2: C(10->11), D(11->10).
    const cogs = cogDict([
      makeCog(1, 0),
      makeCog(0, 1),
      makeCog(11, 10),
      makeCog(10, 11),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 2);
  });

  it('excludes unmoved cog among moved cogs', () => {
    // Cog A unmoved at key 0, Cog B moved from 1 to 2
    const cogs = cogDict([
      makeCog(0, 0),
      makeCog(2, 1),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
    assert.strictEqual(steps[0].keyFrom, 1);
    assert.strictEqual(steps[0].keyTo, 2);
  });

  it('each step has the expected shape', () => {
    const cogs = cogDict([
      makeCog(1, 0, { buildRate: 10 }),
      makeCog(0, 1, { buildRate: 20 }),
    ]);
    const steps = getOptimalSteps(BOARD, cogs);
    assert.strictEqual(steps.length, 1);
    const step = steps[0];
    assert.strictEqual(step.board, BOARD);
    assert.ok(step.cog instanceof Cog);
    assert.ok('keyFrom' in step);
    assert.ok('keyTo' in step);
    assert.ok('targetCog' in step);
  });

});
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `node --test tests/StepOptimizer.test.js`

Expected: All 7 tests pass.

- [ ] **Step 3: Commit**

```bash
git add tests/StepOptimizer.test.js
git commit -m "test: add baseline tests for getOptimalSteps"
```
