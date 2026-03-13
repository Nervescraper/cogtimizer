# Release Notes

## March 13, 2026

- The solver now runs three different optimization algorithms at the same time (Simulated Annealing, Tabu Search, and Genetic Algorithm) and picks the best result — you'll see noticeably better boards, especially for flaggy-heavy setups
- New balanced mode tries to find a solution that gets within 90% of the theoretical maximum for each stat at the same time, so you don't have to sacrifice one stat entirely for another — use Custom strategy if you want to set your own priority weights
- Solution history keeps track of every solve run so you can compare results and load whichever one you like best — dominated solutions (ones that are strictly worse than another run) get crossed out automatically
- Theoretical maximum values for each stat are now calculated automatically when you load your data, so you can see how close your current board is to the best possible arrangement
- Tiny cog multipliers (the ones in the build slots on the left and right) are now correctly factored into the displayed stat values, so the build rate, XP, and flaggy numbers you see actually match what you'd get in-game
- Rearranging your board takes fewer steps overall because the optimizer no longer chains moves through spare inventory positions unnecessarily
- Locked slots and flag positions are now shown with overlay icons on the board so you can tell at a glance which positions the solver can't touch
