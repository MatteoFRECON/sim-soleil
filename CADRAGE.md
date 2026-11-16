# Sim_soleil — Cadrage

> Document de cadrage du projet. À lire avant toute modification. Langue : français.
> Version du cadrage : v1 — 2026-11-16 (validé par Matteo).

## 1. Besoin

Voir en 3D, en temps réel et de façon fluide, **une sphère de gaz** (une étoile type Soleil) :

- au centre, un **noyau** qui **chauffe le gaz** et qui porte **la masse** (donc la gravité) ;
- autour, le gaz qui **convecte** : il chauffe en bas, devient plus léger, **monte**, se refroidit en
  surface, devient plus lourd et **redescend** → des **cellules de convection** visibles ;
- **plusieurs modes de vue** pour comprendre ce qui se passe (extérieur, coupe, température,
  vitesse, traceurs, suivi d'une parcelle de gaz) ;
- un **cadrage caméra** propre : le soleil toujours entier et centré, quelle que soit la fenêtre.

### Ce que la simulation montre / ne montre pas

| Montre | Ne montre pas (volontairement) |
|---|---|
| Chauffage par le noyau, refroidissement en surface | La fusion nucléaire réelle, les neutrinos |
| Poussée d'Archimède (le chaud monte, le froid descend) | La vraie équation d'état du plasma |
| Cellules de convection, granulation de surface | Le champ magnétique, les taches, les éruptions |
| Zone radiative (option) sous la zone convective | Les vraies échelles de temps (≈ 170 000 ans pour un photon) |
| Gravité du noyau (+ masse du gaz) | Une résolution des équations de Navier-Stokes |

Niveau choisi : **« visuel crédible »** — les bons mécanismes, les bons ordres de grandeur relatifs,
mais pas une simulation numérique de recherche.

## 2. Modèle physique simplifié (unités normalisées, rayon R = 1)

Chaque particule = une parcelle de gaz : position **x**, vitesse **v**, température **T**
(normalisée : 0 = surface ≈ 5 800 K, 1 = cœur ≈ 15 millions K).

1. **Profil d'équilibre** `Teq(r)` (échelle log) : 1 → 0,75 dans la zone radiative, puis chute
   jusqu'à 0 en surface.
2. **Gravité** : `g(r) = G · (M_noyau(r) + M_gaz · r³) / (r² + ε²)` — le noyau a une taille
   (sous son rayon, sa masse enfermée décroît en r³, donc g → 0 au centre) + masse du gaz enfermée
   sous le rayon r (densité uniforme).
3. **Approximation de Boussinesq, gaz visqueux** : la gravité « moyenne » est équilibrée par la
   pression (équilibre hydrostatique) ; seule compte la différence de température **avec le gaz
   environnant à la même altitude** (moyenne par couche, recalculée sur GPU à chaque image) :
   `v_Archimède = β · g(r) · (T − T̄(r)) · r̂` (vitesse limite : pas d'inertie). Le flux net à
   travers chaque couche est nul → pas d'accumulation de gaz.
4. **Écoulement de convection** : champ de vitesse **à divergence nulle** (gaz incompressible)
   `v_cellules = ∇ × (ψ · N(x, t))` où `N` = bruit 3D lent à grande échelle (gradient analytique)
   et `ψ = sin(π u)` une enveloppe nulle aux bords de la zone convective (u pris en r², lisse au
   centre) → **aucun flux à travers la surface**, les cellules bouclent sur elles-mêmes. S'y ajoute
   une **turbulence** (même principe, petite échelle). Les parcelles suivent exactement ce champ
   (schéma RK2, évalué à la position du pas suivant) + la dérive d'Archimède.
5. **Chaleur** : `dT/dt = chauffage · noyau(r) · (1 − T) − refroidissement · surface(r) · T
   + diffusion · (Teq(r) − T)`, + **chauffage par le fond** de la zone convective (la chaleur du
   noyau arrive par la zone radiative, comme une casserole sur le feu). Une parcelle qui monte
   **garde sa chaleur** (diffusion faible) : colonnes montantes chaudes, descendantes froides.
6. **Zone radiative (option, activée par défaut)** : sous `r_rad ≈ 0,7` (comme le vrai Soleil),
   pas de cellules, la chaleur se propage par diffusion (×10). La frontière avec la zone
   convective (tachocline) est **réfléchissante** : pas d'échange de matière.
7. **Bords** : la parcelle ne sort jamais de la sphère (position ramenée à r ≤ 0,995).

> Ces choix (pas d'inertie, référence = moyenne par couche, RK2, tachocline réfléchissante) ont
> été imposés par les mesures : sans eux, la zone convective se vidait ou le gaz s'accumulait
> au fond / au centre (densité relative jusqu'à ×15). Contrôle : `__sim.measure()`.

Tous les paramètres sont réglables dans le panneau.

## 3. Architecture

- **Web** : Vite + TypeScript + Three.js (version figée), lil-gui (panneau). Rien d'autre.
- **Tout le calcul sur la carte graphique** (GPGPU, `GPUComputationRenderer`) : deux textures
  flottantes en ping-pong — `texturePosition` (xyz + T) et `textureVelocity` (xyz + graine).
  Aucune relecture GPU → CPU par image (sauf 1 pixel en mode « Suivi »).
- **Rendu** : `THREE.Points` dont le vertex shader lit directement les textures ; mélange additif,
  couleur « corps noir » ; noyau émissif + halo ; bloom (`UnrealBloomPass`) ; traînées
  (`AfterimagePass`) en mode Traceurs.

```
src/
├── main.ts                 ← assemblage, boucle, clavier
├── sim/GasSimulation.ts    ← GPGPU : état des particules, paramètres physiques
├── sim/shaders/*.glsl      ← bruit, vitesse, position + température
├── render/GasPoints.ts     ← particules (lisent les textures)
├── render/Core.ts          ← noyau, halo, couronne
├── render/Layers.ts        ← couches en fil de fer (noyau / radiative / convective)
├── render/PostFX.ts        ← bloom, traînées, sortie
├── view/ViewModes.ts       ← définition des 6 modes
├── view/CameraRig.ts       ← cadrage auto, bornes, transitions, suivi
├── perf/AdaptiveQuality.ts ← paliers de particules selon le temps d'image
└── ui/Panel.ts, ui/Hud.ts  ← panneau de réglages, légende et aide
```

## 4. Budget de performance

| Palier | Texture | Particules | Cible |
|---|---|---|---|
| 0 | 256² | 65 536 | GPU intégré, repli half-float |
| 1 | 512² | 262 144 | **démarrage** |
| 2 | 724² | 524 176 | GPU dédié portable |
| 3 | 1024² | 1 048 576 | GPU dédié de bureau |

- Cible : **60 fps** sur GPU dédié de portable, **≥ 30 fps** sur GPU intégré.
- **Qualité adaptative** : si le temps d'image moyen dépasse 20 ms (< 50 fps) pendant 2 s → palier
  inférieur ; s'il reste sous 13 ms pendant 4 s → palier supérieur (un palier qui a échoué n'est
  plus retenté). Désactivable (palier manuel). Limite : sur un écran 60 Hz le temps d'image ne
  descend jamais sous 16,7 ms, la montée ne se déclenche donc qu'au-delà de 60 Hz → départ au
  **palier 2 sur PC** (0 sur écran tactile), la descente automatique corrige si besoin.
- Mode Suivi : position de la parcelle lue **en asynchrone** (une lecture bloquante coûtait ~7 ms).
- `pixelRatio` plafonné à 1,5 (1 au palier 0) ; boucle stoppée quand l'onglet est caché ;
  aucune allocation par image ; pas de temps plafonné (1/30 s) pour éviter les explosions.
- Repli : sans `EXT_color_buffer_float` → textures half-float, palier 0 uniquement, message.

## 5. Modes de vue (touches 1 à 6)

1. **Extérieur** — le soleil vu de l'espace, surface mise en valeur, granulation.
2. **Coupe** — la moitié tournée vers la caméra est retirée : noyau + cellules visibles ; la coupe
   suit la caméra quand on tourne.
3. **Température** — palette de chaleur (bleu nuit → violet → orange → jaune-blanc).
4. **Vitesse radiale** — gaz montant en rouge, descendant en bleu → cellules évidentes.
5. **Traceurs** — une fraction des parcelles laisse une traînée : on voit les boucles.
6. **Suivi** — la caméra accompagne une parcelle de gaz (touche F = une autre).

Transitions animées (~0,8 s). Options : vitesse du temps, couches en fil de fer, réglages de coupe.

## 6. Cadrage caméra

- Distance calculée pour que la sphère occupe ~80 % de la plus petite dimension de la fenêtre
  (tient compte du rapport largeur/hauteur), recalculée au redimensionnement.
- Rotation amortie, zoom borné (0,4 R → 3 × la distance de cadrage), pas de déplacement latéral.
- `R` = recadrer.

## 7. Risques

| # | Risque | Parade |
|---|---|---|
| 1 | GPU faible → saccades | Qualité adaptative, paliers, pixelRatio plafonné |
| 2 | Pas de textures flottantes (vieux GPU / mobile) | Repli half-float + palier 0 |
| 3 | Accumulation des particules (au centre ou en surface) | **Réalisé** : écoulement à divergence nulle suivi sans inertie (RK2), Archimède relatif à la moyenne de la couche, tachocline réfléchissante — densité mesurée 0,87-1,16 |
| 4 | Saturation de l'image (mélange additif de 1 M points) | Luminosité normalisée par √(nombre de particules) |
| 5 | Explosion numérique (onglet en arrière-plan, gros dt) | dt plafonné, vitesse plafonnée, pause onglet caché |

## 8. Jalons (réalisés d'une traite, à la demande de Matteo)

| Jalon | Contenu | Vérification |
|---|---|---|
| J1 | Squelette Vite/TS/Three, noyau + halo + bloom, caméra cadrée, panneau + fps | `npm run build` OK, soleil centré |
| J2 | GPGPU : gravité, chauffage, refroidissement, Archimède, cellules + turbulence | Convection visible ; vr moyen chaud > 0, froid < 0 |
| J3 | 6 modes de vue + transitions + coupe | Capture de chaque mode, console sans erreur |
| J4 | Qualité adaptative, repli GPU, pause onglet caché | Changement de palier observé, fps relevés |
| J5 | Finitions, README, réglages par défaut | Lancement à froid OK |

## 9. Mesures

Voir section « Mesures » du README (relevées le 2026-11-16 sur Intel Iris Xe : 2,6 ms à 65 k
parcelles, 14,8 ms à 1 M). Non mesuré : fps réel en continu sur un GPU dédié et sur téléphone.
