/**
 * Les 6 modes de vue. Chaque mode fixe des réglages par défaut (couleur, coupe,
 * bloom…) ; l'utilisateur peut ensuite les modifier dans le panneau.
 */
export type ViewModeId = 'exterior' | 'cut' | 'temperature' | 'velocity' | 'tracers' | 'follow';
export type Legend = 'blackbody' | 'heat' | 'velocity';

export interface ViewMode {
  id: ViewModeId;
  key: string;
  label: string;
  colorMode: 0 | 1 | 2;     // 0 corps noir, 1 carte de chaleur, 2 vitesse radiale
  cut: boolean;
  surfaceEmphasis: number;
  tracers: boolean;
  bloom: number;
  coreIntensity: number;
  corona: number;
  layers: boolean;
  legend: Legend;
  hint: string;
}

export const VIEW_MODES: ViewMode[] = [
  {
    id: 'exterior', key: '1', label: 'Extérieur', colorMode: 0, cut: false, surfaceEmphasis: 1,
    tracers: false, bloom: 0.8, coreIntensity: 0, corona: 1, layers: false, legend: 'blackbody',
    hint: 'Le soleil vu de l’espace : la surface (photosphère) et sa granulation, là où le gaz monté du fond se refroidit.',
  },
  {
    id: 'cut', key: '2', label: 'Coupe', colorMode: 0, cut: true, surfaceEmphasis: 0,
    tracers: false, bloom: 0.75, coreIntensity: 1, corona: 0, layers: true, legend: 'blackbody',
    hint: 'La moitié tournée vers toi est retirée : noyau au centre, zone radiative calme, puis zone convective qui bouillonne.',
  },
  {
    id: 'temperature', key: '3', label: 'Température', colorMode: 1, cut: true, surfaceEmphasis: 0,
    tracers: false, bloom: 0.35, coreIntensity: 0.8, corona: 0, layers: true, legend: 'heat',
    hint: 'Échelle logarithmique de 5 800 K (surface) à 15 millions K (cœur). Les panaches chauds montent depuis le bas de la zone convective.',
  },
  {
    id: 'velocity', key: '4', label: 'Vitesse radiale', colorMode: 2, cut: true, surfaceEmphasis: 0,
    tracers: false, bloom: 0.3, coreIntensity: 0.5, corona: 0, layers: true, legend: 'velocity',
    hint: 'Rouge = le gaz monte, bleu = il descend. Les cellules de convection apparaissent comme des colonnes alternées.',
  },
  {
    id: 'tracers', key: '5', label: 'Traceurs', colorMode: 0, cut: true, surfaceEmphasis: 0,
    tracers: true, bloom: 0.6, coreIntensity: 0.8, corona: 0, layers: true, legend: 'blackbody',
    hint: 'Quelques parcelles laissent une traînée : on suit leurs boucles (monter chaud, redescendre froid).',
  },
  {
    id: 'follow', key: '6', label: 'Suivi d’une parcelle', colorMode: 0, cut: true, surfaceEmphasis: 0,
    tracers: false, bloom: 0.6, coreIntensity: 0.8, corona: 0, layers: true, legend: 'blackbody',
    hint: 'La caméra accompagne la parcelle verte. Touche F : en choisir une autre.',
  },
];

export function modeById(id: ViewModeId): ViewMode {
  return VIEW_MODES.find((m) => m.id === id)!;
}
