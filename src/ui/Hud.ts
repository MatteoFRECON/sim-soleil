import type { Legend, ViewMode } from '../view/ViewModes';
import { VIEW_MODES } from '../view/ViewModes';

/**
 * Affichage par-dessus la scène : titre + mode, barre des modes, légende, aide,
 * compteur fps / parcelles, messages.
 */
export class Hud {
  private modeLabel = document.getElementById('mode-label')!;
  private modeHint = document.getElementById('mode-hint')!;
  private stats = document.getElementById('stats')!;
  private legend = document.getElementById('legend')!;
  private modeBar = document.getElementById('mode-bar')!;
  private message = document.getElementById('message')!;
  private buttons = new Map<string, HTMLButtonElement>();
  private lastStats = 0;

  constructor(onMode: (m: ViewMode) => void) {
    for (const m of VIEW_MODES) {
      const b = document.createElement('button');
      b.innerHTML = `<kbd>${m.key}</kbd> ${m.label}`;
      b.addEventListener('click', () => onMode(m));
      this.modeBar.appendChild(b);
      this.buttons.set(m.id, b);
    }
  }

  setMode(m: ViewMode) {
    this.modeLabel.textContent = m.label;
    this.modeHint.textContent = m.hint;
    for (const [id, b] of this.buttons) b.classList.toggle('active', id === m.id);
    this.setLegend(m.legend);
  }

  setLegend(l: Legend) {
    if (l === 'velocity') {
      this.legend.innerHTML = `<div class="bar vel"></div><div class="ticks"><span>descend</span><span>immobile</span><span>monte</span></div>`;
    } else {
      const cls = l === 'heat' ? 'heat' : 'bb';
      this.legend.innerHTML = `<div class="bar ${cls}"></div><div class="ticks"><span>5 800 K</span><span>~2 MK</span><span>15 MK</span></div><div class="cap">échelle logarithmique</div>`;
    }
  }

  /** Mis à jour au plus 4 fois par seconde (le DOM coûte). */
  updateStats(now: number, fps: number, frameMs: number, particles: number, auto: boolean, paused: boolean, timeScale: number) {
    if (now - this.lastStats < 250) return;
    this.lastStats = now;
    const p = particles >= 1e6 ? (particles / 1e6).toFixed(2) + ' M' : Math.round(particles / 1000) + ' k';
    this.stats.textContent =
      `${fps.toFixed(0)} fps · ${frameMs.toFixed(1)} ms · ${p} parcelles${auto ? ' (auto)' : ''}` +
      (paused ? ' · PAUSE' : timeScale !== 1 ? ` · temps ×${timeScale}` : '');
  }

  showMessage(text: string, ms = 0) {
    this.message.textContent = text;
    this.message.classList.add('visible');
    if (ms > 0) setTimeout(() => this.message.classList.remove('visible'), ms);
  }

  toggleVisible() {
    document.body.classList.toggle('hide-ui');
  }
}
