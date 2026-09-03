// Entrée unifiée : clavier + plusieurs manettes Gamepad API.
// Le joueur 1 reste exposé directement pour préserver les mini-jeux existants.

import { ACTIONS, type Action, type ActionMap, type InputTap, type InputHubLike, type PlayerInputLike, type PlayerSource, type ReplayPlayerFrame } from './types';
import type { ReplayPlayer } from './replay';
import type { ReplayRecorder } from './replay';

const MAX_PLAYERS = 4;
const ALL_ACTIONS_MASK = (1 << ACTIONS.length) - 1;

const PAD_BINDINGS: readonly { index: number; action: Action }[] = [
  { index: 0, action: 'a' },
  { index: 1, action: 'b' },
  { index: 2, action: 'x' },
  { index: 3, action: 'y' },
  { index: 4, action: 'lb' },
  { index: 5, action: 'rb' },
  { index: 6, action: 'lb' },
  { index: 7, action: 'rb' },
  { index: 8, action: 'select' },
  { index: 9, action: 'start' },
  { index: 12, action: 'up' },
  { index: 13, action: 'down' },
  { index: 14, action: 'left' },
  { index: 15, action: 'right' },
];

// Mapping physique (e.code) => identique sur AZERTY (WASD = ZQSD automatiquement).
const KEY_MAP: Record<string, Action> = {
  Space: 'a',
  KeyJ: 'a',
  KeyK: 'b',
  ShiftLeft: 'b',
  KeyL: 'x',
  KeyU: 'y',
  Enter: 'start',
  Escape: 'back',
  Backspace: 'select',
  ArrowUp: 'up',
  KeyW: 'up',
  ArrowDown: 'down',
  KeyS: 'down',
  ArrowLeft: 'left',
  KeyA: 'left',
  ArrowRight: 'right',
  KeyD: 'right',
};
const KEY_CODES = Object.keys(KEY_MAP);
const PREVENT = new Set(KEY_CODES);

function actionBit(action: Action): number {
  return 1 << ACTIONS.indexOf(action);
}

function makeActionMap(): ActionMap {
  return Object.fromEntries(
    ACTIONS.map((action) => [action, { down: false, pressed: false, released: false }]),
  ) as ActionMap;
}

export function radial(x: number, y: number): [number, number] {
  const result: [number, number] = [0, 0];
  radialInto(x, y, result);
  return result;
}

function radialInto(x: number, y: number, result: [number, number]): void {
  const l = Math.hypot(x, y);
  const dz = 0.22;
  if (l < dz) {
    result[0] = 0;
    result[1] = 0;
    return;
  }
  const s = Math.min(1, (l - dz) / (1 - dz));
  result[0] = x / l * s;
  result[1] = y / l * s;
}

interface RawState {
  downMask: number;
  moveX: number;
  moveY: number;
  aimX: number;
  aimY: number;
}

interface PadRecord {
  index: number;
  pad: Gamepad;
  downMask: number;
  previousDownMask: number;
}

interface JoinRequest {
  gamepadIndex: number;
  t: number;
}

function emptyRaw(): RawState {
  return { downMask: 0, moveX: 0, moveY: 0, aimX: 0, aimY: 0 };
}

class PlayerInput implements PlayerInputLike {
  readonly actions = makeActionMap();
  readonly taps: InputTap[] = [];
  moveX = 0;
  moveY = 0;
  aimX = 0;
  aimY = 0;
  raw: RawState = emptyRaw();
  downMask = 0;
  pendingPressedMask = 0;
  pendingReleasedMask = 0;
  private readonly pendingTapTimes = new Array<number>(ACTIONS.length).fill(0);
  sourceValue: PlayerSource = 'none';
  pad: Gamepad | null = null;

  constructor(readonly owner: Input, readonly playerId: number) {}

  get source(): PlayerSource {
    return this.sourceValue;
  }

  get gamepadIndex(): number | null {
    return this.pad?.index ?? null;
  }

  get gamepadName(): string {
    return this.pad?.id.slice(0, 34) || '';
  }

  get padConnected(): boolean {
    return !!this.pad?.connected;
  }

  get vibration(): boolean {
    return this.owner.vibration;
  }

  set vibration(value: boolean) {
    this.owner.vibration = value;
  }

  setRaw(raw: RawState, pad: Gamepad | null, source: PlayerSource): void {
    this.raw.downMask = raw.downMask;
    this.raw.moveX = raw.moveX;
    this.raw.moveY = raw.moveY;
    this.raw.aimX = raw.aimX;
    this.raw.aimY = raw.aimY;
    this.pad = pad;
    this.sourceValue = source;
  }

  applyReplay(frame: ReplayPlayerFrame, tapTime: number): void {
    this.raw.downMask = frame.downMask >>> 0;
    this.raw.moveX = frame.moveX;
    this.raw.moveY = frame.moveY;
    this.raw.aimX = frame.aimX;
    this.raw.aimY = frame.aimY;
    this.pendingPressedMask = frame.pressedMask >>> 0;
    this.pendingReleasedMask = frame.releasedMask >>> 0;
    this.pad = null;
    this.sourceValue = this.playerId === 0 ? 'keyboard' : 'none';
    this.advance(tapTime);
  }

  advance(tapTime: number): void {
    const downMask = this.raw.downMask >>> 0;
    const pressedMask = ((downMask & ~this.downMask) | this.pendingPressedMask) & ALL_ACTIONS_MASK;
    const releasedMask = (((~downMask) & this.downMask) | this.pendingReleasedMask) & ALL_ACTIONS_MASK;
    this.downMask = downMask;
    this.pendingPressedMask = 0;
    this.pendingReleasedMask = 0;

    for (let i = 0; i < ACTIONS.length; i++) {
      const action = ACTIONS[i];
      const state = this.actions[action];
      const bit = 1 << i;
      state.down = (downMask & bit) !== 0;
      if ((pressedMask & bit) !== 0) {
        state.pressed = true;
        const eventTime = this.pendingTapTimes[i] > 0 ? this.pendingTapTimes[i] : tapTime;
        this.pendingTapTimes[i] = 0;
        this.pushTap({ t: eventTime, a: action });
      }
      if ((releasedMask & bit) !== 0) state.released = true;
    }

    this.moveX = this.raw.moveX;
    this.moveY = this.raw.moveY;
    this.aimX = this.raw.aimX;
    this.aimY = this.raw.aimY;
  }

  pushTap(tap: InputTap): void {
    this.taps.push(tap);
    if (this.taps.length > 48) this.taps.shift();
  }

  queuePress(action: Action, eventTime = 0): void {
    const index = ACTIONS.indexOf(action);
    if (index < 0) return;
    this.pendingPressedMask |= 1 << index;
    if (eventTime > 0 && (this.pendingTapTimes[index] <= 0 || eventTime < this.pendingTapTimes[index])) {
      this.pendingTapTimes[index] = eventTime;
    }
  }

  clearEdges(): void {
    for (const action of ACTIONS) {
      this.actions[action].pressed = false;
      this.actions[action].released = false;
    }
  }

  absorb(): void {
    this.clearEdges();
    this.downMask = this.raw.downMask;
    this.pendingPressedMask = 0;
    this.pendingReleasedMask = 0;
    this.pendingTapTimes.fill(0);
    this.taps.length = 0;
  }

  clear(): void {
    this.raw.downMask = 0;
    this.raw.moveX = 0;
    this.raw.moveY = 0;
    this.raw.aimX = 0;
    this.raw.aimY = 0;
    this.downMask = 0;
    this.pendingPressedMask = 0;
    this.pendingReleasedMask = 0;
    this.pendingTapTimes.fill(0);
    this.moveX = 0;
    this.moveY = 0;
    this.aimX = 0;
    this.aimY = 0;
    this.pad = null;
    this.sourceValue = 'none';
    this.clearEdges();
    this.taps.length = 0;
  }

  down(action: Action): boolean { return this.actions[action].down; }
  pressed(action: Action): boolean { return this.actions[action].pressed; }
  released(action: Action): boolean { return this.actions[action].released; }
  key(code: string): boolean { return this.playerId === 0 && this.owner.keys.has(code); }
  keyPressed(code: string): boolean { return this.playerId === 0 && this.owner.keyEdges.has(code); }

  gesture(): void { this.owner.gesture(); }
  setBlocked(blocked: boolean): void { this.owner.setBlocked(blocked); }
  clearPlayerEdges(): void { this.clearEdges(); }

  rumble(strength = 0.5, duration = 0.15): void {
    if (!this.owner.vibration) return;
    const actuator = this.pad?.vibrationActuator;
    if (!actuator) return;
    try {
      actuator.playEffect('dual-rumble', {
        duration: Math.round(duration * 1000),
        strongMagnitude: Math.max(0, Math.min(1, strength)),
        weakMagnitude: Math.max(0, Math.min(1, strength * 0.7)),
      });
    } catch {
      // Certains navigateurs exposent l'actuator sans supporter dual-rumble.
    }
  }
}

export class Input implements InputHubLike {
  readonly onGesture: () => void;
  readonly players: PlayerInput[];
  readonly keys = new Set<string>();
  readonly keyEdges = new Set<string>();
  readonly pads = new Map<number, PadRecord>();
  readonly joinRequests: JoinRequest[] = [];
  readonly rawStates: RawState[];
  readonly padBindings: (number | null)[];
  readonly replayScratch: ReplayPlayerFrame[];
  blocked = false;
  gestureDone = false;
  vibration = true;
  lobbyActive = false;
  maxPlayers = 1;
  private replayRecorder: ReplayRecorder | null = null;
  private replayPlayer: ReplayPlayer | null = null;

  constructor(onGesture: () => void = () => {}) {
    this.onGesture = onGesture;
    this.players = [];
    this.rawStates = [];
    this.padBindings = [];
    this.replayScratch = [];
    for (let i = 0; i < MAX_PLAYERS; i++) {
      this.players.push(new PlayerInput(this, i));
      this.rawStates.push(emptyRaw());
      this.padBindings.push(null);
      this.replayScratch.push({ downMask: 0, pressedMask: 0, releasedMask: 0, moveX: 0, moveY: 0, aimX: 0, aimY: 0 });
    }

    try {
      this.vibration = localStorage.getItem('blobArcade.vib') !== '0';
    } catch {
      // Défaut : actif.
    }

    addEventListener('keydown', (event: KeyboardEvent) => {
      if (PREVENT.has(event.code)) event.preventDefault();
      if (event.repeat) return;
      this.keys.add(event.code);
      this.keyEdges.add(event.code);
      const action = KEY_MAP[event.code];
      if (action) this.players[0].queuePress(action, event.timeStamp || performance.now());
      this.gesture();
    });

    addEventListener('keyup', (event: KeyboardEvent) => {
      this.keys.delete(event.code);
      const action = KEY_MAP[event.code];
      if (action) this.players[0].pendingReleasedMask |= actionBit(action);
    });

    addEventListener('blur', () => {
      this.keys.clear();
      this.keyEdges.clear();
      this.players[0].pendingReleasedMask |= this.players[0].downMask;
    });
    addEventListener('gamepadconnected', () => this.gesture());
    addEventListener('gamepaddisconnected', (event: Event) => {
      const pad = (event as Event & { gamepad?: Gamepad }).gamepad;
      if (pad) this.unbindGamepad(pad.index);
    });
  }

  get moveX(): number { return this.players[0].moveX; }
  set moveX(value: number) { this.players[0].moveX = value; }
  get moveY(): number { return this.players[0].moveY; }
  set moveY(value: number) { this.players[0].moveY = value; }
  get aimX(): number { return this.players[0].aimX; }
  set aimX(value: number) { this.players[0].aimX = value; }
  get aimY(): number { return this.players[0].aimY; }
  set aimY(value: number) { this.players[0].aimY = value; }
  get pad(): Gamepad | null { return this.players[0].pad; }
  get padConnected(): boolean { return this.players[0].padConnected; }
  get padName(): string { return this.players[0].gamepadName; }
  get taps(): InputTap[] { return this.players[0].taps; }

  player(id: number): PlayerInputLike {
    return this.players[Math.max(0, Math.min(MAX_PLAYERS - 1, Math.floor(id)))];
  }

  gesture(): void {
    if (!this.gestureDone) {
      this.gestureDone = true;
      this.onGesture();
    }
  }

  configureLobby(maxPlayers = 2): void {
    this.lobbyActive = true;
    this.maxPlayers = Math.max(1, Math.min(MAX_PLAYERS, Math.floor(maxPlayers)));
    this.joinRequests.length = 0;
  }

  configureSession(mode: 'solo' | 'local', playerCount = 1): void {
    this.lobbyActive = false;
    this.maxPlayers = mode === 'local' ? Math.max(1, Math.min(MAX_PLAYERS, Math.floor(playerCount))) : 1;
    this.joinRequests.length = 0;
    this.autoBindConnectedPads();
  }

  claimGamepad(gamepadIndex: number, playerId: number): boolean {
    if (playerId < 0 || playerId >= this.maxPlayers) return false;
    const record = this.pads.get(gamepadIndex);
    if (!record || !record.pad.connected) return false;
    const existing = this.padBindings.indexOf(gamepadIndex);
    if (existing >= 0 && existing !== playerId) return false;
    const occupied = this.padBindings[playerId];
    if (occupied !== null && occupied !== gamepadIndex) return false;
    this.padBindings[playerId] = gamepadIndex;
    if (existing >= 0) this.padBindings[existing] = null;
    this.removeJoinRequest(gamepadIndex);
    return true;
  }

  releasePlayer(playerId: number): void {
    if (playerId < 0 || playerId >= this.padBindings.length) return;
    this.padBindings[playerId] = null;
  }

  poll(): void {
    if (this.blocked) {
      this.clearAll();
      return;
    }

    this.refreshPads();
    this.composeRawStates();
  }

  advanceStep(stepTime = performance.now()): void {
    if (this.replayPlayer) {
      const replayFrame = this.replayPlayer.next();
      if (replayFrame) {
        for (let i = 0; i < this.players.length; i++) {
          const frame = replayFrame.players[i];
          if (frame) this.players[i].applyReplay(frame, stepTime);
          else this.players[i].clear();
        }
      } else {
        // Une trace terminée reste déterministe : elle ne rebascule jamais
        // silencieusement vers les entrées matérielles du joueur.
        for (const player of this.players) player.clear();
      }
    } else {
      for (const player of this.players) player.advance(stepTime);
    }

    if (this.replayRecorder) {
      for (let i = 0; i < this.players.length; i++) {
        const player = this.players[i];
        const frame = this.replayScratch[i];
        frame.downMask = player.downMask >>> 0;
        frame.pressedMask = this.maskForEdges(player, 'pressed');
        frame.releasedMask = this.maskForEdges(player, 'released');
        frame.moveX = player.moveX;
        frame.moveY = player.moveY;
        frame.aimX = player.aimX;
        frame.aimY = player.aimY;
      }
    }
  }

  recordStep(step: number): void {
    if (!this.replayRecorder) return;
    this.replayRecorder.push(step, this.replayScratch.slice(0, this.maxPlayers));
  }

  setReplayRecorder(recorder: ReplayRecorder | null): void {
    this.replayRecorder = recorder;
  }

  setReplayPlayer(player: ReplayPlayer | null): void {
    this.replayPlayer = player;
  }

  clearEdges(): void {
    for (const player of this.players) player.clearPlayerEdges();
    this.keyEdges.clear();
  }

  absorb(): void {
    for (const player of this.players) player.absorb();
    this.keyEdges.clear();
    this.joinRequests.length = 0;
  }

  setBlocked(blocked: boolean): void {
    this.blocked = blocked;
    if (blocked) this.clearAll();
  }

  down(action: Action): boolean { return this.players[0].down(action); }
  pressed(action: Action): boolean { return this.players[0].pressed(action); }
  released(action: Action): boolean { return this.players[0].released(action); }
  key(code: string): boolean { return this.players[0].key(code); }
  keyPressed(code: string): boolean { return this.players[0].keyPressed(code); }

  rumble(strength = 0.5, duration = 0.15): void { this.players[0].rumble(strength, duration); }

  replayTraceRecorder(): ReplayRecorder | null { return this.replayRecorder; }

  private maskForEdges(player: PlayerInput, kind: 'pressed' | 'released'): number {
    let mask = 0;
    for (let i = 0; i < ACTIONS.length; i++) {
      if (player.actions[ACTIONS[i]][kind]) mask |= 1 << i;
    }
    return mask >>> 0;
  }

  private refreshPads(): void {
    const list = typeof navigator !== 'undefined' && navigator.getGamepads ? navigator.getGamepads() : [];
    const seen: number[] = this.seenPadIndices;
    seen.length = 0;
    for (let i = 0; i < list.length; i++) {
      const pad = list[i];
      if (!pad?.connected) continue;
      seen.push(pad.index);
      let record = this.pads.get(pad.index);
      if (!record) {
        record = { index: pad.index, pad, downMask: 0, previousDownMask: 0 };
        this.pads.set(pad.index, record);
      }
      record.pad = pad;
      record.previousDownMask = record.downMask;
      record.downMask = this.readPadMask(pad);
      const pressed = record.downMask & ~record.previousDownMask;
      if (pressed & actionBit('a')) this.addJoinRequest(record.index);
    }

    for (const [index] of this.pads) {
      if (seen.includes(index)) continue;
      this.pads.delete(index);
      this.unbindGamepad(index);
    }

    if (!this.lobbyActive) this.autoBindConnectedPads();
  }

  private readonly seenPadIndices: number[] = [];

  private readPadMask(pad: Gamepad): number {
    let mask = 0;
    for (const binding of PAD_BINDINGS) {
      const button = pad.buttons[binding.index];
      const down = !!button && (button.pressed || button.value > 0.5);
      if (down) mask |= actionBit(binding.action);
    }
    return mask >>> 0;
  }

  private autoBindConnectedPads(): void {
    if (this.lobbyActive) return;
    if (this.padBindings[0] === null) {
      const first = this.firstUnboundPad();
      if (first) this.padBindings[0] = first.index;
    }
  }

  private firstUnboundPad(): PadRecord | null {
    let first: PadRecord | null = null;
    for (const [index, record] of this.pads) {
      if (this.padBindings.includes(index) || (first && index >= first.index)) continue;
      first = record;
    }
    return first;
  }

  private readonly radialMoveScratch: [number, number] = [0, 0];
  private readonly radialAimScratch: [number, number] = [0, 0];

  private composeRawStates(): void {
    const keyboardMask = this.readKeyboardMask();
    for (let i = 0; i < this.players.length; i++) {
      const player = this.players[i];
      const raw = this.rawStates[i];
      raw.downMask = 0;
      raw.moveX = 0;
      raw.moveY = 0;
      raw.aimX = 0;
      raw.aimY = 0;

      const boundIndex = this.padBindings[i];
      const record = boundIndex === null ? null : this.pads.get(boundIndex) || null;
      if (i === 0) raw.downMask |= keyboardMask;
      if (record) {
        raw.downMask |= record.downMask;
        let lx = record.pad.axes[0] || 0;
        let ly = record.pad.axes[1] || 0;
        let rx = record.pad.axes[2] || 0;
        let ry = record.pad.axes[3] || 0;
        radialInto(lx, ly, this.radialMoveScratch);
        radialInto(rx, ry, this.radialAimScratch);
        lx = this.radialMoveScratch[0];
        ly = this.radialMoveScratch[1];
        rx = this.radialAimScratch[0];
        ry = this.radialAimScratch[1];
        raw.moveX = lx;
        raw.moveY = ly;
        raw.aimX = rx;
        raw.aimY = ry;
      }

      if (raw.downMask & actionBit('left')) raw.moveX = -1;
      else if (raw.downMask & actionBit('right')) raw.moveX = 1;
      if (raw.downMask & actionBit('up')) raw.moveY = -1;
      else if (raw.downMask & actionBit('down')) raw.moveY = 1;

      const keyboardActive = i === 0 && keyboardMask !== 0;
      const padActive = !!record;
      const source: PlayerSource = keyboardActive && padActive
        ? 'mixed'
        : keyboardActive
          ? 'keyboard'
          : padActive
            ? 'gamepad'
            : 'none';
      player.setRaw(raw, record?.pad || null, source);
    }
  }

  private readKeyboardMask(): number {
    let mask = 0;
    for (const code of KEY_CODES) {
      if (this.keys.has(code)) mask |= actionBit(KEY_MAP[code]);
    }
    return mask >>> 0;
  }

  private addJoinRequest(gamepadIndex: number): void {
    if (!this.lobbyActive || this.padBindings.includes(gamepadIndex)) return;
    if (this.joinRequests.some((request) => request.gamepadIndex === gamepadIndex)) return;
    this.joinRequests.push({ gamepadIndex, t: performance.now() });
  }

  private removeJoinRequest(gamepadIndex: number): void {
    for (let i = this.joinRequests.length - 1; i >= 0; i--) {
      if (this.joinRequests[i].gamepadIndex === gamepadIndex) this.joinRequests.splice(i, 1);
    }
  }

  private unbindGamepad(gamepadIndex: number): void {
    for (let i = 0; i < this.padBindings.length; i++) {
      if (this.padBindings[i] === gamepadIndex) this.padBindings[i] = null;
    }
    this.removeJoinRequest(gamepadIndex);
  }

  private clearAll(): void {
    this.joinRequests.length = 0;
    for (const player of this.players) player.clear();
    this.keyEdges.clear();
  }
}

// Nom explicite du contrat multi-joueur ; Input reste exporté pour la façade
// historique utilisée par les mini-jeux existants.
export { Input as InputManager };
