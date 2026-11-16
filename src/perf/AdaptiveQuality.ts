/**
 * Qualité adaptative : choisit le nombre de parcelles selon le temps d'image mesuré.
 * - descente si > 20 ms en moyenne (< 50 fps) pendant 2 s ;
 * - montée si < 13 ms pendant 4 s, sauf vers un palier qui a déjà échoué.
 */
export const TIERS = [256, 512, 724, 1024] as const;

export class AdaptiveQuality {
  auto = true;
  tier: number;
  maxTier: number;
  /** fps moyen de la dernière fenêtre de 0,5 s (affiché). */
  fps = 60;
  /** Temps d'image moyen (ms) de la dernière fenêtre. */
  frameMs = 16.7;

  private allowedMax: number;
  private acc = 0;
  private frames = 0;
  private window = 0;
  private slow = 0;
  private fast = 0;
  private cooldown = 1.5;

  constructor(startTier: number, maxTier: number, private onChange: (tier: number) => void) {
    this.maxTier = maxTier;
    this.allowedMax = maxTier;
    this.tier = Math.min(startTier, maxTier);
  }

  /** Appelé à chaque image avec le temps réel écoulé (s). */
  update(dt: number) {
    this.acc += dt;
    this.frames++;
    this.window += dt;
    if (this.window < 0.5) return;

    this.frameMs = (this.acc / this.frames) * 1000;
    this.fps = 1000 / this.frameMs;
    const w = this.window;
    this.acc = 0;
    this.frames = 0;
    this.window = 0;

    // Juste après un changement de palier, les mesures ne veulent rien dire (allocation, compilation).
    if (this.cooldown > 0) {
      this.cooldown -= w;
      return;
    }
    if (!this.auto) return;

    if (this.frameMs > 20) {
      this.slow += w;
      this.fast = 0;
    } else if (this.frameMs < 13) {
      this.fast += w;
      this.slow = 0;
    } else {
      this.slow = 0;
      this.fast = 0;
    }

    if (this.slow >= 2 && this.tier > 0) {
      this.allowedMax = this.tier - 1; // ce palier ne tient pas : on ne le retentera pas
      this.set(this.tier - 1);
    } else if (this.fast >= 4 && this.tier < this.allowedMax) {
      this.set(this.tier + 1);
    }
  }

  /** Changement de palier (automatique ou manuel). */
  set(tier: number) {
    const t = Math.max(0, Math.min(tier, this.maxTier));
    this.slow = 0;
    this.fast = 0;
    this.cooldown = 1.5;
    if (t === this.tier) return;
    this.tier = t;
    this.onChange(t);
  }

  /** Choix manuel : on lève l'interdiction de remonter. */
  setManual(tier: number) {
    this.allowedMax = this.maxTier;
    this.set(tier);
  }
}
