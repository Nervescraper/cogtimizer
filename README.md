# Cogtimizer

Automatic cog board optimizer for [Legends of Idleon](https://www.legendsofidleon.com/). Finds optimal cog arrangements using simulated annealing, tabu search, and genetic algorithms. All calculations run client-side.

**Live:** https://nervescraper.github.io/cogtimizer/

## Usage

1. Paste your Idleon save JSON or enter your username
2. Click **Load**, then **Solve**
3. Follow the step-by-step instructions to rearrange your cog board

## Fork changes

This fork includes fixes stalled upstream plus:

- **Step optimizer redesign** — replaced cycle-decomposition with selection sort over board positions, fixing empty-slot and inflated step-count bugs
- **Solver improvements** — simulated annealing, tabu search, and genetic algorithm solvers
- **Blank slot fix** — step replay now correctly handles cogs displaced by spare/build replacements

## Credits

Original project by [Monoblos](https://github.com/Monoblos/cogtimizer). Upstream fixes from [Thefrank](https://github.com/Thefrank/cogtimizer).

"Press Start" font by codeman38 | cody@zone38.net | http://www.zone38.net/
