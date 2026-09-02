// Input unifié : manette (Gamepad API) + clavier + souris.
// Une seule source de vérité : des actions abstraites (a, b, x, y, up/down/left/right, start, select, back, lb, rb)
// plus deux sticks virtuels (moveX/moveY, aimX/aimY).
// 'back' (Échap) est volontairement séparé de 'start' : Échap doit toujours
// signifier "revenir en arrière / annuler", jamais valider ni lancer.

import { ACTIONS, type Action, type ActionMap, type InputTap } from './types';

const PAD_MAP: Partial<Record<number, Action>> = {
  0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb',
  8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

// Mapping physique (e.code) => identique sur AZERTY (WASD = ZQSD automatiquement)
const KEY_MAP: Record<string, Action> = {
  Space: 'a', KeyJ: 'a',
  KeyK: 'b', ShiftLeft: 'b',
  KeyL: 'x',
  KeyU: 'y',
  Enter: 'start',
  Escape: 'back',
  Backspace: 'select',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
};
const PREVENT = new Set(Object.keys(KEY_MAP));

export function radial(x: number, y: number): [number, number] {
  const l = Math.hypot(x, y);
  const dz = 0.22;
  if (l < dz) return [0, 0];
  const s = Math.min(1, (l - dz) / (1 - dz));
  return [x / l * s, y / l * s];
}

export class Input {
  readonly onGesture: () => void;
  readonly actions: ActionMap;
  moveX = 0;
  moveY = 0;
  aimX = 0;
  aimY = 0;
  pad: Gamepad | null = null;
  padConnected = false;
  padName = '';
  readonly keys = new Set<string>();
  gestureDone = false;
  readonly taps: InputTap[] = [];
  readonly padPrev: Partial<Record<number, boolean>> = {};
  vibration = true;

  constructor(onGesture: () => void = () => {}) {
    this.onGesture = onGesture;
    this.actions = Object.fromEntries(
      ACTIONS.map((action) => [action, { down: false, pressed: false, released: false }]),
    ) as ActionMap;

    try {
      this.vibration = localStorage.getItem('blobArcade.vib') !== '0';
    } catch {
      // Défaut : actif.
    }

    addEventListener('keydown', (event: KeyboardEvent) => {
      if (PREVENT.has(event.code)) event.preventDefault();
      if (event.repeat) return;
      this.keys.add(event.code);

      // Frappe posée dès l'événement (collante) : un appui plus court qu'une frame
      // est quand même vu par la simulation.
      const action = KEY_MAP[event.code];
      if (action) {
        this.actions[action].pressed = true;
        this.pushTap({ t: event.timeStamp || performance.now(), a: action });
      }
      this.gesture();
    });

    addEventListener('keyup', (event: KeyboardEvent) => {
      this.keys.delete(event.code);
      const action = KEY_MAP[event.code];
      if (action) this.actions[action].released = true;
    });

    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', () => this.gesture());
  }

  private pushTap(tap: InputTap): void {
    this.taps.push(tap);
    if (this.taps.length > 48) this.taps.shift();
  }

  gesture(): void {
    if (!this.gestureDone) {
      this.gestureDone = true;
      this.onGesture();
    }
  }

  poll(): void {
    const buttons: Partial<Record<Action, boolean>> = {};
    let mx = 0;
    let my = 0;
    let ax = 0;
    let ay = 0;

    let pad: Gamepad | null = null;
    if (navigator.getGamepads) {
      for (const candidate of Array.from(navigator.getGamepads())) {
        if (candidate?.connected) {
          pad = candidate;
          break;
        }
      }
    }
    this.pad = pad;
    this.padConnected = !!pad;
    this.padName = pad ? pad.id.slice(0, 34) : '';

    if (pad) {
      let lx = pad.axes[0] || 0;
      let ly = pad.axes[1] || 0;
      let rx = pad.axes[2] || 0;
      let ry = pad.axes[3] || 0;
      [lx, ly] = radial(lx, ly);
      [rx, ry] = radial(rx, ry);
      mx = lx;
      my = ly;
      ax = rx;
      ay = ry;

      for (const indexString of Object.keys(PAD_MAP)) {
        const index = Number(indexString);
        const action = PAD_MAP[index];
        if (!action) continue;

        const button = pad.buttons[index];
        const down = !!(button && (button.pressed || button.value > 0.5));
        if (down) buttons[action] = true;
        if (down && !this.padPrev[index]) {
          // Frappe manette horodatée (à la frame près — suffisant en moyenne).
          this.pushTap({ t: performance.now(), a: action });
        }
        this.padPrev[index] = down;
      }
    }

    for (const code of Object.keys(KEY_MAP)) {
      const action = KEY_MAP[code];
      if (this.keys.has(code)) buttons[action] = true;
    }

    if (buttons.left) mx = -1;
    else if (buttons.right) mx = 1;
    if (buttons.up) my = -1;
    else if (buttons.down) my = 1;

    for (const action of ACTIONS) {
      const state = this.actions[action];
      const down = !!buttons[action];
      // Frappes "collantes" : posées ici, effacées par clearEdges() uniquement après
      // un pas de simulation effectif.
      if (down && !state.down) state.pressed = true;
      else if (!down && state.down) state.released = true;
      state.down = down;
    }

    this.moveX = mx;
    this.moveY = my;
    this.aimX = ax;
    this.aimY = ay;
  }

  clearEdges(): void {
    for (const action of ACTIONS) {
      this.actions[action].pressed = false;
      this.actions[action].released = false;
    }
  }

  // Neutralise les frappes en cours (ex. la touche/le clic qui ferme la modale d'intro
  // ne doit pas déclencher une action du menu juste derrière).
  absorb(): void {
    for (const action of ACTIONS) {
      this.actions[action].pressed = false;
      this.actions[action].released = false;
    }
    for (const code of Object.keys(KEY_MAP)) {
      if (this.keys.has(code)) this.actions[KEY_MAP[code]].down = true;
    }
  }

  down(action: Action): boolean {
    return this.actions[action].down;
  }

  pressed(action: Action): boolean {
    return this.actions[action].pressed;
  }

  key(code: string): boolean {
    return this.keys.has(code);
  }

  rumble(strength = 0.5, duration = 0.15): void {
    if (!this.vibration) return;
    const actuator = this.pad?.vibrationActuator;
    if (!actuator) return;

    try {
      actuator.playEffect('dual-rumble', {
        duration: Math.round(duration * 1000),
        strongMagnitude: Math.max(0, Math.min(1, strength)),
        weakMagnitude: Math.max(0, Math.min(1, strength * 0.7)),
      });
    } catch {
      // Pas de vibreur, pas de drame.
    }
  }
}
