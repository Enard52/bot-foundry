# Workshop

The garage: draft combat robots in a sketch-and-feature CAD workshop, in the browser.
Vite + three.js on top of `@botfoundry/cad` (manifold-3d compiled to WASM) and the
`@botfoundry/model` contract.

```sh
pnpm --filter @botfoundry/workshop dev      # http://localhost:5174
pnpm --filter @botfoundry/workshop build
```

## Using it

- **New sketch** in the top bar: pick XZ (top), XY (side), YZ (front), an offset plane, or a face of
  an extruded body. The view switches to an orthographic look onto the plane.
- **Line / arc**: click to place points; click the start point (or press Enter) to close the loop.
  Hold `A` while placing a point for an arc and drag the bulge. Grid snap is 1 mm, 5 mm with Shift,
  with endpoint snap. Type a length in mm and press Enter (`25` or `25,45` for length and angle).
  A loop inside another loop becomes a hole. `R` rectangle, `C` circle, `Backspace` removes the last
  point, `Esc` drops the open loop and then leaves the sketch.
- **Finish sketch** opens the feature dialog: extrude (distance, taper, symmetric) or revolve (angle,
  axis picked from a line of the sketch), as a new body (name, material, plate / billet / tube) or
  added to, cut from or intersected with an existing body.
- **Catalog**: drag a part onto the robot or the ground; it lands on the surface under the cursor.
  `W` moves and `E` rotates with the gizmo (1 mm and 5 degree snaps). **Carve** cuts a part's keep-out
  and mounting holes out of the bodies it touches; a keep-out that overlaps a body without a carve is
  tinted red.
- `Ctrl/Cmd+Z` undo, `Shift+Ctrl/Cmd+Z` redo, `Del` removes the selection, `F` frames the robot.
- The design autosaves to this browser; Save and Load keep a named slot, Export and Import use JSON
  files in the `botfoundry/design@0` schema.

## Layout

```
src/geom/     pure math: planes, arcs and bulges, loops to profiles, snapping, inertia, placement
src/state/    Store (design, selection, undo), pure design edits (ops), persistence
src/kernel/   KernelSession: owns the CAD kernel, debounces evaluation
src/view/     three.js: viewport and cameras, scene sync from an Evaluation, sketch lines
src/tools/    sketch mode and the edit tool (picking, drop, gizmo)
src/ui/       panels: catalog and lists, inspector, feature dialog, mass, top bar
```

Everything that decides what the design is lives in `geom/` and `state/` and is covered by tests;
the DOM and three.js layers only render it and forward input.
