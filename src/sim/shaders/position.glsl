// ============================================================================
// Mise à jour de la POSITION et de la TEMPÉRATURE des parcelles.
// ============================================================================
uniform float uDt;
uniform float uHeat;       // chauffage par le noyau (1/s)
uniform float uCool;       // refroidissement radiatif en surface (1/s)
uniform float uDiffusion;  // diffusion de la chaleur vers l'équilibre (1/s)
uniform float uCoreR;      // rayon du noyau
uniform float uRadR;       // haut de la zone radiative (0 = absente)

void main() {
  vec2 uv = gl_FragCoord.xy / resolution.xy;
  vec4 P = texture2D(texturePosition, uv);
  vec4 V = texture2D(textureVelocity, uv);

  // Advection
  float rOld = length(P.xyz);
  vec3 pos = P.xyz + V.xyz * uDt;
  float r = length(pos);
  if (r > 0.995) { pos *= 0.995 / r; r = 0.995; }

  // Frontière zone radiative / zone convective (tachocline) : réfléchissante.
  // Sans elle, le gaz froid qui plonge s'accumule dans la zone radiative, où
  // rien ne le ramène, et la zone convective se vide.
  if (uRadR > 0.0 && r > 1e-4) {
    if (rOld >= uRadR && r < uRadR) { pos *= (uRadR + 0.002) / r; r = uRadR + 0.002; }
    else if (rOld < uRadR && r >= uRadR) { pos *= (uRadR - 0.002) / r; r = uRadR - 0.002; }
  }

  // Chaleur : noyau qui chauffe, surface qui rayonne, diffusion vers Teq(r).
  float T = P.w;
  float core = 1.0 - smoothstep(uCoreR * 0.7, uCoreR * 1.3, r);
  float surf = smoothstep(0.9, 1.0, r);
  // Zone radiative : la chaleur y circule par diffusion (rayonnement), donc vite.
  float diff = uDiffusion * ((uRadR > 0.0 && r < uRadR) ? 10.0 : 1.0);
  T += uDt * (uHeat * core * (1.0 - T) - uCool * surf * T + diff * (teq(r) - T));
  // Avec zone radiative : la chaleur du noyau arrive par le bas de la zone
  // convective (comme une casserole sur le feu). Le gaz qui touche le fond se
  // réchauffe au-dessus de l'équilibre -> il redevient léger et remonte.
  if (uRadR > 0.0 && r >= uRadR) {
    float base = 1.0 - smoothstep(uRadR, uRadR + 0.06, r);
    T += uDt * uHeat * base * (min(teq(uRadR) + 0.15, 1.0) - T);
  }
  T = clamp(T, 0.0, 1.0);

  gl_FragColor = vec4(pos, T);
}
