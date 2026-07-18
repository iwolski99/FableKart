// Maps the input singleton onto a kart's control struct.
import { input } from '../core/input.js';

export class PlayerController {
  constructor(kart) {
    this.kart = kart;
    this.isPlayer = true;
  }

  update() {
    const c = this.kart.control;
    c.throttle = input.accel ? 1 : 0;
    c.brake = input.brake;
    c.steer = input.steer;
    c.drift = input.drift;
    c.useItem = input.itemPressed;
  }
}
