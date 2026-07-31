import type { ValmontState } from '@valmont/types';

/**
 * Le noyau n'est pas une décoration : c'est la représentation de l'état
 * intérieur de Valmont. Chaque état a un profil physique, et la transition
 * entre deux états est amortie — un noyau qui change instantanément de régime
 * paraît mécanique, un noyau qui met une demi-seconde à monter en puissance
 * paraît vivant.
 */
export interface CoreProfile {
  /** Intensité générale : luminosité, agitation des particules. */
  energy: number;
  /** Vitesse de rotation de l'ensemble. */
  spin: number;
  /** 0 → les particules s'étalent, 1 → elles convergent vers le centre. */
  convergence: number;
  /** Amplitude du bruit qui déforme la sphère. */
  turbulence: number;
  /** Vitesse des anneaux et des engrenages. */
  machinery: number;
  /** Densité des lignes de circuit visibles. */
  circuitry: number;
  /** Respiration lente de fond. */
  breathing: number;
}

export const PROFILES: Record<ValmontState, CoreProfile> = {
  // En veille : presque éteint, une braise.
  dormant: {
    energy: 0.12,
    spin: 0.08,
    convergence: 0.35,
    turbulence: 0.15,
    machinery: 0.05,
    circuitry: 0.05,
    breathing: 0.5,
  },
  // Au repos : vivant mais calme, respiration lente.
  idle: {
    energy: 0.42,
    spin: 0.22,
    convergence: 0.2,
    turbulence: 0.35,
    machinery: 0.25,
    circuitry: 0.3,
    breathing: 1,
  },
  // À l'écoute : le noyau se rassemble et se tait. Les particules convergent,
  // les anneaux ralentissent — toute l'attention est tournée vers l'extérieur.
  listening: {
    energy: 0.58,
    spin: 0.1,
    convergence: 0.85,
    turbulence: 0.12,
    machinery: 0.12,
    circuitry: 0.55,
    breathing: 0.6,
  },
  // En réflexion : tout s'emballe. Rotation rapide, turbulence maximale,
  // circuits saturés — on voit la machine travailler.
  thinking: {
    energy: 0.95,
    spin: 1,
    convergence: 0.1,
    turbulence: 1,
    machinery: 1,
    circuitry: 1,
    breathing: 1.6,
  },
  // En parole : le noyau pulse au rythme de la voix, sans s'agiter.
  speaking: {
    energy: 0.78,
    spin: 0.34,
    convergence: 0.42,
    turbulence: 0.45,
    machinery: 0.4,
    circuitry: 0.7,
    breathing: 1.1,
  },
  // Au travail (outils) : régime soutenu, mécanique très visible.
  working: {
    energy: 0.86,
    spin: 0.72,
    convergence: 0.25,
    turbulence: 0.72,
    machinery: 0.92,
    circuitry: 0.9,
    breathing: 1.3,
  },
};

/**
 * Amortissement exponentiel indépendant de la fréquence d'images.
 * `lambda` élevé = réaction vive. Sans le terme en `dt`, l'animation
 * changerait de vitesse selon que l'écran tourne à 60 ou 120 Hz.
 */
export function damp(current: number, target: number, lambda: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-lambda * dt));
}

/** Profil courant, interpolé vers l'état cible. */
export class CoreDriver {
  private current: CoreProfile = { ...PROFILES.idle };
  private target: CoreProfile = { ...PROFILES.idle };

  /** Niveau audio instantané (0-1), utilisé pour la pulsation vocale. */
  private level = 0;
  private smoothedLevel = 0;

  setState(state: ValmontState): void {
    this.target = PROFILES[state] ?? PROFILES.idle;
  }

  setAudioLevel(level: number): void {
    this.level = level;
  }

  /** Dernier profil calculé, lu par tous les composants de la scène. */
  private snapshot: CoreProfile & { pulse: number } = { ...PROFILES.idle, pulse: 0 };

  /**
   * Lecture. Appelée par chaque élément du noyau à chaque image.
   *
   * Séparée de `update` volontairement : une dizaine de composants lisent le
   * profil par image, mais l'amortissement ne doit avancer qu'une seule fois.
   * Les faire tous appeler `update` multiplierait la vitesse d'animation par
   * le nombre de composants — un bug invisible en lecture et évident à l'œil.
   */
  read(): CoreProfile & { pulse: number } {
    return this.snapshot;
  }

  /**
   * Avance l'animation d'une image. **Un seul appelant par image** (le
   * composant `Driver` de la scène, ordonnancé en priorité).
   *
   * Vitesses d'amortissement différenciées, et c'est délibéré : l'énergie
   * monte vite (le noyau doit réagir instantanément quand on lui parle) mais
   * la mécanique — anneaux, engrenages — a de l'inertie, comme une masse en
   * rotation.
   */
  update(dt: number): CoreProfile & { pulse: number } {
    const step = Math.min(dt, 0.1); // une image longue ne doit pas produire un saut

    this.current.energy = damp(this.current.energy, this.target.energy, 6, step);
    this.current.convergence = damp(this.current.convergence, this.target.convergence, 4, step);
    this.current.turbulence = damp(this.current.turbulence, this.target.turbulence, 3.5, step);
    this.current.circuitry = damp(this.current.circuitry, this.target.circuitry, 5, step);
    this.current.breathing = damp(this.current.breathing, this.target.breathing, 2, step);
    // Inertie mécanique : montée et descente lentes.
    this.current.spin = damp(this.current.spin, this.target.spin, 1.6, step);
    this.current.machinery = damp(this.current.machinery, this.target.machinery, 1.4, step);

    // La voix : attaque rapide, relâchement lent — sinon le noyau clignote
    // sur chaque syllabe au lieu de suivre la phrase.
    const lambda = this.level > this.smoothedLevel ? 22 : 5;
    this.smoothedLevel = damp(this.smoothedLevel, this.level, lambda, step);

    this.snapshot = { ...this.current, pulse: this.smoothedLevel };
    return this.snapshot;
  }
}
