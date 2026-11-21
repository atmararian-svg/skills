import { CONFIG } from './config.js';
import { DustReleaseScene } from './DustReleaseScene.js';

const scene = new DustReleaseScene(document.getElementById('stage'), CONFIG);
scene.start();

// Handy for tuning in the console.
window.__dustRelease = scene;
