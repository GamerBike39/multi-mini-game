// Base de tous les mini-jeux : pause, retour menu, game over, records, slow-mo de mort.
// Chaque jeu définit `static meta = { id, name, accent, mood, desc, controls, hint, unit, ranks }`.

import { Fx } from './fx';
import { Blob } from './blob';
import * as UI from './ui';
import type { AudioLike, EngineLike, GameMeta, InputLike, SettingsLike } from './types';

interface BestResult {
  best: number;
  isNew: boolean;
}

export class BaseGame {
  static meta: GameMeta;

  readonly eng: EngineLike;
  readonly input: InputLike;
  readonly audio: AudioLike;
  readonly fx: Fx;
  readonly meta: GameMeta;
  readonly accent: string;
  readonly W = 1280;
  readonly H = 720;

  time = 0;
  score = 0;
  // RhythmGame possède des phases supplémentaires ; elles seront modélisées
  // plus finement lorsque ce jeu passera lui aussi en TypeScript.
  state = 'play';
  paused = false;
  overT = 0;
  win = false;
  hintT = 3.4;
  readonly hint: string;
  pauseSel = 0;
  pvU = false;
  pvD = false;
  readonly settings: SettingsLike;
  _statDone = false;
  cursor = 'default';
  bestKey?: string;
  bestResult?: BestResult;
  musicOpts?: Record<string, unknown>;
  onPauseChange?: (paused: boolean) => void;
  // Certains jeux (notamment Breaker) remplacent la balle principale.
  blob: InstanceType<typeof Blob>;

  constructor(engine: EngineLike) {
    this.eng = engine;
    this.input = engine.input;
    this.audio = engine.audio;
    this.fx = new Fx();
    this.meta = (this.constructor as typeof BaseGame).meta;
    this.accent = this.meta.accent;
    this.settings = engine.settings;
    this.hint = this.meta.hint;
    this.blob = new Blob({ r: 22, color: this.accent });
  }

  get isOver(): boolean {
    return this.state === 'over';
  }

  enter(): void {
    this.audio.startMusic(this.meta.mood, this.musicOpts || {});
  }

  // Les mini-jeux redéfinissent ces deux méthodes ; les versions vides
  // permettent au moteur de manipuler uniformément menu et jeux.
  update(_dt: number): void {}

  render(_ctx: CanvasRenderingContext2D): void {}

  exit(): void {
    this.audio.stopMusic();
    // Temps non comptabilisé par over() (partie abandonnée) : on le crédite quand même.
    if (!this._statDone && this.time > 0) UI.addTime(this.meta.id, this.time);
  }

  // Retourne true si l'update "jeu" doit être sauté (pause, over, réglages, transition).
  baseUpdate(dt: number): boolean {
    this.time += dt;
    if (this.hintT > 0) this.hintT -= dt;
    const I = this.input;

    if (this.settings.active) {
      this.settings.update(dt);
      return true;
    }

    // Start (Entrée/manette), Select ou Échap : bascule pause ↔ jeu.
    if (I.pressed('start') || I.pressed('back') || I.pressed('select')) {
      this.paused = !this.paused;
      this.pauseSel = 0;
      this.audio.uiMove();
      this.onPauseChange?.(this.paused);
      return true;
    }

    if (this.paused) {
      // Navigation pause : dpad/flèches/WASD + stick vertical, A valide,
      // B reprend ; Start, Select et Échap sont traités au-dessus.
      const U = I.down('up') || I.moveY < -0.5;
      const D = I.down('down') || I.moveY > 0.5;
      if (I.pressed('up') || (U && !this.pvU)) {
        this.pauseSel = (this.pauseSel + 3) % 4;
        this.audio.uiMove();
      }
      if (I.pressed('down') || (D && !this.pvD)) {
        this.pauseSel = (this.pauseSel + 1) % 4;
        this.audio.uiMove();
      }
      this.pvU = U;
      this.pvD = D;
      if (I.pressed('a')) {
        if (this.pauseSel === 0) {
          this.paused = false;
          this.onPauseChange?.(false);
          this.audio.uiOk();
        } else if (this.pauseSel === 1) {
          this.paused = false;
          this.audio.uiOk();
          this.restart();
        } else if (this.pauseSel === 2) {
          this.settings.open();
        } else {
          this.audio.uiBack();
          this.quit();
        }
        return true;
      }
      if (I.pressed('b') || I.pressed('back')) {
        this.paused = false;
        this.onPauseChange?.(false);
        this.audio.uiBack();
        return true;
      }
      return true;
    }

    if (this.state === 'over') {
      this.overT += dt;
      this.fx.timeScale = Math.min(1, this.fx.timeScale + dt * 1.1);
      if (this.overT > 0.7) {
        if (I.pressed('a')) this.restart();
        else if (I.pressed('b') || I.pressed('back')) {
          this.audio.uiBack();
          this.quit();
        }
      }
      return true;
    }
    return false;
  }

  over(win = false): void {
    if (this.state === 'over') return;
    this.state = 'over';
    this.win = win;
    this.overT = 0;
    this.fx.timeScale = 0.25;
    this.fx.shake(0.75);
    this.fx.stop(0.1);
    this.bestResult = UI.saveBest(this.bestKey || this.meta.id, Math.floor(this.score));
    // Statistiques : une partie "comptée" = une partie arrivée à son terme.
    this._statDone = true;
    UI.addStat(this.meta.id, { score: Math.floor(this.score), time: this.time, win });
    this.audio.explode(1.3);
    this.input.rumble(1, 0.35);
  }

  restart(): void {
    this.audio.uiOk();
    const Game = this.constructor as unknown as new (engine: EngineLike) => BaseGame;
    this.eng.setApp(new Game(this.eng));
  }

  quit(): void {
    this.eng.menuBack();
  }

  // ---------- souris : uniquement les interfaces (pause / fin / réglages) ----------
  hitPauseItem(x: number, y: number): number {
    for (let i = 0; i < 4; i++) {
      const iy = 330 + i * 58;
      if (x >= 490 && x <= 790 && y >= iy - 26 && y <= iy + 18) return i;
    }
    return -1;
  }

  onPointer(x: number, y: number): void {
    if (this.settings.active) {
      this.settings.onPointer(x, y);
      return;
    }
    if (this.paused) {
      const i = this.hitPauseItem(x, y);
      if (i < 0) return;
      this.pauseSel = i;
      if (i === 0) {
        this.paused = false;
        this.onPauseChange?.(false);
        this.audio.uiOk();
      } else if (i === 1) {
        this.paused = false;
        this.audio.uiOk();
        this.restart();
      } else if (i === 2) {
        this.audio.uiOk();
        this.settings.open();
      } else {
        this.audio.uiBack();
        this.quit();
      }
      return;
    }
    if (this.state === 'over' && this.overT > 0.7 && y >= 452 && y <= 494 && x >= 330 && x <= 950) {
      if (x < 640) this.restart();
      else {
        this.audio.uiBack();
        this.quit();
      }
    }
  }

  onPointerMove(x: number, y: number): void {
    this.cursor = 'default';
    if (this.settings.active) {
      if (this.settings.onPointer(x, y)) this.cursor = 'pointer';
      return;
    }
    if (this.paused) {
      if (this.hitPauseItem(x, y) >= 0) this.cursor = 'pointer';
    } else if (this.state === 'over' && this.overT > 0.7 && y >= 452 && y <= 494 && x >= 330 && x <= 950) {
      this.cursor = 'pointer';
    }
  }

  onPointerUp(): void {
    this.settings.onPointerUp();
  }

  onPointerLeave(): void {
    this.cursor = 'default';
  }

  // Rendu commun : hint, pause, game over (à appeler en dernier).
  drawCommon(ctx: CanvasRenderingContext2D): void {
    if (this.state === 'over') {
      UI.drawGameOver(ctx, {
        accent: this.accent,
        title: this.win ? 'BRAVO !' : 'GAME OVER',
        score: Math.floor(this.score),
        unit: this.meta.unit,
        best: this.bestResult?.best ?? UI.getBest(this.meta.id),
        isNew: this.bestResult?.isNew,
        rankLabel: UI.rank(this.meta.ranks, this.score),
      });
    } else if (this.paused) {
      UI.drawPause(ctx, this.accent, this.pauseSel);
    } else if (this.hintT > 0 && this.hint) {
      UI.drawHint(ctx, this.hint, this.hintT);
    }
  }

  // Aide : mouvement lissé type "approche de la cible" (ressenti d'accélération).
  steer(dt: number, obj: { vx: number; vy: number }, ix: number, iy: number, maxSp: number, snap = 8): void {
    const f = 1 - Math.exp(-snap * dt);
    obj.vx += (ix * maxSp - obj.vx) * f;
    obj.vy += (iy * maxSp - obj.vy) * f;
  }
}
