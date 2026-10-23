# Roadmap

Each step has a check that decides whether it's done. Numbers below are measured on a laptop (Apple Silicon, Node 22) unless noted.

## Done

- **Contract.** Design and physical-model schema, material table, bolt and weld ratings, starter component catalog.
- **CAD kernel.** Sketch profiles with arcs, extrude with draft, revolve, mirror, pattern, booleans, component carving with bolt holes, exact mass properties, compile to the physical model. Moving a carved motor re-evaluates in about 3 ms (target: under 16 ms).
- **Workshop.** Sketching on planes and faces, extrude and revolve dialogs, drag-in parts with a gizmo and carve toggle, live mass properties, undo, save and JSON import/export.
- **Solver core.** Rigid bodies, hull contacts with friction, fixed, hinge, slider and ball joints, rated bolts and welds that break after the solve, deterministic stepping. A mass hanging from one bolt reads its weight within 1 %.
- **WebAssembly solver.** A Rust core with struct-of-arrays storage and SIMD, about 5× faster than the TypeScript solver and bit-identical to it. The TypeScript solver stays as the reference. Two robots (300 bodies, about 1,050 bolts) step in a median of 0.49 ms resting and 0.48 ms while landing from a 10 cm drop, against a 0.5 ms target. That margin is thin, so headroom is item 1 below.

## Next

1. **Solver headroom.** Get the two-robot step comfortably under 0.5 ms. Ideas in order: solve paired bodies' systems in SIMD lanes (estimated about 0.42 ms), colour the body graph for wider lane groups, and move stepping into a Web Worker so the frame budget doesn't depend on the main thread.
2. **Free-fall bug.** In the reference solver, a bolted assembly in pure free fall slowly spins up and bolts start breaking, on both backends. A freely falling rigid assembly should carry no load. Find out why before plastic hinges build on the same constraint code.
3. **Plastic hinges.** Plates as cell lattices joined by yielding hinges with hardening and fracture. Check: a three-point bend and a drop-hammer dent within 15 % of reference force-displacement and absorbed energy.
4. **Spinners.** Analytic rotors with gyroscopic and reaction torque, tooth-strike impulses, rotation-aware collision checks. Check: no pass-throughs in 1,000 randomized strikes at 250 rad/s, energy error under 2 %.
5. **Electrical and control.** Battery, motor and speed-controller models, the control graph with PID, key and gamepad mapping. Check: spin-up time and current within 10 % of a published reference case.
6. **Bolt behaviour.** Preload, friction slip before shear, and bending moment in the rating check.
7. **Convex decomposition** of carved bodies for contact, instead of one hull per body.
8. **The arena.** Wire the workshop's compiled robots into the solver, with drivers, an AI pilot and match rules.

## Contract follow-ups

Collected from building the first three packages:

- Mark immovable parts explicitly in `PhysPart` instead of using zero mass.
- Document the sign of a bolt's `axis`.
- Report the bending moment a connection carries, so prying shows up in bolt tension.
- Add a `warnings` list to the compiled model for things compile currently drops silently, like an actuator with no speed controller.
- Give `ComponentDef` an optional material.
- Decide whether a `Wire` is one conductor or a supply and return pair.
- Export the kernel's plane and arc helpers so the sketcher and kernel share one implementation.
