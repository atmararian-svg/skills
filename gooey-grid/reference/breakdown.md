# Teardown: patch.nrly.fun ("Patch Lab", Kables)

Read from the live page source on 2026-10-30. One HTML file, no framework, no build: inline CSS, inline JS,
WebGL2, Web Audio. ~74 KB. Everything below is how *that* page works; `../template/index.html` is a smaller
rewrite of the same technique you can build on.

## 1. What the effect is called

- **Gooey / metaball effect** is the common name for blobs that melt into each other.
- Technically it's a **2D signed distance field (SDF) with a smooth union** ("smooth-min", `smin`, Inigo Quilez's
  polynomial smin). Every dot is a circle SDF, every link is a capsule (segment) SDF, and `smin` blends them so
  the joins have no crease.
- It's drawn as a **single full-screen fragment shader** (one triangle that covers the screen). No DOM dots, no SVG,
  no canvas 2D. Each pixel finds the dots and links near it and computes the distance.
- The grid is a **diagonal (checkerboard / diamond) lattice**: dots on lattice points with `i+j` even, each dot
  linked to its 4 diagonal neighbours. That's what gives the "K"-like, cable-patch look.
- The theme (cables, jacks, patching, signal pulses) is a **modular synth patch bay** metaphor; the logo is
  the Kables mark.

Other names people search for: "liquid dot grid", "gooey dot matrix", "metaball grid shader", "SDF smooth union".
The CSS-only cousin is the `filter: blur() + contrast()` gooey trick (cheaper, blurrier, no control over necks).

## 2. Rendering pipeline

```
JS per frame                         GPU per frame
-----------                          -------------
simulate every cell (springs)  -->   upload 2 RGBA8 textures (N[0] x N[1], one texel per cell)
encode into Uint8 buffers            + 1 R8 "activity" texture
                                     draw 1 full-screen triangle -> fragment shader:
                                        pixel -> lattice coords
                                        loop 6x6 nearby dots   -> circle SDFs  -> smin
                                        loop 5x5 nearby cells  -> link capsules -> smin
                                        loop <=24 signal pulses -> bead SDFs   -> smin
                                        AA edge, colour, grain
(optional) fluid sim: 3 passes on a ~360px half-float FBO, sampled as background tint
```

### Coordinate system
- `sc = spacing * dpr` px per lattice unit. `N = ceil(canvas/sc)+4` cells each way (2-cell overscan so
  displaced dots at the edges never pop). Origin `O` centres the lattice.
- In the shader: `p = (fragCoord_flipped - O) / sc`, `c = floor(p)`.

### State texture `uS` (RGBA8, one texel per cell)
| channel | meaning | encoding |
|---|---|---|
| r | link strength `E` (can overshoot) | `(E+.25)/1.5` so -0.25..1.25 fits 0..1 |
| g | dot swell (hover bump) | 0..1 |
| b, a | dot offset x, y (magnet, ripple push) | `off+.5`, clamped to ±.45 |

### Ink texture `uC` (RGBA8) — the "patched cable" layer
| channel | meaning |
|---|---|
| r | cable ink progress 0..127, high bit = direction it flows |
| g | dot ink fill |
| b | angle ink entered the dot from |
| a | jack socket size 0..127, high bit = "has direction" |

### Activity map `uA` (R8)
Cells with any live link, dilated 2 cells each way on the CPU. The shader skips the whole link loop where it's 0,
so the expensive part only runs near links.

### Shader key pieces
```glsl
// Cubic smooth-min, C2 continuous (no visible crease). Also blends a material weight m (patch colour).
void U(inout float d, inout float m, float d2, float m2, float k){
  float h = max(k-abs(d-d2),0.)/k, s = h*h*h;
  float w = d2<d ? 1.-.5*s : .5*s;
  d = min(d,d2) - s*k/6.;  m = mix(m,m2,w);
}
```
- Dot: `length(p-bp) - R*(1+.2*swell)`, blend radius `kb = .03 + Kb*swell` (hovered dots get gooier).
- Link with `E < .5`: **two stubs** grow from each end (`L = .5*s*(2-s)`) and meet in the middle. Joined with a hard
  `min` first so they meet without a bulge, then smin'd into the dots.
- Link with `E >= .5`: **one capsule** whose radius grows from `minNeck*full` to `full`.
- Uniforms from the faders: `uR = dotSize`, `uNeck = .3+.75*goo`, `uK = .12+.42*goo`, `uKb = .06+.3*goo`, `uMin = minNeck`.
- AA: `smoothstep(aa,-aa,d)` with `aa = .9/sc` (≈ 1 px).
- Grain: `(hash(fragCoord + fract(t*7)*311) - .5) * .085` added to the colour.
- Ink front uses animated value noise (`bleed()`) so it looks like ink soaking in, not a hard wipe.
- Jack socket: a smaller circle "hole" in dots with a cable plugged in, coloured `socket`.
- Signal pulse: a bead (`R*.66`) smin'd onto the cable with a bright core (`R*.24`) — reads as a bulge travelling.

## 3. Simulation (JS, per cell, per frame)

1. **Target** `tg` = max of: drawn patch (1), hover brush, ripple ring, sequencer column pulse, LFO wave.
   - **Hover brush** is the *segment* the smoothed cursor travelled this frame, not a point, so fast moves leave
     no gaps. Falloff `sstep(1 - (dist-.25)/reach)`. Reach grows up to +60% with speed.
   - **Trail**: `H = max(h, H*exp(-dt/(trail*.45)))` — the brush leaves a fading wake.
   - **Ripple**: ring front at `age*8` units/s, width 1.1, lives 2.4 s; also pushes dots outward.
2. **Magnetic join (hysteresis)**: `JN` flips on above .42 and off below .2. When joined
   `tg = .62 + .38*sstep((tg-.2)/.8)`, else `tg = .16*sstep(tg/.42)`. So a link is either a small swell or fully
   snapped — never a limp half-neck. This is the single most important "feel" trick.
3. **Spring up, ease down**: rising uses a damped spring (`stiff = .22-.14*smooth`, damping `.74+.08*smooth`) so it
   overshoots and wobbles; falling kills velocity and eases exponentially (fast while the neck thins, slower as stubs
   sink into the dots) so there's no bounce on release.
4. **Dots** (even cells only): swell `B` follows hover/ripple/breathe; offset `OX,OY` is a spring towards
   `magnet pull + ripple push + breathe wobble`, clamped to ±.45.
5. **Note on** when `E` crosses .52, re-arm below .38 (sound only; same hysteresis idea).
6. **Idle**: a `mv` flag is set whenever anything changed; when nothing moved for 30 frames and the cursor is away,
   the sim ticks at 1/4 rate and the last frame stays on screen (no re-render). `dirty=4` forces redraws after control
   changes. Adaptive resolution: if average frame >30 ms twice, render scale ×.85 (min .75). DPR capped at 1.5.

### Patching (drawing cables)
- Pointer → lattice; the drag path is sampled every .15 units; `paintAt` hit-tests the cell's own diagonal
  (`|fx-fy|` or `|fx+fy-1|` < .3·√2). Drag < .35 units counts as a click (ripple only).
- `Shift` inverts the tool (patch ↔ unpatch). Cursor CSS switches `crosshair` ↔ `cell`.
- Drawn cables get **ink** that flows from the end nearest where you started, cable to dot to cable (`CP`, `DF`), at
  `ink` speed; cables optionally fade after 5 s (`FA` fade over 3.5 s).
- Presets: **K grid** tiles the logo motif across the lattice (re-tiled on resize); **Patchbay** = N/16 random walks
  of 2–7 diagonal steps.

### Generators (all on one clock = Tempo BPM, eighth-note ticks)
| Generator | What it does |
|---|---|
| Wander | ghost cursor on a Lissajous-ish path (sum of sines), acts exactly like your hover |
| Rain | a ripple at a random visible spot on most beats (max 7 alive) |
| Patcher | every 6 beats draws a 3–6 step inked cable; removed after 9 s (max 6) |
| LFO | `sin(i*.38+j*.21-t*bpm/120*2.2)*sin(j*.17-i*.07+t*...)` thresholded → travelling wave of joins |
| Sequencer | playhead steps one column per eighth; patched cables in that column play notes (max 3) |
| Signal (effect) | every beat a pulse starts on a random inked cable, travels, splits at each jack (≤9 generations, ≤24 alive) and plays a note on arrival |

### Fluid (background tint)
No pressure solve: velocity = **curl noise** (divergence-free by construction, never blows up) + a cursor
"wake" field. Dye splats along the brush, advected + slightly blurred + dissipated. ~360 px half-float RGBA16F
ping-pong FBOs. Shader tints only the background: `bg = mix(bg, fluidColour, (1-exp(-1.8*dye))*strength)`.

## 4. Sound (Web Audio, starts on first pointerdown)

- Pitch from grid position: `deg = (i + (rows-j)*2) mod 15` over a 3-octave **minor pentatonic** `[0,3,5,7,10]`
  from 98 Hz (Mist uses major pentatonic from D3). Stereo pan = x position. One note per frame, min gap 50 ms
  (140 ms for Mist).
- Bus: gain .16 → lowpass 2200 Hz → out; feedback delay 270 ms ×.34; analyser for a scope.
- Voices:
  - **Mist**: 4 detuned sines (±4 cents, octave up, octave down), 80 ms attack, 2.8 s tail into a generated
    3.6 s dark convolution reverb (filtered noise × (1-n/len)^2.6).
  - **Pluck**: Karplus–Strong string rendered once per pitch and cached; timbre changes in bands across the
    canvas (string / mallet (3 inharmonic sines) / harp / FM / soft), brightness follows height, 14% octave-up,
    18% strummed fifth.
  - **Bloop**: sine gliding .6f → 1.45f over 130 ms.
  - **Acid**: two detuned saws an octave down through a resonant lowpass (Q 13) with a 240 ms filter sweep.

## 5. The control panel ("module" faceplate)

Layout: full-bleed canvas stage; ONE floating glass module top-left (292 px); a glass pill "Clear patches" top-right
(52 px tall, icon spins −360° on click); a mono readout bottom-right (`40 × 22 grid · 18 cables`, pointer-events none);
a usage-hint pill bottom-centre that fades in after 900 ms and leaves after the first successful patch
("Click and hold to patch" / "Touch and drag to patch" on coarse pointers). On ≤640 px the module spans the width,
starts collapsed, max-height 72%, and the reset pill moves to the bottom.

### Visual tokens
```css
--slate:#4b5b5d; --lime:#e5f56b;          /* brand pair: pressed = slate bg + lime text */
--panel:#f4f4f2; --glass:rgba(244,244,242,.7);
--ink:#2c2c2b; --ink-soft:#6b6f6e; --line:rgba(44,44,43,.14);
fonts: DM Sans (UI, 500 weight), DM Mono (labels, values, readout; 10.5–11px, uppercase, .04em tracking)
glass: backdrop-filter: blur(18px) saturate(1.3); border 1px rgba(255,255,255,.45); radius 18px;
       box-shadow: 0 18px 50px -24px rgba(20,26,27,.55)
```
The page `--canvas-bg/--canvas-fg` CSS vars are rewritten from the active palette so the readout and `<html>` bg match.

### Structure (top to bottom)
1. **Header**: logo mark 34 px, brand (name 19 px / 500, subtitle mono caps), pill button with a gear icon that
   rotates 60° on hover; label toggles "Hide" ↔ "Controls"; `.module.closed` hides the body.
2. **Palette**: label row with the palette name in an `<output>`; 3-column grid of swatches (5:3, radius 10, background
   = bg colour, a centred circle = fg colour, 44% height). Selected = 2px ink outline, offset 2.
3. **Generators** (boxed: `rgba(255,255,255,.38)` card, radius 14): count in the label ("Off" / "2 running");
   2-column grid of big chips (title + one-line description, min-height 46); the last one spans both columns.
   Active chip = slate bg, lime text, and its dot **pulses on the beat** (`animation: beat var(--beat)`; `--beat` is
   set from the tempo fader). Tempo fader inside the box (60–180 BPM).
4. **Sound**: 5-way segmented control (Off / Mist / Pluck / Bloop / Acid). Segmented = grey track
   `rgba(44,44,43,.06)`, 3px padding, selected button = panel-white with a 1px shadow.
5. **Effects**: 3-column grid of pill chips (30 px, dot before the label, ring when off, filled when on):
   Magnet, Ripples, Breathe, Sockets, Signal.
6. **Cursor**: faders Reach (0.6–6 u), Smoothing (0–100%), Trail decay (off–3 s).
7. **Patching**: 2-way segmented Patch / Unpatch; iOS-style switch "Fade patches after 5s" (40×22, knob slides
   18 px, on = slate track + lime knob); 3 buttons K grid / Patchbay / Clear; hint text with a `<kbd>Shift</kbd>`.
8. **Shape**: Spacing (16–90 px, rebuilds the grid), Dot size (.28–.62 u), Goo (0–100%), Min neck (20–100%).

### Fader component
- Native `<input type=range>` restyled: 4 px track, filled part painted with a `linear-gradient` up to `var(--p)`
  (Firefox uses `::-moz-range-progress`), 18 px lime thumb with a 2 px slate ring.
- Label row: `<label>` left, live value `<output>` right in mono with tabular numbers and units
  (`2.2 u`, `55%`, `1.00 s`, `off`, `40 px`, `r 0.47 u`, `108 bpm`).
- One helper wires it all: `fader(id, key, format, onChange)` → reads `#f{id}`, writes `S[key]`, prints into
  `#o{id}`, sets `--p`, calls `onChange`.

### Controls → state pattern
- Single settings object `S` (numbers + `S.fx` booleans). Every control writes to `S`; the render loop reads `S`.
- Toggles are `<button aria-pressed>` (chips, seg buttons, swatches) or `role="switch" aria-checked` — CSS styles
  off those attributes, so state and a11y are the same thing.
- Any `input`/`click` inside the module sets `dirty=4` so the idle loop redraws.
- `prefers-reduced-motion`: springs replaced by plain easing, staggers off, CSS transitions/animations off.

## 6. Ideas this enables
- Swap the content: any binary grid (a logo, text, a QR, a heatmap, GitHub contributions) → set `drawn` cells.
- Different lattices: square (4-neighbour), hex (6), or free points with a k-nearest graph — the shader only needs
  "dots" and "segments".
- Drive `E` from data/audio (microphone FFT per column), scroll position, or time (loading states, hero backgrounds).
- Material weight `m` already lets you colour links differently from dots — use it for categories/states.
- The panel is reusable on its own for any generative toy: glass module + swatches + chips + seg + faders + switch.
