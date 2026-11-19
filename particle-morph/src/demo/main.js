// Demo harness only: wires ParticleMorphScene to scroll + dev controls.
import GUI from 'lil-gui';
import { ParticleMorphScene, KNIGHT_KATANA_MODELS } from '../particle-morph/index.js';
import { ScrollController } from '../particle-morph/ScrollController.js';

const params = new URLSearchParams(location.search);
const stage = document.getElementById('stage');
const status = document.getElementById('status');

const scene = new ParticleMorphScene(stage, {
  models: KNIGHT_KATANA_MODELS(import.meta.env.BASE_URL),
  cssBlendTarget: 'container',
  blendMode: params.get('blend') === 'shader' ? 'shader' : 'css',
  particleCount: Number(params.get('count')) || 40000,
});
window.__pms = scene; // handy for console / automated tests

await scene.load();

const scroll = new ScrollController({
  trigger: '#scroll-track',
  start: 'top top',
  end: 'bottom bottom',
  scrub: 0.8,
  onUpdate: (p) => scene.setMorphProgress(p),
});
window.__scroll = scroll;

// ── minimal dev controls
const cfg = scene.config;
const ui = {
  progress: 0,
  particleCount: cfg.particleCount,
  interactionRadius: cfg.interactionRadius,
  repulsionStrength: cfg.repulsionStrength,
  directionalStrength: cfg.directionalStrength,
  recoverySpeed: cfg.recoverySpeed,
  springDamping: cfg.springDamping,
  lookAtIntensity: cfg.lookAtIntensity,
  noiseIntensity: cfg.noiseIntensity,
  particleSize: cfg.particleSize,
  opacity: cfg.opacity,
  shading: cfg.shading,
  morphSpread: cfg.morphSpread,
  morphScatter: cfg.morphScatter,
  morphTwist: cfg.morphTwist,
  blendMode: cfg.blendMode,
};
const gui = new GUI({ title: 'dev' });
if (params.has('nogui')) gui.hide();
const set = (k) => (v) => scene.updateConfig({ [k]: v });
gui.add(ui, 'progress', 0, 1, 0.001).name('morph progress').listen().onChange((v) => scroll.scrollToProgress(v));
gui.add(ui, 'particleCount', 5000, 100000, 1000).onFinishChange(set('particleCount'));
gui.add(ui, 'interactionRadius', 0.05, 0.5, 0.01).onChange(set('interactionRadius'));
gui.add(ui, 'repulsionStrength', 0, 3, 0.05).onChange(set('repulsionStrength'));
gui.add(ui, 'directionalStrength', 0, 3, 0.05).onChange(set('directionalStrength'));
gui.add(ui, 'recoverySpeed', 0.1, 3, 0.05).onChange(set('recoverySpeed'));
gui.add(ui, 'springDamping', 0.15, 1.5, 0.01).onChange(set('springDamping'));
gui.add(ui, 'lookAtIntensity', 0, 0.6, 0.01).onChange(set('lookAtIntensity'));
gui.add(ui, 'noiseIntensity', 0, 1, 0.01).onChange(set('noiseIntensity'));
const look = gui.addFolder('look').close();
look.add(ui, 'particleSize', 0.5, 4, 0.05).onChange(set('particleSize'));
look.add(ui, 'opacity', 0.1, 1, 0.01).onChange(set('opacity'));
look.add(ui, 'shading', 0, 1, 0.01).onChange(set('shading'));
look.add(ui, 'morphSpread', 0, 0.9, 0.01).onChange(set('morphSpread'));
look.add(ui, 'morphScatter', 0, 1.5, 0.01).onChange(set('morphScatter'));
look.add(ui, 'morphTwist', -3, 3, 0.01).onChange(set('morphTwist'));
look.add(ui, 'blendMode', ['css', 'shader']).onChange(set('blendMode'));

const tick = () => {
  ui.progress = scroll.progress;
  const s = scene.stats;
  status.textContent = `${s.fps} fps · ${s.particles.toLocaleString()} particles · morph ${scene.morphProgress.toFixed(3)}${s.hovering ? ' · hover' : ''}`;
  requestAnimationFrame(tick);
};
tick();
