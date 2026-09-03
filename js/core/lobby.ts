import { Blob } from './blob';
import { Fx } from './fx';
import * as UI from './ui';
import type { AppLike, GameConstructor, InputHubLike, EngineLike, StartGameOptions } from './types';

const W = 1280;
const H = 720;

/** Petit sas local partagé par les jeux qui déclarent plusieurs joueurs. */
export class LocalLobbyApp implements AppLike {
  readonly eng: EngineLike;
  readonly input: InputHubLike;
  readonly game: GameConstructor;
  readonly options: StartGameOptions;
  readonly fx = new Fx();
  readonly blobs = [
    new Blob({ x: 430, y: 330, r: 48, color: '#7dd3fc', trailOn: true }),
    new Blob({ x: 850, y: 330, r: 48, color: '#f472b6', trailOn: true }),
    new Blob({ x: 430, y: 330, r: 48, color: '#a3e635', trailOn: true }),
    new Blob({ x: 850, y: 330, r: 48, color: '#fbbf24', trailOn: true }),
  ];
  readonly maxPlayers: number;
  readonly joined: boolean[];
  accent: string;
  cursor = 'default';
  isLobby = true;
  t = 0;

  constructor(engine: EngineLike, game: GameConstructor, options: StartGameOptions = {}) {
    this.eng = engine;
    this.input = engine.input;
    this.game = game;
    this.options = options;
    this.maxPlayers = Math.max(1, Math.min(4, game.meta.players?.max || 2));
    this.joined = Array.from({ length: this.maxPlayers }, () => false);
    this.accent = game.meta.accent;
  }

  enter(): void {
    this.input.configureLobby(this.maxPlayers);
    this.input.absorb();
    // Une manette déjà affectée en solo conserve le joueur 1 dans le sas.
    this.joined[0] = this.input.player(0).gamepadIndex !== null;
  }

  exit(): void {}

  update(dt: number): void {
    this.t += dt;
    this.claimKeyboardPlayer();
    this.claimPendingPads();
    this.releaseDisconnectedPlayers();

    const primary = this.input.player(0);
    const anyBack = this.input.players.some((player) => player.pressed('back') || player.pressed('b') || player.pressed('select'));
    if (anyBack) {
      this.eng.menuBack();
      return;
    }
    const anyStart = this.input.players.some((player) => player.pressed('start'));
    if (this.joined[0] && anyStart) {
      this.launch();
      return;
    }

    for (let i = 0; i < this.blobs.length; i++) {
      const blob = this.blobs[i];
      blob.vx = Math.sin(this.t * 1.3 + i * Math.PI) * 22;
      blob.vy = Math.cos(this.t * 1.1 + i * 0.7) * 14;
      blob.x += blob.vx * dt;
      blob.y += blob.vy * dt;
      blob.x = Math.max(210, Math.min(W - 210, blob.x));
      blob.update(dt);
    }
  }

  private claimKeyboardPlayer(): void {
    if (this.joined[0]) return;
    const primary = this.input.player(0);
    if (primary.pressed('a') || primary.pressed('start')) this.joined[0] = true;
  }

  private releaseDisconnectedPlayers(): void {
    for (let i = 0; i < this.maxPlayers; i++) {
      // Le joueur 1 peut rester attaché au clavier après avoir perdu sa
      // manette. Les slots supplémentaires sont exclusivement manette en v1.
      if (i > 0 && this.joined[i] && this.input.player(i).source === 'none') this.joined[i] = false;
    }
  }

  private claimPendingPads(): void {
    // claimGamepad retire la demande de la liste : toujours consommer la tête
    // évite de sauter une deuxième manette lorsque deux A arrivent ensemble.
    while (this.input.joinRequests.length > 0) {
      const request = this.input.joinRequests[0];
      let playerId = -1;
      for (let i = 0; i < this.maxPlayers; i++) {
        if (!this.joined[i]) {
          playerId = i;
          break;
        }
      }
      if (playerId < 0) break;
      if (this.input.claimGamepad(request.gamepadIndex, playerId)) this.joined[playerId] = true;
      else break;
    }
  }

  private launch(): void {
    const playerCount = this.joined.filter(Boolean).length;
    this.input.absorb();
    this.eng.startGame(this.game, {
      ...this.options,
      mode: playerCount > 1 ? 'local' : 'solo',
      playerCount: Math.max(1, playerCount),
      skipLobby: true,
    });
  }

  onPointer(x: number, y: number): void {
    if (x >= 450 && x <= 830 && y >= 530 && y <= 590 && this.joined[0]) this.launch();
    else if (x >= 450 && x <= 830 && y >= 600 && y <= 650) this.eng.menuBack();
  }

  onPointerMove(x: number, y: number): void {
    this.cursor = (x >= 450 && x <= 830 && y >= 530 && y <= 650) ? 'pointer' : 'default';
  }

  onPointerUp(): void {}
  onPointerLeave(): void { this.cursor = 'default'; }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#070910';
    ctx.fillRect(0, 0, W, H);
    UI.grid(ctx, { gap: 72, off: this.t * 8, alpha: 0.05, color: this.accent });

    UI.txt(ctx, this.game.meta.name, 640, 126, {
      size: 42,
      align: 'center',
      color: '#eaf6ff',
      weight: 900,
      shadow: true,
    });
    UI.txt(ctx, 'JOUEURS LOCAUX', 640, 158, {
      size: 14,
      align: 'center',
      color: this.accent,
      mono: true,
    });

    const lobbyColors = ['#7dd3fc', '#f472b6', '#a3e635', '#fbbf24'];
    const slotPos = (i: number, n: number): { x: number; y: number; r: number } => {
      if (n <= 2) return { x: i === 0 ? 430 : 850, y: 315, r: 74 };
      if (n === 3) return { x: 320 + i * 320, y: 300, r: 62 };
      return { x: i % 2 === 0 ? 430 : 850, y: i < 2 ? 235 : 390, r: 54 };
    };
    for (let i = 0; i < this.maxPlayers; i++) {
      const pos = slotPos(i, this.maxPlayers);
      const color = lobbyColors[i % lobbyColors.length];
      const player = this.input.player(i);
      const ready = this.joined[i];
      ctx.save();
      ctx.globalAlpha = ready ? 1 : 0.42;
      ctx.shadowColor = color;
      ctx.shadowBlur = ready ? 28 : 10;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, pos.r + Math.sin(this.t * 2.2 + i) * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.restore();
      this.blobs[i].x = pos.x;
      this.blobs[i].y = pos.y;
      this.blobs[i].color = color;
      this.blobs[i].render(ctx);

      const labelY = pos.y + pos.r + 24;
      UI.txt(ctx, 'JOUEUR ' + (i + 1), pos.x, labelY, { size: 18, align: 'center', color: '#eaf6ff', weight: 900 });
      UI.txt(ctx, ready ? 'PRÊT · ' + player.source.toUpperCase() : 'APPUIE SUR A POUR REJOINDRE', pos.x, labelY + 28, {
        size: 12,
        align: 'center',
        color: ready ? '#34d399' : '#8b95a8',
        mono: true,
      });
    }

    const count = this.joined.filter(Boolean).length;
    const canStart = this.joined[0] && count >= (this.game.meta.players?.min || 1);
    UI.panel(ctx, 450, 530, 380, 60, {
      radius: 30,
      fill: canStart ? this.accent : '#334155',
      stroke: canStart ? '#ffffff55' : '#64748b55',
    });
    UI.txt(ctx, canStart ? 'START  ·  LANCER' : 'JOUEUR 1 REQUIS', 640, 568, {
      size: 17,
      align: 'center',
      color: canStart ? '#06121c' : '#cbd5e1',
      weight: 900,
    });
    UI.txt(ctx, 'B / ÉCHAP  ·  retour au menu', 640, 636, { size: 13, align: 'center', color: '#64748b', mono: true });
  }
}
