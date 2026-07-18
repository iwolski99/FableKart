// AI difficulty tiers. skillMin/skillMax bound the per-kart skill value
// (0..1) that aiController.js uses for steering precision, cornering grip,
// throttle discipline and shortcut usage — see buildField() in game.js.
export const DIFFICULTIES = [
  {
    id: 'easy', name: 'Easy',
    blurb: 'Relaxed CPUs that wander off line — great for learning a track.',
    skillMin: 0.05, skillMax: 0.30,
  },
  {
    id: 'normal', name: 'Normal',
    blurb: 'A fair fight from start to finish.',
    skillMin: 0.35, skillMax: 0.62,
  },
  {
    id: 'hard', name: 'Hard',
    blurb: 'Sharp lines and fast corners — hard to shake.',
    skillMin: 0.62, skillMax: 0.85,
  },
  {
    id: 'expert', name: 'Expert',
    blurb: 'Clean laps, big grip, takes every shortcut. No mercy.',
    skillMin: 0.85, skillMax: 1.0,
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
