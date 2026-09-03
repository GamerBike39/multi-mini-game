import { Engine } from './core/engine';
import { Menu } from './menu';
import { IntroApp } from './core/stage';
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
import { PongGame } from './games/pong';
import { ColumnsGame } from './games/columns';
import { BubbleGame } from './games/bubble';
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
];

function element<T extends HTMLElement>(id: string): T {
  const value = document.getElementById(id);
  if (!value) throw new Error(`Élément #${id} introuvable.`);
  return value as T;
}

const engine = new Engine(element<HTMLCanvasElement>('game'));
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
