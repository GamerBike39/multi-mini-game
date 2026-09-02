import { Engine } from './core/engine';
import { Menu } from './menu';
import { analyzeBuffer } from './core/analyzer';
import { RhythmGame } from './games/rhythm';
import { SurvivalGame } from './games/survival';
import { ShooterGame } from './games/shooter';
import { RunnerGame } from './games/runner';
import { CaveGame } from './games/cave';
import { SimonGame } from './games/simon';
import { SnakeGame } from './games/snake';
import { BreakerGame } from './games/breaker';
import { GolfGame } from './games/golf';
import { FishingGame } from './games/fish';
import { MusicTestApp } from './music-test';
import type { AppLike, GameConstructor } from './core/types';

declare global {
  interface Window {
    __engine?: Engine;
    __blobArcade?: {
      pickFiles(): void;
      pickFolder(): void;
      analyzeBuffer: typeof analyzeBuffer;
    };
  }
}

const GAMES: GameConstructor[] = [
  RhythmGame,
  SurvivalGame,
  ShooterGame,
  RunnerGame,
  CaveGame,
  SimonGame,
  SnakeGame,
  BreakerGame,
  GolfGame,
  FishingGame,
];

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Élément #${id} introuvable.`);
  return value as T;
}

const engine = new Engine(element<HTMLCanvasElement>('game'));
engine.input.setBlocked(true);
engine.menuFactory = () => new Menu(engine, GAMES) as AppLike;
const musicTestRoute = location.pathname === '/music-test' || new URLSearchParams(location.search).has('music-test');
engine.setApp(musicTestRoute ? new MusicTestApp(engine) : engine.menuFactory());
engine.start();

window.__engine = engine; // debug console

// ---------- modale d'intro : le clic/une touche débloque l'audio puis lance le menu ----------
const gate = element<HTMLDivElement>('gate');
const introTransition = element<HTMLDivElement>('intro-transition');
const padEl = element<HTMLParagraphElement>('gate-pad');
const padPoll = window.setInterval(() => {
  if (!gate.isConnected) {
    window.clearInterval(padPoll);
    return;
  }
  const pads = navigator.getGamepads
    ? Array.from(navigator.getGamepads()).filter((pad): pad is Gamepad => !!pad?.connected)
    : [];
  if (pads.length) {
    padEl.textContent = 'Manette : ✓ ' + pads[0].id.slice(0, 30);
    padEl.classList.add('ok');
  } else {
    padEl.textContent = 'Manette : aucune détectée — le clavier fonctionne aussi';
    padEl.classList.remove('ok');
  }
}, 300);

let launched = false;
const start = (): void => {
  if (launched || !gate.isConnected) return;
  launched = true;
  window.clearInterval(padPoll);
  engine.audio.unlock();
  engine.input.setBlocked(false);
  engine.input.absorb(); // la frappe qui ferme la modale ne doit rien déclencher dans le menu
  gate.classList.add('hidden');
  introTransition.classList.add('active');
  window.setTimeout(() => gate.remove(), 450);
  window.setTimeout(() => introTransition.remove(), 900);
};
gate.addEventListener('pointerdown', start);
window.addEventListener('keydown', start);

// ---------- chargement de la playlist audio (BLOB BEAT) ----------
const fileInput = element<HTMLInputElement>('file-audio');
const dirInput = element<HTMLInputElement>('file-audio-dir');
const deliver = (files: File[]): void => {
  const app = engine.app as (AppLike & { onFilesChosen?: (selected: File[]) => void }) | null;
  app?.onFilesChosen?.(files);
};
fileInput.addEventListener('change', () => {
  deliver(fileInput.files ? Array.from(fileInput.files) : []);
  fileInput.value = '';
});
dirInput.addEventListener('change', () => {
  deliver(dirInput.files ? Array.from(dirInput.files).sort((a, b) => a.name.localeCompare(b.name)) : []);
  dirInput.value = '';
});
window.__blobArcade = {
  pickFiles: () => fileInput.click(),
  pickFolder: () => dirInput.click(),
  analyzeBuffer,
};
