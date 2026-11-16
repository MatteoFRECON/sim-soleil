import GUI from 'lil-gui';
import type { PhysicsParams } from '../sim/GasSimulation';
import { TIERS } from '../perf/AdaptiveQuality';
import { VIEW_MODES, type ViewModeId } from '../view/ViewModes';

/** Réglages d'affichage (modifiés par les modes de vue et par le panneau). */
export interface ViewSettings {
  mode: ViewModeId;
  timeScale: number;
  paused: boolean;
  cut: boolean;
  cutOffset: number;
  layers: boolean;
  tracerFraction: number;
  trailLength: number;
  particleSize: number;
  brightness: number;
  bloom: number;
  exposure: number;
}

export interface PerfSettings {
  auto: boolean;
  tier: number;
}

export interface PanelCallbacks {
  onMode: (id: ViewModeId) => void;
  onTier: (tier: number) => void;
  onReset: () => void;
  onReframe: () => void;
  onNextParticle: () => void;
  onPhysicsDefaults: () => void;
}

/** Panneau de réglages (lil-gui), en français. */
export class Panel {
  readonly gui: GUI;
  private tierCtrl;

  constructor(view: ViewSettings, phys: PhysicsParams, perf: PerfSettings, maxTier: number, cb: PanelCallbacks) {
    this.gui = new GUI({ title: 'Réglages' });
    if (window.innerWidth < 700) this.gui.close();

    const fv = this.gui.addFolder('Vue');
    const modes: Record<string, ViewModeId> = {};
    for (const m of VIEW_MODES) modes[`${m.key}. ${m.label}`] = m.id;
    fv.add(view, 'mode', modes).name('Mode').onChange(cb.onMode);
    fv.add(view, 'timeScale', { '×0,25': 0.25, '×0,5': 0.5, '×1': 1, '×2': 2, '×4': 4 }).name('Vitesse du temps');
    fv.add(view, 'paused').name('Pause (Espace)');
    fv.add(view, 'cut').name('Coupe');
    fv.add(view, 'cutOffset', -0.6, 0.6, 0.01).name('Position de la coupe');
    fv.add(view, 'layers').name('Couches (fil de fer)');
    fv.add(view, 'tracerFraction', 0.002, 0.1, 0.001).name('Part de traceurs');
    fv.add(view, 'trailLength', 0.8, 0.985, 0.005).name('Longueur des traînées');
    fv.add({ f: cb.onReframe }, 'f').name('Recadrer (R)');
    fv.add({ f: cb.onNextParticle }, 'f').name('Autre parcelle (F)');

    const fp = this.gui.addFolder('Physique');
    fp.add(phys, 'coreMass', 0, 5, 0.05).name('Masse du noyau');
    fp.add(phys, 'gasMass', 0, 3, 0.05).name('Masse du gaz');
    fp.add(phys, 'gravity', 0, 3, 0.05).name('Gravité (G)');
    fp.add(phys, 'heat', 0, 8, 0.1).name('Chauffage du noyau');
    fp.add(phys, 'cool', 0, 8, 0.1).name('Refroidissement surface');
    fp.add(phys, 'diffusion', 0, 1, 0.01).name('Diffusion de chaleur');
    fp.add(phys, 'buoyancy', 0, 2, 0.01).name('Poussée d’Archimède');
    fp.add(phys, 'cellSpeed', 0, 0.6, 0.01).name('Vitesse des cellules');
    fp.add(phys, 'cellScale', 0.6, 5, 0.05).name('Nombre de cellules');
    fp.add(phys, 'cellEvolve', 0, 0.4, 0.005).name('Évolution des cellules');
    fp.add(phys, 'turbulence', 0, 0.4, 0.005).name('Turbulence');
    fp.add(phys, 'turbScale', 1, 12, 0.1).name('Échelle turbulence');
    fp.add(phys, 'radiativeZone').name('Zone radiative');
    fp.add(phys, 'radiativeRadius', 0.3, 0.85, 0.01).name('Haut zone radiative');
    fp.add(phys, 'coreRadius', 0.05, 0.3, 0.01).name('Rayon du noyau');
    fp.add({ f: cb.onPhysicsDefaults }, 'f').name('Valeurs par défaut');
    fp.add({ f: cb.onReset }, 'f').name('Réinitialiser le gaz');
    fp.close();

    const fr = this.gui.addFolder('Rendu');
    fr.add(view, 'particleSize', 0.003, 0.04, 0.001).name('Taille des parcelles');
    fr.add(view, 'brightness', 0.05, 3, 0.01).name('Luminosité');
    fr.add(view, 'bloom', 0, 2.5, 0.01).name('Halo (bloom)');
    fr.add(view, 'exposure', 0.3, 2.5, 0.01).name('Exposition');
    fr.close();

    const fq = this.gui.addFolder('Performance');
    fq.add(perf, 'auto').name('Qualité auto');
    const tiers: Record<string, number> = {};
    TIERS.forEach((s, i) => {
      if (i <= maxTier) tiers[`${i} — ${Math.round((s * s) / 1000)} k parcelles`] = i;
    });
    this.tierCtrl = fq.add(perf, 'tier', tiers).name('Palier').onChange((t: number) => {
      perf.auto = false;
      fq.controllers[0].updateDisplay();
      cb.onTier(t);
    });
    fq.close();
  }

  /** Rafraîchit l'affichage après un changement venu d'ailleurs (clavier, auto). */
  refresh() {
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
    this.tierCtrl.updateDisplay();
  }
}
