/** Minimal white card, bottom-right, mirroring the existing section's panel. */
export class InfoPanel {
  constructor(container) {
    this.el = document.createElement('aside');
    this.el.className = 'panel';
    this.el.dataset.noDrag = '';
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `<div class="panel-inner"><div class="panel-kicker"></div><h2 class="panel-title"></h2><p class="panel-body"></p></div>`;
    this.inner = this.el.firstChild;
    this.kicker = this.el.querySelector('.panel-kicker');
    this.title = this.el.querySelector('.panel-title');
    this.body = this.el.querySelector('.panel-body');
    container.appendChild(this.el);
  }

  show(skill) {
    if (!skill) {
      this.el.classList.remove('is-visible');
      return;
    }
    const wasVisible = this.el.classList.contains('is-visible');
    this.kicker.textContent = skill.label;
    this.title.textContent = skill.title;
    this.body.textContent = skill.body;
    if (wasVisible) {
      // Restart the content fade when switching between skills.
      this.inner.classList.remove('is-swapping');
      void this.inner.offsetWidth;
      this.inner.classList.add('is-swapping');
    }
    this.el.classList.add('is-visible');
  }

  dispose() {
    this.el.remove();
  }
}
