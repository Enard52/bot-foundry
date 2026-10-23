# Contributing

Thanks for wanting to help. A few things keep this project easy to work on.

## Setup

```bash
pnpm install
pnpm test
pnpm dev
```

## Ground rules

- **The contract is in `packages/model`.** CAD and physics only talk through it. If a change needs a new field, change the contract first and say why in the pull request.
- **SI units everywhere.** Metres, kilograms, seconds, newtons, radians. Name anything else explicitly (`throatMm` is fine, a bare `throat` in millimetres is not).
- **Physics changes come with a check.** If you touch the solver, add or update a test that compares against an analytic or published result: a pendulum period, a bolt load, a beam deflection. A claim about realism needs a number behind it.
- **Determinism is a feature.** No `Math.random`, wall-clock time or iteration-order tricks in solver state. The determinism test must keep passing.
- **Cite your sources.** If a formula comes from a paper or a standard, say which one in a comment.
- **Keep the build green.** `pnpm typecheck` and `pnpm test` pass before you open a pull request. If you change performance-sensitive code, include `pnpm bench` numbers from before and after.

## Good first areas

Check [docs/ROADMAP.md](docs/ROADMAP.md). The contract follow-ups at the bottom are small and self-contained.
