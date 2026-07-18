// Playable roster. Stats are 0..1 and map onto physics ranges in kart.js.
//   speed    → top speed
//   accel    → how fast you reach it
//   handling → steering rate + drift control
//   weight   → shoved less in collisions, but hops/handles heavier

export const CHARACTERS = [
  {
    id: 'bolt',
    name: 'Bolt',
    blurb: 'All-rounder. Reliable in every corner.',
    color: 0x2f7bff,
    accent: 0xffffff,
    helmet: 0xffce3a,
    speed: 0.62, accel: 0.62, handling: 0.62, weight: 0.5,
  },
  {
    id: 'blaze',
    name: 'Blaze',
    blurb: 'Blistering top speed, but slow to wind up and wide in turns.',
    color: 0xff4b2e,
    accent: 0xffd23a,
    helmet: 0x22242e,
    speed: 1.0, accel: 0.28, handling: 0.3, weight: 0.72,
  },
  {
    id: 'pip',
    name: 'Pip',
    blurb: 'Tiny terror. Rockets off the line and darts through corners.',
    color: 0x2ed573,
    accent: 0xd9ffe8,
    helmet: 0xffffff,
    speed: 0.34, accel: 1.0, handling: 0.95, weight: 0.18,
  },
  {
    id: 'brick',
    name: 'Brick',
    blurb: 'A wall on wheels. Bumps rivals aside and never gets pushed around.',
    color: 0x9b59ff,
    accent: 0x3c3f52,
    helmet: 0xcfd3e8,
    speed: 0.78, accel: 0.42, handling: 0.34, weight: 1.0,
  },
];

// AI-only palette variations so a full grid of 8 looks varied even though
// they reuse the four chassis.
export const AI_SKINS = [
  { name: 'Rusty',  color: 0xc47a2e, helmet: 0xffffff },
  { name: 'Minty',  color: 0x35d6c0, helmet: 0x22242e },
  { name: 'Vex',    color: 0xe83e8c, helmet: 0xf5e9b8 },
  { name: 'Shade',  color: 0x4a4e69, helmet: 0xff5f5f },
  { name: 'Sunny',  color: 0xffc93a, helmet: 0x2f7bff },
  { name: 'Frost',  color: 0x9fd8ff, helmet: 0x2b3a67 },
  { name: 'Mocha',  color: 0x7a5230, helmet: 0x7cf7c4 },
];
