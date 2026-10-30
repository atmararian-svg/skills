---
name: gooey-grid
description: Build the gooey / metaball dot-grid effect (SDF smooth union in a WebGL2 fragment shader) and the floating glass control panel that goes with it, as seen on patch.nrly.fun ("Patch Lab"). Dots on a diagonal lattice melt into each other under the cursor, ripple on click, and can be "patched" with drawn links; a glass "module" holds swatches, effect chips, segmented controls, faders and switches. Use when someone wants a gooey/liquid/metaball grid, blobs that merge, an interactive generative hero background, a "patch lab"-style toy, an SDF shader playground, or that style of control panel (glass sidebar with sliders and toggles) for any creative-coding project.
---

# Gooey dot grid + control module

Reference: https://patch.nrly.fun/ ("Patch Lab", by Kables). Full teardown of how it works:
`reference/breakdown.md` (read it before changing the shader, the physics or the panel). Working starter you
copy and build on: `template/index.html` (single file, no build, no dependencies besides Google Fonts).

## What it is, in one paragraph
A **2D signed distance field rendered by one full-screen fragment shader**. Dots are circles, links are capsules,
and a **cubic smooth-min** (`smin`) blends them, which is what makes them look like liquid ("gooey / metaball
effect"). The CPU runs a small spring simulation per lattice cell (link strength, dot swell, dot offset), packs it
into an RGBA8 texture (one texel per cell) every frame, and the shader reads it with `texelFetch`. The lattice is
diagonal: dots where `i+j` is even, each cell owns one diagonal link.

## Workflow
1. Copy `template/index.html` into the project. Open it in a browser; it should run as is.
2. Restyle: edit `PALETTES` (bg, fg, accent, accentInk) and the CSS tokens at the top. Keep the panel structure.
3. Change what it shows: set `drawn[k]` cells (presets at `// ---- Presets ----`), or drive the target `tg`
   in `step()` from your own source (data, audio, scroll, time).
4. Add features from the breakdown as needed, in this order of payoff:
   ink flowing along drawn links, signal pulses, generators on a BPM clock, sound, fluid background tint.
5. Check in a real browser (Playwright works headless with
   `--use-gl=angle --use-angle=swiftshader --enable-unsafe-swiftshader`): no console errors, hover merges dots,
   click ripples, drag draws, each control changes the picture, mobile width collapses the panel.

## Rules that make it feel right (don't drop these)
- **Hysteresis on joins**: snap together above .42, release below .2, never rest half-joined.
- **Spring up, ease down**: overshoot when attaching, no bounce when letting go.
- **Brush = the segment the smoothed cursor moved this frame**, not a point; plus a decaying trail.
- **Two stubs below E=.5, one thickening neck above**, joined with hard `min` before `smin`.
- AA with `smoothstep(aa,-aa,d)`, `aa ≈ 1px` in lattice units; a little film grain.
- Idle loop: don't re-render when nothing moved; DPR capped at 1.5; overscan the lattice by 2 cells.
- `prefers-reduced-motion`: replace springs with plain easing, turn off CSS animation.

## The control panel (reuse it for any generative toy)
Glass module top-left (292 px, `backdrop-filter: blur(18px) saturate(1.3)`, radius 18, soft long shadow), header
with name + mono caps subtitle + Hide/Controls pill. Groups separated by 18 px, each with a **mono uppercase label
and a live `<output>` value on the right**. Components: palette swatches (bg tile + fg circle), pill chips with a
dot (`aria-pressed`), segmented control, faders (native range, gradient fill via `--p`, accent thumb with a dark
ring), iOS switch (`role=switch aria-checked`), 3-up buttons, hint with `<kbd>`. One settings object `S`; every
control writes to `S`; `fader(id,key,format,onChange)` wires a slider in one line. Collapses on ≤640 px. Extras on
the page: glass "Clear" pill top-right, mono readout bottom-right, a first-run hint pill that leaves after the first
use. Details and exact values: `reference/breakdown.md` §5.

## Don't
- Don't copy the Kables logo, name, "K grid" motif or their exact palette into someone else's project; the
  technique is general, the brand isn't.
- Don't use the CSS `blur()+contrast()` gooey trick as a substitute: it can't do controlled necks, AA or a
  transparent background.
