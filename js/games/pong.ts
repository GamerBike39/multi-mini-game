import { BaseGame } from '../core/game';
import { Blob } from '../core/blob';
import { PhysicsWorld, type PhysicsBody } from '../core/physics';
import * as UI from '../core/ui';
import type { EngineLike, GameMeta, PlayerInputLike } from '../core/types';

const COURT = { left: 84, right: 1196, top: 112, bottom: 608 } as const;
const PADDLE_W = 30;
const PADDLE_H = 142;
const PADDLE_SPEED = 430;
const WIN_SCORE = 7;

export class PongGame extends BaseGame {
  static meta: GameMeta = {
    id: 'pong',
    name: 'BLOB PONG',
    accent: '#7dd3fc',
    mood: 'pong',
    desc: 'Deux blobs, une balle, zéro excuse.',
    controls: 'Stick / D-pad vertical · A lancer',
    keys: 'ZQSD / flèches · Espace',
    hint: 'Joueur 1 à gauche · Joueur 2 à droite · START pour lancer',
    unit: 'points',
    ranks: [1200, 900, 650, 350, 0],
    players: { min: 1, max: 2 },
  };

  readonly physics = new PhysicsWorld(64);
  readonly paddleBodies: [PhysicsBody, PhysicsBody];
  readonly paddleBlobs: [Blob, Blob];
  readonly ballBody: PhysicsBody;
  readonly ballBlob: Blob;
  readonly playerScores = [0, 0];
  serveT = 0.8;
  hitT = 0;
  winner = -1;
  private readonly unsubscribeCollision: () => void;

  constructor(engine: EngineLike) {
    super(engine);
    this.paddleBodies = [
      this.physics.createBody({
        x: COURT.left,
        y: 360,
        shape: { kind: 'aabb', width: PADDLE_W, height: PADDLE_H },
        static: true,
        restitution: 1,
      }),
      this.physics.createBody({
        x: COURT.right,
        y: 360,
        shape: { kind: 'aabb', width: PADDLE_W, height: PADDLE_H },
        static: true,
        restitution: 1,
      }),
    ];
    this.physics.createBody({
      x: 640,
      y: COURT.top,
      shape: { kind: 'aabb', width: COURT.right - COURT.left, height: 18 },
      static: true,
      restitution: 1,
    });
    this.physics.createBody({
      x: 640,
      y: COURT.bottom,
      shape: { kind: 'aabb', width: COURT.right - COURT.left, height: 18 },
      static: true,
      restitution: 1,
    });
    this.ballBody = this.physics.createBody({
      x: 640,
      y: 360,
      shape: { kind: 'circle', radius: 14 },
      restitution: 1,
      damping: 1,
      layer: 2,
      mask: 0xffffffff,
    });

    this.paddleBlobs = [
      new Blob({ x: COURT.left, y: 360, r: 48, color: '#7dd3fc', trailOn: true }),
      new Blob({ x: COURT.right, y: 360, r: 48, color: '#f472b6', trailOn: true }),
    ];
    this.ballBlob = new Blob({ x: 640, y: 360, r: 14, color: '#fef08a', trailOn: true });
    this.blob = this.paddleBlobs[0];
    this.unsubscribeCollision = this.physics.onCollision((event) => this.onCollision(event.a, event.b));
    this.serve(1);
  }

  exit(): void {
    this.unsubscribeCollision();
    super.exit();
  }

  update(dt: number): void {
    if (this.baseUpdate(dt)) return;
    this.hitT = Math.max(0, this.hitT - dt);
    this.serveT = Math.max(0, this.serveT - dt);

    this.updatePaddle(0, this.players[0], dt);
    this.updatePaddle(1, this.players[1], dt);
    if (this.session.playerCount < 2) this.updateAi(dt);

    if (this.serveT <= 0) this.physics.step(dt);
    this.syncViews(dt);

    if (this.ballBody.x < COURT.left - 70) this.point(1);
    else if (this.ballBody.x > COURT.right + 70) this.point(0);

    this.score = Math.max(this.playerScores[0], this.playerScores[1]) * 100
      + Math.min(this.playerScores[0], this.playerScores[1]) * 10;
    this.eng.dev.count('physics-bodies', this.physics.bodies.length);
    this.eng.dev.count('pong-hits', this.playerScores[0] + this.playerScores[1]);
  }

  private updatePaddle(index: 0 | 1, input: PlayerInputLike | undefined, dt: number): void {
    const body = this.paddleBodies[index];
    const axis = input ? input.moveY : 0;
    body.vx = 0;
    body.vy = Math.max(-1, Math.min(1, axis)) * PADDLE_SPEED;
    body.y += body.vy * dt;
    body.y = Math.max(COURT.top + PADDLE_H / 2, Math.min(COURT.bottom - PADDLE_H / 2, body.y));
  }

  private updateAi(dt: number): void {
    const target = this.ballBody.y + this.ballBody.vy * 0.12;
    const delta = target - this.paddleBodies[1].y;
    const axis = Math.max(-1, Math.min(1, delta / 100));
    this.paddleBodies[1].vy = axis * PADDLE_SPEED * 0.78;
    this.paddleBodies[1].y += this.paddleBodies[1].vy * dt;
    this.paddleBodies[1].y = Math.max(COURT.top + PADDLE_H / 2, Math.min(COURT.bottom - PADDLE_H / 2, this.paddleBodies[1].y));
  }

  private onCollision(a: PhysicsBody, b: PhysicsBody): void {
    if (a !== this.ballBody && b !== this.ballBody) return;
    const other = a === this.ballBody ? b : a;
    const paddleIndex = this.paddleBodies.indexOf(other);
    if (paddleIndex < 0) return;
    const paddle = this.paddleBodies[paddleIndex];
    const offset = Math.max(-1, Math.min(1, (this.ballBody.y - paddle.y) / (PADDLE_H * 0.5)));
    const direction = this.ballBody.vx >= 0 ? 1 : -1;
    this.ballBody.vx = direction * Math.min(720, Math.max(310, Math.abs(this.ballBody.vx) * 1.035));
    this.ballBody.vy += offset * 165;
    if (this.hitT <= 0) {
      this.hitT = 0.045;
      this.fx.shake(0.035);
      this.fx.ring(this.ballBody.x, this.ballBody.y, { r0: 10, r1: 46, color: paddleIndex === 0 ? '#7dd3fc' : '#f472b6', life: 0.22, width: 3 });
      this.audio.hitEnemy();
      this.input.player(paddleIndex).rumble(0.12, 0.04);
    }
  }

  private serve(direction: number): void {
    this.ballBody.x = 640;
    this.ballBody.y = 360;
    this.ballBody.vx = direction * 340;
    this.ballBody.vy = this.rng.float(-170, 170);
    this.serveT = 0.72;
    this.ballBlob.punch(0.2);
  }

  private point(playerIndex: 0 | 1): void {
    if (this.state === 'over') return;
    this.playerScores[playerIndex]++;
    this.fx.flash(playerIndex === 0 ? '#7dd3fc' : '#f472b6', 0.14);
    this.fx.burst(640, 360, {
      n: 18,
      speed: [80, 260],
      colors: [playerIndex === 0 ? '#7dd3fc' : '#f472b6', '#fef08a', '#ffffff'],
      size: [2, 5],
      life: 0.5,
    });
    this.audio.coin(this.playerScores[playerIndex]);
    this.input.player(playerIndex).rumble(0.28, 0.09);
    if (this.playerScores[playerIndex] >= WIN_SCORE) {
      this.winner = playerIndex;
      this.score = this.playerScores[playerIndex] * 100;
      this.over(playerIndex === 0);
      return;
    }
    this.serve(playerIndex === 0 ? -1 : 1);
  }

  private syncViews(dt: number): void {
    for (let i = 0; i < 2; i++) {
      const body = this.paddleBodies[i];
      const blob = this.paddleBlobs[i];
      blob.x = body.x;
      blob.y = body.y;
      blob.vx = body.vx;
      blob.vy = body.vy;
      blob.scared = this.winner >= 0 && this.winner !== i;
      blob.update(dt);
    }
    this.ballBlob.x = this.ballBody.x;
    this.ballBlob.y = this.ballBody.y;
    this.ballBlob.vx = this.ballBody.vx;
    this.ballBlob.vy = this.ballBody.vy;
    this.ballBlob.update(dt);
  }

  render(ctx: CanvasRenderingContext2D): void {
    const bg = ctx.createRadialGradient(640, 360, 80, 640, 360, 720);
    bg.addColorStop(0, '#10182b');
    bg.addColorStop(1, '#05060b');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1280, 720);
    this.fx.world(ctx);

    ctx.strokeStyle = '#7dd3fc22';
    ctx.lineWidth = 2;
    ctx.strokeRect(COURT.left, COURT.top, COURT.right - COURT.left, COURT.bottom - COURT.top);
    ctx.setLineDash([12, 18]);
    ctx.strokeStyle = '#eaf6ff30';
    ctx.beginPath();
    ctx.moveTo(640, COURT.top + 12);
    ctx.lineTo(640, COURT.bottom - 12);
    ctx.stroke();
    ctx.setLineDash([]);

    this.paddleBlobs[0].render(ctx);
    this.paddleBlobs[1].render(ctx);
    this.ballBlob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    UI.txt(ctx, String(this.playerScores[0]), 470, 104, { size: 58, align: 'center', mono: true, color: '#7dd3fc', weight: 900, shadow: true });
    UI.txt(ctx, String(this.playerScores[1]), 810, 104, { size: 58, align: 'center', mono: true, color: '#f472b6', weight: 900, shadow: true });
    UI.txt(ctx, 'P1', 470, 72, { size: 12, align: 'center', mono: true, color: '#7dd3fc' });
    UI.txt(ctx, this.session.playerCount > 1 ? 'P2' : 'CPU', 810, 72, { size: 12, align: 'center', mono: true, color: '#f472b6' });
    if (this.serveT > 0 && this.state === 'play') {
      UI.txt(ctx, 'PRÊT', 640, 382, { size: 15, align: 'center', mono: true, color: '#fef08a', weight: 900 });
    }
    if (this.winner >= 0 && this.state === 'over') {
      UI.txt(ctx, this.winner === 0 ? 'JOUEUR 1 GAGNE' : this.session.playerCount > 1 ? 'JOUEUR 2 GAGNE' : 'LE CPU GAGNE', 640, 430, {
        size: 22,
        align: 'center',
        color: this.winner === 0 ? '#7dd3fc' : '#f472b6',
        weight: 900,
      });
    }
    this.drawCommon(ctx);
  }

  debugRender(ctx: CanvasRenderingContext2D): void {
    this.physics.setDebug(this.eng.dev.flags.hitboxes, this.eng.dev.flags.spatialHash);
    this.physics.debugRender(ctx);
  }

  debugSnapshot(): Record<string, string | number | boolean | null> {
    return {
      game: this.meta.id,
      state: this.state,
      p1: this.playerScores[0],
      p2: this.playerScores[1],
      ballX: Number(this.ballBody.x.toFixed(1)),
      ballY: Number(this.ballBody.y.toFixed(1)),
      bodies: this.physics.bodies.length,
      seed: this.session.seed,
    };
  }
}
