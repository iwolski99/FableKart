// Keyboard input singleton. Game code reads high-level intents (accel, steer,
// drift…) rather than raw keys; `justPressed` events are cleared at frame end.

const down = new Set();
const pressedThisFrame = new Set();

const PREVENT = new Set([
  'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space',
]);

let initialized = false;
const gestureCallbacks = [];

export function initInput() {
  if (initialized) return;
  initialized = true;
  window.addEventListener('keydown', (e) => {
    if (PREVENT.has(e.code)) e.preventDefault();
    if (!down.has(e.code)) pressedThisFrame.add(e.code);
    down.add(e.code);
    fireGesture();
  });
  window.addEventListener('keyup', (e) => down.delete(e.code));
  window.addEventListener('blur', () => down.clear());
  window.addEventListener('pointerdown', fireGesture);
}

function fireGesture() {
  while (gestureCallbacks.length) gestureCallbacks.pop()();
}

export const input = {
  get accel() { return down.has('ArrowUp') || down.has('KeyW'); },
  get brake() { return down.has('ArrowDown') || down.has('KeyS'); },
  /** steer: +1 = left, -1 = right */
  get steer() {
    let s = 0;
    if (down.has('ArrowLeft') || down.has('KeyA')) s += 1;
    if (down.has('ArrowRight') || down.has('KeyD')) s -= 1;
    return s;
  },
  get drift() {
    return down.has('Space') || down.has('ShiftLeft') || down.has('ShiftRight');
  },
  isDown(code) { return down.has(code); },
  justPressed(...codes) { return codes.some((c) => pressedThisFrame.has(c)); },
  get itemPressed() {
    return this.justPressed('KeyE', 'Enter', 'ControlLeft', 'ControlRight');
  },
  /** Run cb on the next user gesture (needed to unlock WebAudio). */
  onFirstGesture(cb) { gestureCallbacks.push(cb); },
  endFrame() { pressedThisFrame.clear(); },
};
