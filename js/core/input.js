// Input unifié : manette (Gamepad API) + clavier + souris.
// Une seule source de vérité : des "actions" abstraites (a, b, x, y, up/down/left/right, start, select, back, lb, rb)
// plus deux sticks virtuels (moveX/moveY, aimX/aimY).
// 'back' (Échap) est volontairement séparé de 'start' : Échap doit toujours
// signifier "revenir en arrière / annuler", jamais valider ni lancer.

const ACTIONS = ['a', 'b', 'x', 'y', 'up', 'down', 'left', 'right', 'start', 'select', 'back', 'lb', 'rb'];

const PAD_MAP = { 0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 8: 'select', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right' };

// Mapping physique (e.code) => identique sur AZERTY (WASD = ZQSD automatiquement)
const KEY_MAP = {
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

function radial(x, y) {
  const l = Math.hypot(x, y);
  const dz = 0.22;
  if (l < dz) return [0, 0];
  const s = Math.min(1, (l - dz) / (1 - dz));
  return [x / l * s, y / l * s];
}

export class Input {
  constructor(onGesture) {
    this.onGesture = onGesture || (() => {});
    this.actions = {};
    for (const a of ACTIONS) this.actions[a] = { down: false, pressed: false, released: false };
    this.moveX = 0; this.moveY = 0;
    this.aimX = 0; this.aimY = 0;
    this.pad = null;
    this.padConnected = false;
    this.padName = '';
    this.keys = new Set();
    this.gestureDone = false;
    this.taps = [];       // frappes horodatées (calibration du métronome)
    this.padPrev = {};
    this.vibration = true;
    try { this.vibration = localStorage.getItem('blobArcade.vib') !== '0'; } catch (e) { /* défaut : actif */ }

    addEventListener('keydown', (e) => {
      if (PREVENT.has(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.keys.add(e.code);
      // frappe posée dès l'événement (collante) : un appui plus court qu'une frame
      // est quand même vu par la simulation
      const n = KEY_MAP[e.code];
      if (n) {
        this.actions[n].pressed = true;
        this.taps.push({ t: e.timeStamp || performance.now(), a: n });
        if (this.taps.length > 48) this.taps.shift();
      }
      this.gesture();
    });
    addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      const n = KEY_MAP[e.code];
      if (n) this.actions[n].released = true;
    });
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', () => this.gesture());
  }

  gesture() {
    if (!this.gestureDone) { this.gestureDone = true; this.onGesture(); }
  }

  poll() {
    const b = {};
    let mx = 0, my = 0, ax = 0, ay = 0;

    let pad = null;
    if (navigator.getGamepads) {
      for (const p of navigator.getGamepads()) { if (p && p.connected) { pad = p; break; } }
    }
    this.pad = pad;
    this.padConnected = !!pad;
    this.padName = pad ? pad.id.slice(0, 34) : '';

    if (pad) {
      let lx = pad.axes[0] || 0, ly = pad.axes[1] || 0;
      let rx = pad.axes[2] || 0, ry = pad.axes[3] || 0;
      [lx, ly] = radial(lx, ly);
      [rx, ry] = radial(rx, ry);
      mx = lx; my = ly; ax = rx; ay = ry;
      for (const i in PAD_MAP) {
        const btn = pad.buttons[i];
        const d = !!(btn && (btn.pressed || btn.value > 0.5));
        if (d) b[PAD_MAP[i]] = true;
        if (d && !this.padPrev[i]) {
          // frappe manette horodatée (à la frame près — suffisant en moyenne)
          this.taps.push({ t: performance.now(), a: PAD_MAP[i] });
          if (this.taps.length > 48) this.taps.shift();
        }
        this.padPrev[i] = d;
      }
    }

    for (const code in KEY_MAP) if (this.keys.has(code)) b[KEY_MAP[code]] = true;

    if (b.left) mx = -1; else if (b.right) mx = 1;
    if (b.up) my = -1; else if (b.down) my = 1;

    for (const a of ACTIONS) {
      const s = this.actions[a];
      const d = !!b[a];
      // Frappes "collantes" : posées ici, effacées par clearEdges() uniquement après un
      // pas de simulation effectif. Sinon, tout frame sans pas (accumulateur, hitstop)
      // détruisait la frappe au poll suivant — d'où les boutons "mangés" / la latence.
      if (d && !s.down) s.pressed = true;
      else if (!d && s.down) s.released = true;
      s.down = d;
    }

    this.moveX = mx; this.moveY = my;
    this.aimX = ax; this.aimY = ay;
  }

  clearEdges() {
    for (const a of ACTIONS) { this.actions[a].pressed = false; this.actions[a].released = false; }
  }

  // Neutralise les frappes en cours (ex. la touche/le clic qui ferme la modale d'intro
  // ne doit pas déclencher une action du menu juste derrière).
  absorb() {
    for (const a of ACTIONS) { this.actions[a].pressed = false; this.actions[a].released = false; }
    for (const code in KEY_MAP) {
      if (this.keys.has(code)) this.actions[KEY_MAP[code]].down = true;
    }
  }

  down(n) { return !!this.actions[n]?.down; }
  pressed(n) { return !!this.actions[n]?.pressed; }
  key(code) { return this.keys.has(code); }

  rumble(strength = 0.5, dur = 0.15) {
    if (!this.vibration) return;
    const act = this.pad && this.pad.vibrationActuator;
    if (!act) return;
    try {
      act.playEffect('dual-rumble', {
        duration: Math.round(dur * 1000),
        strongMagnitude: Math.max(0, Math.min(1, strength)),
        weakMagnitude: Math.max(0, Math.min(1, strength * 0.7)),
      });
    } catch (e) { /* pas de vibreur, pas de drame */ }
  }
}
