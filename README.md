# Sim Soleil

Simulation 3D temps réel d'une étoile type Soleil : un **noyau** qui chauffe le gaz et porte la
masse, une **zone radiative** calme, une **zone convective** où le gaz chaud monte, se refroidit en
surface et redescend. Tout est calculé sur la carte graphique (jusqu'à 1 million de parcelles).

Le pourquoi et le comment (modèle physique, architecture, budget de performance) : voir
[CADRAGE.md](CADRAGE.md).

## Lancer

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:5199. Version autonome : `npm run build` → dossier `dist/`
(à servir par un petit serveur web, par ex. `npm run preview`).

## Commandes

| Touche / geste | Action |
|---|---|
| Souris (glisser) / un doigt | Tourner autour du soleil |
| Molette / pincer | Zoom (borné) |
| `1` … `6` | Modes de vue (aussi : boutons en bas) |
| `R` | Recadrer le soleil entier |
| `Espace` | Pause |
| `F` | Suivre une autre parcelle |
| `H` | Masquer / afficher l'interface |

## Modes de vue

1. **Extérieur** — la surface et sa granulation.
2. **Coupe** — la moitié tournée vers la caméra est retirée ; la tranche est mise en valeur.
3. **Température** — échelle logarithmique 5 800 K → 15 MK.
4. **Vitesse radiale** — rouge = monte, bleu = descend : les cellules de convection.
5. **Traceurs** — quelques parcelles laissent une traînée.
6. **Suivi** — la caméra accompagne une parcelle (en vert).

Le panneau **Réglages** (en haut à droite) donne accès à la physique (masses, chauffage,
refroidissement, poussée d'Archimède, cellules, turbulence, zone radiative), au rendu et au
palier de performance.

## Mesures (2026-11-16, PC de Matteo, Intel Iris Xe intégré, fenêtre 1024 × 768)

Temps par image (simulation + rendu, GPU synchronisé) :

| Palier | Parcelles | ms / image |
|---|---|---|
| 0 | 65 536 | 2,6 |
| 1 | 262 144 | 6,3 |
| 2 | 524 176 | 8,9 |
| 3 | 1 048 576 | 14,8 |

→ 60 fps tenus jusqu'à 1 M de parcelles sur ce GPU intégré. Départ : palier 2 sur PC, 0 sur
écran tactile ; descente automatique si < 50 fps pendant 2 s.

Contrôle physique (`__sim.measure()` après 30 s, réglages par défaut) : densité relative par
couche de 0,1 entre 0,87 et 1,16 (1 = uniforme) ; vitesse radiale moyenne du gaz plus chaud que
son entourage **+0,22**, du gaz plus froid **−0,13** → le chaud monte, le froid descend.

## Outils de développement (console du navigateur)

- `__sim.measure()` — densité par couche, vitesses radiales moyennes chaud / froid.
- `__sim.setMode('cut')`, `__sim.setTier(3)` — changer de mode / de palier.
- `__sim.shot('nom', 60)` — avance de 60 images et enregistre une capture dans `.shots/nom.jpg`
  (serveur de dev uniquement).
