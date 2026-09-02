import { Engine } from './core/engine.js';
import { Menu } from './menu.js';
import { analyzeBuffer } from './core/analyzer.js';
import { RhythmGame } from './games/rhythm.js';
import { SurvivalGame } from './games/survival.js';
import { ShooterGame } from './games/shooter.js';
import { RunnerGame } from './games/runner.js';
import { CaveGame } from './games/cave.js';
import { SimonGame } from './games/simon.js';
import { SnakeGame } from './games/snake.js';
import { BreakerGame } from './games/breaker.js';
import { GolfGame } from './games/golf.js';
import { FishingGame } from './games/fish.js';

const GAMES = [RhythmGame, SurvivalGame, ShooterGame, RunnerGame, CaveGame, SimonGame, SnakeGame, BreakerGame, GolfGame, FishingGame];

const engine = new Engine(document.getElementById('game'));
engine.menuFactory = () => new Menu(engine, GAMES);
engine.setApp(engine.menuFactory());
engine.start();

window.__engine = engine; // debug console

// ---------- modale d'intro : le clic/une touche débloque l'audio puis lance le menu ----------
const gate = document.getElementById('gate');
const padEl = document.getElementById('gate-pad');
const padPoll = setInterval(() => {
  if (!gate.isConnected) { clearInterval(padPoll); return; }
  const pads = navigator.getGamepads ? [...navigator.getGamepads()].filter((p) => p && p.connected) : [];
  if (pads.length) {
    padEl.textContent = 'Manette : ✓ ' + pads[0].id.slice(0, 30);
    padEl.classList.add('ok');
  } else {
    padEl.textContent = 'Manette : aucune détectée — le clavier fonctionne aussi';
    padEl.classList.remove('ok');
  }
}, 300);

let launched = false;
const start = () => {
  if (launched || !gate.isConnected) return;
  launched = true;
  clearInterval(padPoll);
  engine.audio.unlock();
  engine.input.absorb(); // la frappe qui ferme la modale ne doit rien déclencher dans le menu
  gate.classList.add('hidden');
  setTimeout(() => gate.remove(), 450);
};
gate.addEventListener('pointerdown', start);
addEventListener('keydown', start);

// ---------- chargement de la playlist audio (BLOB BEAT) ----------
const fileInput = document.getElementById('file-audio');
const dirInput = document.getElementById('file-audio-dir');
const deliver = (list) => {
  const app = engine.app;
  if (app && app.onFilesChosen) app.onFilesChosen(list);
};
fileInput.addEventListener('change', () => { deliver([...fileInput.files]); fileInput.value = ''; });
dirInput.addEventListener('change', () => {
  deliver([...dirInput.files].sort((a, b) => a.name.localeCompare(b.name)));
  dirInput.value = '';
});
window.__blobArcade = {
  pickFiles: () => fileInput.click(),
  pickFolder: () => dirInput.click(),
  analyzeBuffer, // debug/console
};
