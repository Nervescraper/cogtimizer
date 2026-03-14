# Release Notes

## March 13, 2026

- The solver now runs **three different optimization algorithms** at the same time (Simulated Annealing, Tabu Search, and Genetic Algorithm) and picks the best result — you'll see noticeably better boards, especially for flaggy-heavy setups
- **World 7 Tiny Cogs** are now rendered in side columns flanking the main board, and their multipliers are correctly factored into the displayed stat values so the build rate, XP, and flaggy numbers you see actually match what you'd get in-game
- **Solution history** keeps track of every solve run so you can compare results and load whichever one you like best — the currently shown solution is highlighted in the table, and dominated solutions (ones that are strictly worse than another run) get crossed out automatically
- New **Balanced mode** tries to find a solution that gets within 90% of the theoretical maximum for each stat at the same time, so you don't have to sacrifice one stat entirely for another — use **Custom strategy** if you want to set your own priority weights
- The solver uses your **actual player and flag count** from your data instead of assuming 10 players and 4 flags, so the scoring matches your account
- **Theoretical maximum** values for each stat are now calculated automatically when you load your data, so you can see how close your current board is to the best possible arrangement
- Rearranging your board takes **fewer steps** overall because the optimizer no longer chains moves through spare inventory positions unnecessarily
- **Locked slots** and **flag positions** are now shown with overlay icons on the board so you can tell at a glance which positions the solver can't touch
- **Quick-run strategy buttons** appear after your theoretical maximums are calculated — run Balanced, XP Focused, or Flaggy Push directly without opening settings
- **Cog Shelf** is now visible to the left of the board showing all 12 cog making slots with Nooby/Decent/Superb/Ultimate tier labels — step replay updates it so you can see players moving in and out
- **Player labels** — each player cog shows a short letter+digit label (e.g. M, D1, D2) so you can tell them apart at a glance, with full name and class on hover
- **Report Bug button** in the top bar lets you describe an issue and send a report with a screenshot and your cog data attached — no account needed
- **Settings panel** is accessible from the Loader tab so you can configure solve time and strategy before loading your data
