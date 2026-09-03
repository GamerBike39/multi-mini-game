import { Engine } from './core/engine';
import { Menu } from './menu';
import { IntroApp } from './core/stage';
import { analyzeBuffer } from './core/analyzer';
import { buildAchievementCatalog } from './core/achievements';
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
import { PongGame } from './games/pong';
import { ColumnsGame } from './games/columns';
import { BubbleGame } from './games/bubble';
import { SortGame } from './games/sort';
import { PathGame } from './games/path';
import { FrogGame } from './games/frog';
import { FlappyGame } from './games/flappy';
import { DigGame } from './games/dig';
import { CycleGame } from './games/cycle';
import { BloomGame } from './games/bloom';
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
  PongGame,
  ColumnsGame,
  BubbleGame,
  SortGame,
  PathGame,
  FrogGame,
  FlappyGame,
  DigGame,
  CycleGame,
  BloomGame,
];

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Élément #${id} introuvable.`);
  return value as T;
}

const engine = new Engine(element<HTMLCanvasElement>('game'));
engine.achievements.registerMany(buildAchievementCatalog(GAMES.map((game) => game.meta)));
// Vitrines "contrôle total" : évènements custom émis par les jeux eux-mêmes
// (voir SurvivalGame.finishWave et FlappyGame). Modèle à copier pour
// near-miss, combos, speedruns, secrets... dans n'importe quel jeu.
engine.achievements.registerMany([
  { id: 'surv.wave5', gameId: 'surv', name: 'SURVIBLOB — VAGUE 5', desc: 'Termine la vague 5', icon: '🌊', points: 15, event: 'surv:wave', when: (e) => (e.value ?? 0) >= 5 },
  { id: 'surv.wave10', gameId: 'surv', name: 'SURVIBLOB — VAGUE 10', desc: 'Termine la vague 10', icon: '🌪️', points: 25, event: 'surv:wave', when: (e) => (e.value ?? 0) >= 10 },
  { id: 'flap.ten', gameId: 'flap', name: 'FLAPPY BLOB — DIX ARCHES', desc: 'Passe 10 arches en une partie', icon: '🪶', points: 15, event: 'flap:ten' },
  { id: 'flap.perfect5', gameId: 'flap', name: 'FLAPPY BLOB — PLUME D’OR', desc: 'Enchaîne 5 passages PARFAITS', icon: '✨', points: 25, event: 'flap:perfect5' },
  { id: 'cycle.near-5', gameId: 'cycle', name: 'CYCLES — FRISSON ×5', desc: '5 near-miss en une partie', icon: '⚡', points: 15, event: 'cycle:near' },
  { id: 'cycle.near-12', gameId: 'cycle', name: 'CYCLES — DANSEUSE', desc: '12 near-miss en une partie', icon: '🌩️', points: 25, event: 'cycle:near' },
]);
engine.menuFactory = () => new Menu(engine, GAMES) as AppLike;
const musicTestRoute = location.pathname === '/music-test' || new URLSearchParams(location.search).has('music-test');
engine.setApp(musicTestRoute ? new MusicTestApp(engine) : new IntroApp(engine), false);
engine.start();

window.__engine = engine; // debug console

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
