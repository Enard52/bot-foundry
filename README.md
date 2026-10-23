# Bot Foundry

Design combat robots in a real CAD workshop, then fight them with real physics.

You draw 2D profiles, extrude and revolve them into plates, billets and wedges, and drag motors, batteries and wheels onto the frame. Each part carves its own pocket and bolt holes into whatever it's mounted to. The workshop always knows the robot's true mass, centre of mass and inertia, because every number comes from the geometry and the material, not from a lookup table.

The physics side treats a robot the way an engineer would. Plates are made of real alloys with real yield strengths. Bolts are rated to ISO 898-1 and welds to EN 1993-1-8, so a joint lets go when the load through it says it should. The plan is for batteries to sag, speed controllers to current-limit, and anything you build in the control graph (a PID loop on a lifter, gyro-assisted steering) to behave like it would on the bench.

> **Status: early.** The CAD kernel and the workshop work today. The solver core simulates rigid bodies, joints and rated bolts and welds, but it isn't wired into fights yet. See the [roadmap](docs/ROADMAP.md).

## Try it

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5174 and press **Sample** to load a wedge robot, or **New sketch** to start from nothing.

You need Node 20 or newer and pnpm 10.

## What's in the box

| Package | What it does |
|---|---|
| [`packages/model`](packages/model) | The shared schema: robot designs, materials, fastener and weld ratings, the component catalog, and the compiled physical model. Plain JSON, SI units. |
| [`packages/cad`](packages/cad) | Sketch and feature kernel on [manifold](https://github.com/elalish/manifold): profiles with arcs, extrude with draft, revolve, mirror, pattern, booleans, component carving, exact mass properties. |
| [`packages/physics`](packages/physics) | Deterministic constraint solver based on Augmented Vertex Block Descent: rigid bodies, contacts with friction, joints, and rated bolts and welds that report the load they carry and break when it's too much. |
| [`apps/workshop`](apps/workshop) | The garage, a browser app built on three.js. |

The CAD kernel and the solver never see each other's internals. CAD compiles a design into a physical model, and the solver consumes only that. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains why it's built this way.

## Working on it

```bash
pnpm test        # every package's tests
pnpm typecheck   # TypeScript project build
pnpm bench       # CAD boolean timing and solver step timing
```

Contributions are welcome. Start with [CONTRIBUTING.md](CONTRIBUTING.md).

## License

[Apache License 2.0](LICENSE)
