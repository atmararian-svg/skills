export { ParticleMorphScene } from './ParticleMorphScene.js';
export { DEFAULT_CONFIG, KNIGHT_KATANA_MODELS, mergeConfig } from './config.js';
export { ModelLoader, extractGeometry } from './ModelLoader.js';
export { samplePointCloud } from './PointCloudGenerator.js';
export { ParticleMorphSystem, matchPointSets } from './ParticleMorphSystem.js';
export { ParticleSimulation } from './ParticleSimulation.js';
export { ParticleRenderer } from './ParticleRenderer.js';
export { CursorInteraction } from './CursorInteraction.js';
// ScrollController depends on GSAP. Import it from './ScrollController.js' only if you use it.
