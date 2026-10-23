# Roadmap

Each step has a check that decides whether it's done. Numbers below are measured on a laptop (Apple Silicon, Node 22) unless noted.

## Done

- **Contract.** Design and physical-model schema, material table, bolt and weld ratings, starter component catalog.
- **CAD kernel.** Sketch profiles with arcs, extrude with draft, revolve, mirror, pattern, booleans, component carving with bolt holes, exact mass properties, compile to the physical model. Moving a carved motor re-evaluates in about 3 ms (target: under 16 ms).
- **Workshop.** Sketching on planes and faces, extrude and revolve dialogs, drag-in parts with a gizmo and carve toggle, live mass properties, undo, save and JSON import/export.
- **Solver core.** Rigid bodies, hull contacts with friction, fixed, hinge, slider and ball joints, rated bolts and welds that break after the solve, deterministic stepping. A mass hanging from one bolt reads its weight within 1 %.

## Next

1. **Solver speed.** Two robots (about 300 bodies and 1,000 bolts) currently take about 2.6 ms per 1 ms substep in TypeScript. Target: under 0.5 ms. Plan: struct-of-arrays layout and a WebAssembly SIMD core, with graph-coloured constraint batches.
2. **Plastic hinges.** Plates as cell lattices joined by yielding hinges with hardening and fracture. Check: a three-point bend and a drop-hammer dent within 15 % of reference force-displacement and absorbed energy.
3. **Spinners.** Analytic rotors with gyroscopic and reaction torque, tooth-strike impulses, rotation-aware collision checks. Check: no pass-throughs in 1,000 randomized strikes at 250 rad/s, energy error under 2 %.
4. **Electrical and control.** Battery, motor and speed-controller models, the control graph with PID, key and gamepad mapping. Check: spin-up time and current within 10 % of a published reference case.
5. **Bolt behaviour.** Preload, friction slip before shear, and bending moment in the rating check.
6. **Convex decomposition** of carved bodies for contact, instead of one hull per body.
7. **The arena.** Wire the workshop's compiled robots into the solver, with drivers, an AI pilot and match rules.

## Contract follow-ups

Collected from building the first three packages:

- Mark immovable parts explicitly in `PhysPart` instead of using zero mass.
- Document the sign of a bolt's `axis`.
- Report the bending moment a connection carries, so prying shows up in bolt tension.
- Add a `warnings` list to the compiled model for things compile currently drops silently, like an actuator with no speed controller.
- Give `ComponentDef` an optional material.
- Decide whether a `Wire` is one conductor or a supply and return pair.
- Export the kernel's plane and arc helpers so the sketcher and kernel share one implementation.
