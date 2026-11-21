# Dust Release cube — standalone prototype

An interactive, real-time 3D object recreating the shape of Onoki's Dust Release prism: translucent rose-tinted planes, thin white contours and a small glowing white core. The core leans toward six skill directions.

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
  DustPrism.js           custom hexahedron from 8 traced corners, glass shader, contours
  EnergyCore.js          sphere + billboard halo, spring physics in object space
  RotationController.js  drag-to-rotate, fling inertia, click suppression
  SkillLabels.js         2D overlay: HTML labels + SVG hairlines, fixed section layout
  InfoPanel.js           bottom-right white card
```

### Key ideas

- **Traced geometry.** `CONFIG.shell.vertices` holds the prism's eight corners. They were solved with a least-squares fit, so that through this scene's camera at rest they project onto the 8 corners and 12 edges of the anime frame. The leftover error per corner was folded back into the vertices, so the faces are slightly skewed and non-planar like the drawing. The vertices are centred on the volume's centroid, so the idle core sits at the exact geometric centre.
- **Skill frame.** One group, `frame`, holds the prism and the core. User rotation and idle sway rotate `frame`. The six skill directions live in the same frame.
- **Labels are 2D.** Labels and hairlines are an HTML/SVG overlay laid out from the resting orientation, so they keep the section's fixed layout. Hairlines start outside the prism's largest possible screen radius, so no line ever crosses or sticks out of the object. Set `labels.followRotation: true` to make them track the rotation instead.
- **Core movement in object space.** Each skill's `direction` is a vector in the frame. The core's target is `direction × travel`. A damped spring (`stiffness`, `damping`) drives it, and it is hard-clamped to `maxOffset`. At startup that clamp is reduced to the prism's real inner clearance (the distance from the centre to the nearest plane) minus the core radius and a margin, so the core can never touch a plane, whatever the orientation.
- **Inertia.** When the frame rotates, part of that rotation is undone on the core (`inertia`). An off-centre core therefore lags slightly behind a fast drag, then settles.
- **Glass.** Back faces render first, then the opaque core, then the front faces, contours and the additive halo. The glass shader combines Fresnel opacity, light from the core, soft studio reflections and a faint border. There is no post-processing and no transmission pass.
- **Contours.** `LineSegments2` keeps lines at a constant 1.25 CSS px, with a faint wider pass under them for the drawing's soft bleed. Rear edges are dimmed slightly, based on which faces point toward the camera.

## Integrating later

```js
import { CONFIG } from './src/config.js';
import { DustReleaseScene } from './src/DustReleaseScene.js';

const scene = new DustReleaseScene(containerEl, CONFIG, { onSelect: (skill) => {/* … */} });
scene.start();
// scene.select('creative');  scene.dispose();
```

The container needs a size and `position: relative` or `fixed`. `styles.css` holds the label and card styles. The stage sets `touch-action: none` so touch drags rotate the object. If this is embedded in a scrolling page, scope that rule to the object area.

To port it to React Three Fiber, map each class to a component: `DustPrism` and `EnergyCore` become meshes or groups, the per-frame `update` and `step` calls move into `useFrame`, and the labels move to drei's `<Html>` or stay in the projected overlay.
