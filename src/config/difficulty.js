// AI difficulty tiers. skillMin/skillMax bound the per-kart skill value
// (0..1) that aiController.js uses for steering precision, cornering grip,
// throttle discipline and shortcut usage. speedMult is a flat top-speed/
// accel multiplier on top of that — driving-skill tuning alone has a limit
// to how much it can widen the gap without AI behavior getting unstable, so
// higher tiers also get a modest raw pace advantage (and Easy a slight
// handicap) to make sure each tier is clearly, reliably harder than the last.
export const DIFFICULTIES = [
  {
    id: 'easy', name: 'Easy',
    blurb: 'Relaxed CPUs that wander off line — great for learning a track.',
    skillMin: 0.05, skillMax: 0.30, speedMult: 0.93,
  },
  {
    id: 'normal', name: 'Normal',
    blurb: 'A fair fight from start to finish.',
    skillMin: 0.35, skillMax: 0.62, speedMult: 1.0,
  },
  {
    id: 'hard', name: 'Hard',
    blurb: 'Sharp lines and fast corners — hard to shake.',
    skillMin: 0.62, skillMax: 0.85, speedMult: 1.04,
  },
  {
    id: 'expert', name: 'Expert',
    blurb: 'Clean laps, big grip, takes every shortcut. No mercy.',
    skillMin: 0.85, skillMax: 1.0, speedMult: 1.08,
  },
];

export function getDifficulty(id) {
  return DIFFICULTIES.find((d) => d.id === id) || DIFFICULTIES[1];
}

const DIFF_KEY = 'fablekart_difficulty';
export function loadDifficultyId() {
  try {
    const v = localStorage.getItem(DIFF_KEY);
    return DIFFICULTIES.some((d) => d.id === v) ? v : 'normal';
  } catch {
    return 'normal';
  }
}
export function saveDifficultyId(id) {
  try { localStorage.setItem(DIFF_KEY, id); } catch { /* storage unavailable */ }
}
