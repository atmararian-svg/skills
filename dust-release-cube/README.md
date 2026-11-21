# Dust Release cube — standalone prototype

An interactive, real-time 3D object: a translucent rose-tinted prism with thin white contours and a glowing white core. The core physically leans toward six skill directions.

This is an isolated prototype. It has no dependency on the main site's sections or state.

## Run

ES modules need an HTTP server (opening the file directly with `file://` won't work):

```bash
cd dust-release-cube && python3 -m http.server 8000
```

Then open http://localhost:8000. Three.js r169 loads from jsDelivr through the import map in `index.html`. Nothing needs installing.

## Interaction

| Input | Result |
|---|---|
| Drag anywhere | Free rotation with inertia. Presses under 5 px count as clicks, so a drag never selects a skill. |
| Hover a label | The core springs toward that direction. Moving away returns it to the active skill, or to the centre. |
| Click a label | Makes the skill active: the label turns white, the core rests there, and the info card appears. |
| Tab / Enter | Keyboard hover and select. |
| Esc | Clears the selection. |

## Structure

```
src/
  config.js              all tunables: geometry, materials, spring, rotation, skills
  DustReleaseScene.js    renderer, frame hierarchy, state, loop; mount()/dispose()
  DustCube.js            prism geometry, glass shader, front/back-aware contours, inset shell
  EnergyCore.js          sphere + billboard halo, spring physics in object space
  RotationController.js  drag-to-rotate, fling inertia, click suppression
  SkillAxes.js           hairlines from shell to each anchor
  SkillLabels.js         HTML overlay labels projected from 3D anchors
  InfoPanel.js           bottom-right white card
```

### Key ideas

- **Skill frame.** One group, `frame`, holds the shell, the core and the axes. User rotation and idle sway rotate `frame`. The shell has its own resting `pose` inside `frame`, which gives the three-quarter look. The skill axes stay screen-aligned at rest, matching the existing section's layout.
- **Core movement in object space.** Each skill's `direction` is a vector in the frame. The core's target is `direction × travel`. A damped spring (`stiffness`, `damping`) drives it, and it is hard-clamped to `maxOffset`. Because `radius + maxOffset` is smaller than the shell's inner half-extent, the core can never touch the shell, whatever the orientation.
- **Inertia.** When the frame rotates, part of that rotation is undone on the core (`inertia`). An off-centre core therefore lags slightly behind a fast drag, then settles.
- **Glass.** Back faces render first, then the opaque core, then the front faces, contours and the additive halo. The glass shader combines Fresnel opacity, light from the core, soft studio reflections and a faint border. There is no post-processing and no transmission pass.
- **Contours.** `LineSegments2` keeps lines at a constant 1.15 CSS px. Rear edges are dimmed each frame based on which faces point toward the camera. A faint inset shell gives the double-contour glass-thickness look.

## Integrating later

```js
import { CONFIG } from './src/config.js';
import { DustReleaseScene } from './src/DustReleaseScene.js';

const scene = new DustReleaseScene(containerEl, CONFIG, { onSelect: (skill) => {/* … */} });
scene.start();
// scene.select('creative');  scene.dispose();
```

The container needs a size and `position: relative` or `fixed`. `styles.css` holds the label and card styles. The stage sets `touch-action: none` so touch drags rotate the object. If this is embedded in a scrolling page, scope that rule to the object area.

To port it to React Three Fiber, map each class to a component: `DustCube`, `EnergyCore` and `SkillAxes` become meshes or groups, the per-frame `update` and `step` calls move into `useFrame`, and the labels move to drei's `<Html>` or stay in the projected overlay.
