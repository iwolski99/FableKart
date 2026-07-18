// Track definitions. Everything is procedural: a closed Catmull-Rom spline
// defines the ribbon; features are placed by fraction-of-lap `s` values.
//
//  - points:    control points of the closed center spline [x, y, z]
//  - width:     full road width in meters
//  - walls:     s-fraction ranges that get physical barriers ('left'/'right'
//               relative to direction of travel, or 'both')
//  - shortcut:  a dirt cut. entryCP/exitCP are control-point indices on the
//               main loop; side is +1 (track-left) / -1; mids shape the path
//               relative to the entry→exit chord: [alongFrac, lateralM, liftM]
//  - hazards:   sweeper = moves side to side across the road,
//               geyser  = periodic eruption at a fixed spot
//  - boostPads: lat is -1..1 across the half-width

export const TRACKS = [
  {
    id: 'meadow',
    name: 'Meadow Loop',
    tagline: 'Rolling hills, one sneaky dirt cut, and hay with attitude.',
    difficulty: 1,
    laps: 3,
    width: 15,
    points: [
      [0, 0, 70], [60, 0, 70], [110, 0, 55], [130, 2, 10],
      [105, 4, -30], [60, 7, -45], [30, 8, -80], [55, 6, -120],
      [20, 4, -140], [-40, 2, -130], [-80, 0, -95], [-125, 0, -70],
      [-135, 0, -20], [-95, 0, 0], [-120, 0, 40], [-85, 0, 85],
      [-30, 0, 95],
    ],
    walls: [
      { from: 0.2, to: 0.52, side: 'both' },
      { from: 0.55, to: 0.68, side: 'both' },
    ],
    shortcut: {
      entryCP: 13, exitCP: 16, side: 1, width: 9,
      mids: [[0.35, -6, 0.6], [0.7, 4, 0.2]],
    },
    itemBoxes: [0.12, 0.37, 0.62, 0.86],
    boostPads: [
      { s: 0.3, lat: 0, halfw: 0.55, len: 7 },
      { s: 0.565, lat: 0, halfw: 0.55, len: 6 },
      { s: 0.95, lat: 0, halfw: 0.6, len: 8 },
    ],
    hazards: [
      { type: 'sweeper', style: 'hay', s: 0.47, range: 0.72, period: 5.2, radius: 1.7, phase: 0 },
      { type: 'sweeper', style: 'hay', s: 0.76, range: 0.66, period: 4.2, radius: 1.7, phase: 1.5 },
    ],
    theme: {
      key: 'meadow', night: false,
      skyTop: 0x2f7fe0, skyBottom: 0xbfe8ff, sunColor: 0xfff2cc,
      sunDir: [0.5, 0.72, 0.35], sunIntensity: 2.6, hemi: 0.85,
      fogColor: 0xcfe4f7, fogNear: 140, fogFar: 520,
      terrainColor: 0x58a94e, terrainColorB: 0x3f8c3c, hilliness: 3.2,
      roadTint: 0xffffff, curbA: 0xe23c3c, curbB: 0xf2f0e8,
      wallColor: 0xc9c4b4, wallAccent: 0xe23c3c,
    },
  },

  {
    id: 'volcano',
    name: 'Ember Caldera',
    tagline: 'A high ridge over boiling lava. Mind the geysers.',
    difficulty: 3,
    laps: 3,
    width: 13,
    points: [
      [0, 0, 90], [70, 0, 85], [120, 3, 50], [135, 6, -5],
      [110, 10, -60], [60, 13, -85], [10, 14, -70], [-25, 12, -118],
      [-70, 9, -138], [-110, 6, -80], [-130, 3, -30], [-110, 0, 15],
      [-135, 0, 60], [-90, 0, 95], [-40, 0, 80],
    ],
    walls: [
      { from: 0.0, to: 0.3, side: 'both' },
      { from: 0.3, to: 0.62, side: 'right' },
      { from: 0.62, to: 1.0, side: 'both' },
    ],
    shortcut: {
      entryCP: 6, exitCP: 9, side: 1, width: 7.5,
      mids: [[0.45, 2, 3.2], [0.75, -2, 1.4]],
    },
    itemBoxes: [0.1, 0.33, 0.58, 0.82],
    boostPads: [
      { s: 0.24, lat: 0, halfw: 0.55, len: 7 },
      { s: 0.44, lat: 0, halfw: 0.6, len: 7 },
      { s: 0.9, lat: 0, halfw: 0.55, len: 8 },
    ],
    hazards: [
      { type: 'geyser', style: 'lava', s: 0.18, lat: -0.4, period: 6.0, active: 1.5, warn: 1.3, radius: 2.5, phase: 0 },
      { type: 'geyser', style: 'lava', s: 0.52, lat: 0.35, period: 5.2, active: 1.4, warn: 1.2, radius: 2.5, phase: 2.2 },
      { type: 'geyser', style: 'lava', s: 0.78, lat: 0, period: 6.8, active: 1.6, warn: 1.4, radius: 2.6, phase: 4.0 },
    ],
    theme: {
      key: 'volcano', night: false,
      skyTop: 0x1d0f1e, skyBottom: 0xff8a3c, sunColor: 0xffb066,
      sunDir: [-0.35, 0.4, 0.6], sunIntensity: 1.7, hemi: 0.5,
      fogColor: 0x54262a, fogNear: 90, fogFar: 380,
      terrainColor: 0x453a3e, terrainColorB: 0x2c2226, hilliness: 5.0,
      roadTint: 0xdcd0cc, curbA: 0xf2b632, curbB: 0x28221f,
      wallColor: 0x5d4a49, wallAccent: 0xf2b632,
    },
  },

  {
    id: 'neon',
    name: 'Neon Vale',
    tagline: 'Night city sprint with an overpass and a glowing back alley.',
    difficulty: 2,
    laps: 3,
    width: 14,
    points: [
      [0, 0, 100], [75, 0, 95], [120, 0, 55], [125, 0, -5],
      [90, 0, -55], [35, 0, -75], [-15, 1, -95], [-70, 4, -80],
      [-95, 8, -35], [-65, 9, 5], [-30, 9, 30], [10, 7, 55],
      [48, 3, 32], [42, 0, -32], [-20, 0, -5], [-60, 0, 35],
      [-95, 0, 70], [-60, 0, 100],
    ],
    walls: [
      { from: 0.0, to: 1.0, side: 'both' },
    ],
    shortcut: {
      entryCP: 12, exitCP: 14, side: 1, width: 8,
      mids: [[0.5, 3, 0.2]],
    },
    itemBoxes: [0.11, 0.34, 0.57, 0.8],
    boostPads: [
      { s: 0.04, lat: 0, halfw: 0.6, len: 8 },
      { s: 0.47, lat: 0, halfw: 0.55, len: 7 },
      { s: 0.69, lat: 0, halfw: 0.55, len: 7 },
    ],
    hazards: [
      { type: 'sweeper', style: 'drone', s: 0.2, range: 0.7, period: 4.6, radius: 1.6, phase: 0.6 },
      { type: 'geyser', style: 'steam', s: 0.52, lat: 0.3, period: 5.5, active: 1.4, warn: 1.1, radius: 2.2, phase: 1.0 },
      { type: 'sweeper', style: 'drone', s: 0.86, range: 0.68, period: 5.4, radius: 1.6, phase: 2.8 },
    ],
    theme: {
      key: 'city', night: true,
      skyTop: 0x04061a, skyBottom: 0x27184a, sunColor: 0xbfd4ff,
      sunDir: [-0.4, 0.8, -0.3], sunIntensity: 0.65, hemi: 0.35,
      fogColor: 0x0d1030, fogNear: 110, fogFar: 420,
      terrainColor: 0x131722, terrainColorB: 0x0b0e17, hilliness: 1.4,
      roadTint: 0x9fb4d8, curbA: 0x27e0ff, curbB: 0x1a1e30,
      wallColor: 0x232838, wallAccent: 0xff3aa0,
    },
  },
];

export function getTrack(id) {
  return TRACKS.find((t) => t.id === id) || TRACKS[0];
}
