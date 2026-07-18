import { initInput } from './core/input.js';
import { Game } from './core/game.js';

initInput();
const game = new Game();
game.start();

// handy for debugging / automated smoke tests
window.__game = game;
