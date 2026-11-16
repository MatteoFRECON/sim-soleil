// ============================================================================
// Mise à jour de la VITESSE des parcelles de gaz (une parcelle = un texel).
// texturePosition : xyz = position, w = température normalisée
// textureVelocity : xyz = vitesse,  w = graine aléatoire fixe (0..1)
// ============================================================================
uniform float uDt;
uniform float uTime;
uniform float uGravity;      // constante de gravitation (échelle)
uniform float uCoreMass;     // masse du noyau
uniform float uGasMass;      // masse totale du gaz (répartie uniformément)
uniform float uBuoyancy;     // coefficient de dilatation thermique (Archimède)
uniform float uCellSpeed;    // vitesse des cellules de convection
uniform float uCellScale;    // fréquence spatiale des cellules (plus grand = plus de cellules)
uniform float uCellEvolve;   // vitesse d'évolution des cellules dans le temps
uniform float uTurbulence;   // intensité de la turbulence à petite échelle
uniform float uTurbScale;    // fréquence de la turbulence
uniform float uRadR;         // haut de la zone radiative (0 = pas de zone radiative)
uniform float uMaxSpeed;     // vitesse maximale (sécurité numérique)
uniform float uCoreR;        // rayon du noyau (sa masse est répartie dans ce rayon)

uniform sampler2D uProfile;  // somme (T, nombre) par couche de rayon (64 couches)
uniform float uUseProfile;

const float PI = 3.14159265;

// Température moyenne du gaz à la même altitude (référence d'Archimède).
// À défaut (profil indisponible ou couche vide), profil d'équilibre.
float meanT(float r) {
  if (uUseProfile < 0.5) return teq(r);
  vec4 s = texture2D(uProfile, vec2((min(floor(r * 64.0), 63.0) + 0.5) / 64.0, 0.5));
  return s.y > 3.0 ? s.x / s.y : teq(r);
}

// Écoulement « porteur » au point p : cellules de convection + turbulence.
vec3 flowAt(vec3 p) {
  float r = length(p);

  // --- Cellules de convection (grande échelle, divergence nulle) ---
  // Enveloppe psi = sin(pi u), nulle en bas et en haut de la zone convective.
  // u est pris en r^2 (et pas en r) : psi reste lisse au centre exact quand il
  // n'y a pas de zone radiative (sinon pointe en r = 0 -> le gaz s'y accumule).
  float r0 = uRadR;
  float span2 = 1.0 - r0 * r0;
  float u = (r * r - r0 * r0) / span2;
  float inZone = step(0.0, u) * step(u, 1.0);
  float uc = clamp(u, 0.0, 1.0);
  float psi = sin(PI * uc) * inZone;
  vec3 gradPsi = p * (2.0 * PI / span2) * cos(PI * uc) * inZone;
  vec3 vCells = curlPsiNoise(p, uCellScale, uTime * uCellEvolve, psi, gradPsi) / uCellScale;

  // --- Turbulence (petite échelle, nulle à la surface) ---
  float psiT = 1.0 - r * r;
  vec3 gradPsiT = -2.0 * p;
  vec3 vTurb = curlPsiNoise(p, uTurbScale, uTime * uCellEvolve * 3.0 + 17.0, psiT, gradPsiT) / uTurbScale;

  // Dans la zone radiative le gaz est stable : presque pas de mouvement.
  float zone = r0 > 0.0 ? mix(0.08, 1.0, smoothstep(r0 - 0.04, r0 + 0.04, r)) : 1.0;
  return uCellSpeed * vCells + uTurbulence * zone * vTurb;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(texturePosition, uv);
  vec4 V = texture2D(textureVelocity, uv);

  // Les deux textures sont mises à jour en parallèle à partir de l'état précédent :
  // le shader de position applique CETTE vitesse au pas suivant. On l'évalue donc
  // à la position où sera la parcelle (pNext), sinon on a un pas de retard qui,
  // comme l'inertie, centrifuge les parcelles hors des rouleaux de convection.
  vec3 pNext = P.xyz + V.xyz * uDt;
  float rn = length(pNext);
  if (rn > 0.995) { pNext *= 0.995 / rn; }
  float T = P.w;
  float r = length(pNext);
  vec3 n = r > 1e-5 ? pNext / r : vec3(0.0, 1.0, 0.0);

  float r0 = uRadR;
  float u = (r - r0) / (1.0 - r0);
  float zone = r0 > 0.0 ? mix(0.08, 1.0, smoothstep(r0 - 0.04, r0 + 0.04, r)) : 1.0;

  // --- 1-2. Écoulement porteur au point milieu (schéma RK2) ------------------
  // Les parcelles suivent exactement l'écoulement (gaz visqueux, pas d'inertie) :
  // le champ étant à divergence nulle, la densité reste uniforme.
  vec3 v1 = flowAt(pNext);
  vec3 vel = flowAt(pNext + v1 * (0.5 * uDt));

  // --- 3. Gravité du noyau + poussée d'Archimède (Boussinesq) ---------------
  // g(r) = G (M_noyau + M_gaz r^3) / (r^2 + eps^2), dirigée vers le centre.
  // La gravité moyenne est équilibrée par la pression (équilibre hydrostatique) ;
  // seul l'écart à la température MOYENNE du gaz à la même altitude crée une
  // force : le chaud monte. (Flux net nul à travers chaque couche : pas d'accumulation.)
  // Gaz visqueux : la poussée donne directement une vitesse de dérive (vitesse limite).
  // Le noyau a une taille : sous son rayon, la masse enfermée décroît en r^3 (g -> 0 au centre).
  float mCore = uCoreMass * pow(min(r / uCoreR, 1.0), 3.0);
  float g = uGravity * (mCore + uGasMass * r * r * r) / (r * r + 0.02);
  // Nulle à la surface et faible au fond : elle ne plaque pas le gaz contre les bords.
  float edge = mix(0.15, 1.0, smoothstep(0.0, 0.12, u)) * (1.0 - smoothstep(0.8, 1.0, u));
  // Sans zone radiative : pas de poussée dans le cœur (comme le vrai Soleil, dont
  // le cœur ne convecte pas) ; sinon le gaz froid tombe au centre et y reste.
  if (r0 <= 0.0) edge = smoothstep(0.15, 0.4, r) * (1.0 - smoothstep(0.8, 1.0, r));
  vel += uBuoyancy * g * (T - meanT(r)) * n * zone * edge;

  float sp = length(vel);
  if (sp > uMaxSpeed) vel *= uMaxSpeed / sp;

  gl_FragColor = vec4(vel, V.w);
}
