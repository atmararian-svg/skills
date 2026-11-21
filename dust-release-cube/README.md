# Dust Release cube — standalone prototype

An interactive, real-time 3D object recreating the shape of Onoki's Dust Release prism: neutral white translucent planes that bulge slightly outward like a die, fine white contours and a small glowing white core. The core leans toward six skill directions.

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
| Move the cursor | The object tilts slightly toward the cursor and eases back to rest when the cursor leaves. |
| Drag anywhere | Free rotation with inertia. Presses under 5 px count as clicks, so a drag never selects a skill. |
| Hover a label | The core springs toward that label's direction on screen, whatever the current rotation. Moving away returns it to the active skill, or to the centre. |
| Click a label | Makes the skill active: the label turns white, the core rests there, and the info card appears. |
| Tab / Enter | Keyboard hover and select. |
| Esc | Clears the selection. |

## Structure

```
src/
  config.js              all tunables: geometry, materials, spring, rotation, skills
  DustReleaseScene.js    renderer, frame hierarchy, state, loop; mount()/dispose()
  DustPrism.js           traced hexahedron with slightly convex faces, glass shader, contours
  SkillRays.js           hover-only gradient ray from the centre to the shell
  EnergyCore.js          sphere + billboard halo, spring physics in object space
  RotationController.js  drag-to-rotate, fling inertia, click suppression
  ParallaxController.js  restrained cursor tilt + drift, frozen while dragging
  SkillLabels.js         HTML labels in the fixed section layout
  InfoPanel.js           bottom-right white card
```

### Key ideas

- **Traced geometry.** `CONFIG.shell.vertices` holds the prism's eight corners. They were solved with a least-squares fit, so that through this scene's camera at rest they project onto the 8 corners and 12 edges of the anime frame. The leftover error per corner was folded back into the vertices, so the faces are slightly skewed and non-planar like the drawing. The vertices are centred on the volume's centroid, so the idle core sits at the exact geometric centre.
- **Convex faces.** Each face is a bilinear patch through its four corners, pushed outward by `bulge · sin(πu) · sin(πv)` with smooth normals. The offset is zero along every edge, so the contours stay straight and the silhouette stays angular. The curvature shows only in the shading and reflections.
- **One owner per transform.** `rig` holds position only (parallax drift). Inside it, `tilt` holds rotation only (parallax tilt), and inside that, `frame` holds rotation only (drag × idle sway). The prism sits in `frame`. The core sits directly in `rig`, beside the rotating groups, so no rotation ever reaches it. It still drifts with the object, so it stays inside.
- **Screen-relative core.** The core's target is the skill's resting direction projected onto the screen plane (its X/Y), times `travel`. Because the core is never under a rotated parent, this stays correct after any drag. The test pass checks all six skills at 0°, 90°, 180° and 360° and at oblique angles.
- **Parallax vs drag.** Parallax lives on its own group and only eases toward the cursor. While the mouse button is down its target freezes, so drag rotation alone drives the motion. When the cursor leaves the stage, it eases back to rest.
- **Hover ray.** While a skill is hovered, a hairline fades in from the centre toward that skill's on-screen direction and stops just inside the shell. It is transparent at the centre and brightest at the face. Its end point is re-found every frame by raycasting the rotated, curved shell from inside, so it never leaves the object. It fades out when the hover ends. Labels have no connecting lines.
- **Containment.** A damped spring (`stiffness`, `damping`) moves the core, and it is hard-clamped to `maxOffset`. At startup that clamp is reduced to the prism's real inner clearance (the distance from the centre to the nearest plane) minus the core radius and a margin, so the core can never touch a plane, whatever the orientation.
- **Glass.** Back faces render first, then the opaque core, then the front faces, contours and the additive halo. The glass shader is strictly neutral: every colour term is white, so planes differ only by opacity, Fresnel, white reflections, light from the core and a faint border. There is no post-processing and no transmission pass.
- **Contours.** `LineSegments2` keeps lines at a constant 0.8 CSS px, with a faint wider pass under them for the drawing's soft bleed. Rear edges are dimmed slightly, based on which faces point toward the camera.

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
