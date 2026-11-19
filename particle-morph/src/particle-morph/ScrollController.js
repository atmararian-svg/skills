import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

/**
 * ScrollController: maps a scroll range to morph progress with GSAP ScrollTrigger.
 *
 * It is a thin, optional adapter. ParticleMorphScene itself only needs
 * `setMorphProgress(p)`, so the host site can drive the morph with any
 * scroll library, a timeline, or a button.
 *
 *   const sc = new ScrollController({
 *     trigger: '#section', start: 'top top', end: 'bottom bottom',
 *     scrub: 1, onUpdate: (p) => scene.setMorphProgress(p),
 *   });
 */
export class ScrollController {
  constructor({ trigger, start = 'top top', end = 'bottom bottom', scrub = 1, onUpdate, markers = false }) {
    this.state = { progress: 0 };
    this.onUpdate = onUpdate;
    this.tween = gsap.to(this.state, {
      progress: 1,
      ease: 'none',
      onUpdate: () => this.onUpdate?.(this.state.progress),
      scrollTrigger: { trigger, start, end, scrub, markers, invalidateOnRefresh: true },
    });
  }

  get progress() {
    return this.state.progress;
  }

  /** Scroll the page to the position matching a progress value (e.g. from a dev slider). */
  scrollToProgress(p) {
    const st = this.tween.scrollTrigger;
    window.scrollTo({ top: st.start + (st.end - st.start) * p, behavior: 'instant' });
  }

  refresh() {
    ScrollTrigger.refresh();
  }

  dispose() {
    this.tween.scrollTrigger?.kill();
    this.tween.kill();
  }
}
