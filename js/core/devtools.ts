import { panel, txt } from './ui';
import type { DevToolsLike, FrameMetrics, GameSession, PlayerInputLike, DebugValue } from './types';

export interface DevOverlayInfo {
  metrics: FrameMetrics;
  session: GameSession | null;
  appName: string;
  players: readonly PlayerInputLike[];
  gpuStatus: string;
  snapshot?: Record<string, DebugValue>;
}

type CommandHandler = (name: string) => void;

const MAX_LOGS = 18;

function requested(): boolean {
  try {
    return new URLSearchParams(location.search).get('dev') === '1';
  } catch {
    return false;
  }
}

export class DevTools implements DevToolsLike {
  enabled = requested();
  overlay = this.enabled;
  readonly flags = {
    hitboxes: false,
    bounds: false,
    spatialHash: false,
    noFx: false,
    noAudio: false,
  };
  readonly counters = new Map<string, number>();
  readonly states = new Map<string, DebugValue>();
  readonly logs: string[] = [];
  readonly marks = new Map<string, number>();
  private commandHandler: CommandHandler = () => {};

  setCommandHandler(handler: CommandHandler): void {
    this.commandHandler = handler;
  }

  beginFrame(): void {
    if (!this.enabled) return;
    this.counters.clear();
    this.states.clear();
    this.marks.clear();
  }

  count(name: string, value: number): void {
    if (!this.enabled) return;
    this.counters.set(name, Number.isFinite(value) ? value : 0);
  }

  state(name: string, value: DebugValue): void {
    if (!this.enabled) return;
    this.states.set(name, value);
  }

  log(message: string): void {
    if (!this.enabled) return;
    this.logs.push(String(message));
    if (this.logs.length > MAX_LOGS) this.logs.shift();
  }

  mark(name: string): void {
    if (!this.enabled) return;
    this.marks.set(name, performance.now());
  }

  assertFinite(name: string, value: number): void {
    if (!this.enabled || Number.isFinite(value)) return;
    const message = `Valeur non finie : ${name}`;
    this.log(message);
    throw new Error(message);
  }

  command(name: string): void {
    if (!this.enabled) return;
    this.commandHandler(name);
  }

  activate(): void {
    this.enabled = true;
    this.overlay = true;
  }

  toggleOverlay(): void {
    if (!this.enabled) {
      this.activate();
      return;
    }
    this.overlay = !this.overlay;
  }

  toggleFlag(name: keyof DevToolsLike['flags']): void {
    if (!this.enabled) return;
    this.flags[name] = !this.flags[name];
  }

  render(ctx: CanvasRenderingContext2D, info: DevOverlayInfo): void {
    if (!this.enabled || !this.overlay) return;

    const m = info.metrics;
    const rows: string[] = [
      `APP   ${info.appName || '—'}`,
      `FPS   ${m.fps.toFixed(1)}   FRAME ${m.frameMs.toFixed(2)} ms`,
      `UPDATE ${m.updateMs.toFixed(2)}   RENDER ${m.renderMs.toFixed(2)} ms`,
      `PRESENT ${m.presentMs.toFixed(2)} ms   STEPS ${m.simulationSteps}`,
      `DROP  ${m.droppedSteps}   ACC ${m.accumulator.toFixed(4)}`,
      `PIXELS ${m.renderPixels.toLocaleString('fr-FR')}   GPU ${info.gpuStatus}`,
      `SESSION ${info.session?.mode || '—'} / P${info.session?.playerCount || 0}`,
      `SEED ${info.session?.seed ?? '—'}`,
    ];

    for (let i = 0; i < info.players.length; i++) {
      const player = info.players[i];
      rows.push(`P${i + 1} ${player.source.toUpperCase()} ${player.gamepadIndex ?? '—'} ${player.gamepadName || ''}`.trim());
    }
    for (const [name, value] of this.counters) rows.push(`${name.toUpperCase()} ${value}`);
    for (const [name, value] of this.states) rows.push(`${name.toUpperCase()} ${String(value)}`);
    if (info.snapshot) {
      for (const [name, value] of Object.entries(info.snapshot)) rows.push(`${name.toUpperCase()} ${String(value)}`);
    }

    const visibleRows = rows.slice(0, 24);
    const h = 54 + visibleRows.length * 17 + (this.logs.length ? 30 : 0);
    ctx.save();
    panel(ctx, 16, 16, 440, h, {
      radius: 10,
      fill: 'rgba(3, 7, 14, 0.9)',
      stroke: 'rgba(125, 211, 252, 0.65)',
      lineWidth: 1.5,
    });
    txt(ctx, 'DEVTOOLS  F3 overlay · F4 hitboxes · F5 record · F8 step', 30, 40, {
      size: 11.5,
      mono: true,
      color: '#7dd3fc',
      weight: 800,
    });
    ctx.font = '700 12px Consolas, monospace';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#cbd5e1';
    for (let i = 0; i < visibleRows.length; i++) ctx.fillText(visibleRows[i], 30, 62 + i * 17);
    if (this.logs.length) {
      ctx.fillStyle = '#fb7185';
      ctx.fillText('LOG  ' + this.logs[this.logs.length - 1], 30, 80 + visibleRows.length * 17);
    }
    ctx.restore();
  }
}
