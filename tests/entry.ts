import { FixedClock } from '../js/core/clock';
import { circleIntersectsAabb, circleIntersectsCircle, segmentIntersectsAabb } from '../js/core/collisions';
import { Input, radial } from '../js/core/input';
import { PhysicsWorld } from '../js/core/physics';
import { ObjectPool } from '../js/core/pool';
import { ReplayRecorder, validateReplay } from '../js/core/replay';
import { SeededRng } from '../js/core/rng';
import { SpatialHash } from '../js/core/spatial-hash';
import { GridSystem, PhaseMachine, Scroller } from '../js/core/systems';
import { DevTools } from '../js/core/devtools';
import { ACTIONS, type ReplayPlayerFrame } from '../js/core/types';

type Test = () => void | Promise<void>;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function equal<T>(actual: T, expected: T, message: string): void {
  if (!Object.is(actual, expected)) throw new Error(`${message} (reçu: ${String(actual)}, attendu: ${String(expected)})`);
}

function close(actual: number, expected: number, message: string, epsilon = 1e-8): void {
  if (Math.abs(actual - expected) > epsilon) throw new Error(`${message} (reçu: ${actual}, attendu: ${expected})`);
}

function throws(action: () => unknown, message: string): void {
  let failed = false;
  try {
    action();
  } catch {
    failed = true;
  }
  assert(failed, message);
}

function testClock(): void {
  const clock = new FixedClock({ step: 0.1, maxSteps: 4, maxFrameDt: 0.5, maxAccumulator: 0.4 });
  const steps: number[] = [];
  equal(clock.advance(0, (_dt, step) => steps.push(step)).steps, 0, 'Une durée nulle ne simule aucun pas');
  const first = clock.advance(0.25, (_dt, step) => steps.push(step));
  equal(first.steps, 2, 'L’horloge produit deux pas');
  equal(steps.join(','), '0,1', 'Les indices de pas sont continus');
  close(first.accumulator, 0.05, 'L’accumulateur conserve le reliquat');

  const slowFrame = clock.advance(1, (_dt, step) => steps.push(step));
  equal(slowFrame.steps, 4, 'Le rattrapage est limité à quatre pas');
  assert(slowFrame.droppedSteps >= 5, 'Les pas perdus sont comptés');
  assert(slowFrame.accumulator <= 0.4, 'L’accumulateur reste borné');
  equal(clock.totalSteps, 6, 'Le compteur total de pas est correct');
  close(clock.realTime, 1.25, 'Le temps réel est séparé du temps simulé');
  close(clock.simulatedTime, 0.6, 'Le temps simulé ne compte que les pas exécutés');
  clock.reset();
  equal(clock.totalSteps, 0, 'Le reset remet le compteur de pas à zéro');
  equal(clock.totalDroppedSteps, 0, 'Le reset remet le compteur de pas abandonnés à zéro');
  equal(clock.simulatedTime, 0, 'Le reset remet le temps simulé à zéro');
}

function testRng(): void {
  const left = new SeededRng(123456);
  const right = new SeededRng(123456);
  const other = new SeededRng(123457);
  const valuesLeft = Array.from({ length: 12 }, () => left.next());
  const valuesRight = Array.from({ length: 12 }, () => right.next());
  const valuesOther = Array.from({ length: 12 }, () => other.next());
  equal(valuesLeft.join(','), valuesRight.join(','), 'Une seed identique produit la même séquence');
  assert(valuesLeft.some((value, i) => value !== valuesOther[i]), 'Deux seeds produisent des séquences différentes');
  for (let i = 0; i < 30; i++) {
    const value = left.int(2, 5);
    assert(value >= 2 && value <= 5 && Number.isInteger(value), 'int() respecte ses bornes');
  }
  equal(new SeededRng(1).pick(['ok']), 'ok', 'pick() fonctionne sur une collection unitaire');
}

function playerFrame(overrides: Partial<ReplayPlayerFrame> = {}): ReplayPlayerFrame {
  return {
    downMask: 0,
    pressedMask: 0,
    releasedMask: 0,
    moveX: 0,
    moveY: 0,
    aimX: 0,
    aimY: 0,
    ...overrides,
  };
}

function testReplay(): void {
  const recorder = new ReplayRecorder('pong', 77, 2, 'test-build', 1 / 60);
  recorder.push(0, [playerFrame({ pressedMask: 1 }), playerFrame({ moveX: -0.5 })]);
  recorder.push(1, [playerFrame({ downMask: 1 }), playerFrame()]);
  const trace = recorder.finish();
  const valid = validateReplay(trace, { gameId: 'pong', buildVersion: 'test-build', playerCount: 2, fixedStep: 1 / 60 });
  equal(valid.frames.length, 2, 'Le replay conserve les frames enregistrées');
  throws(() => validateReplay({ ...trace, seed: -1 }, { gameId: 'pong', buildVersion: 'test-build', playerCount: 2, fixedStep: 1 / 60 }), 'Une seed négative est refusée');
  throws(() => validateReplay({ ...trace, frames: [{ ...trace.frames[0], players: [playerFrame({ moveX: 2 }), playerFrame()] }] }, { gameId: 'pong', buildVersion: 'test-build', playerCount: 2, fixedStep: 1 / 60 }), 'Un axe hors bornes est refusé');
  throws(() => validateReplay({ ...trace, frames: [{ ...trace.frames[0], step: 4 }, trace.frames[1]] }, { gameId: 'pong', buildVersion: 'test-build', playerCount: 2, fixedStep: 1 / 60 }), 'Une frame dans le désordre est refusée');

  const offsetRecorder = new ReplayRecorder('pong', 77, 1, 'test-build', 1 / 60);
  offsetRecorder.push(18, [playerFrame()]);
  offsetRecorder.push(19, [playerFrame()]);
  equal(offsetRecorder.finish().frames[0].step, 0, 'Un enregistrement démarré en cours de partie repart à zéro');
}

interface FakeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function setupInputGlobals(): { listeners: Map<string, EventListener[]>; pads: Gamepad[]; storage: FakeStorage } {
  const listeners = new Map<string, EventListener[]>();
  const pads: Gamepad[] = [];
  const storageMap = new Map<string, string>();
  const storage: FakeStorage = {
    getItem: (key) => storageMap.get(key) ?? null,
    setItem: (key, value) => storageMap.set(key, value),
  };
  const host = globalThis as unknown as {
    addEventListener: (type: string, listener: EventListener) => void;
    navigator: Navigator;
    localStorage: Storage;
  };
  host.addEventListener = (type, listener) => {
    const list = listeners.get(type) || [];
    list.push(listener);
    listeners.set(type, list);
  };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { getGamepads: () => pads },
  });
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: storage,
  });
  return { listeners, pads, storage };
}

function emit(listeners: Map<string, EventListener[]>, type: string, event: Partial<KeyboardEvent>): void {
  for (const listener of listeners.get(type) || []) listener(event as KeyboardEvent);
}

function makePad(index: number, a = false): Gamepad {
  return {
    id: `Test Pad ${index}`,
    index,
    connected: true,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 16 }, (_, buttonIndex) => ({
      pressed: buttonIndex === 0 && a,
      touched: buttonIndex === 0 && a,
      value: buttonIndex === 0 && a ? 1 : 0,
    })) as unknown as readonly GamepadButton[],
    timestamp: 0,
    vibrationActuator: { playEffect: () => Promise.resolve('complete') } as unknown as GamepadHapticActuator,
  } as unknown as Gamepad;
}

function testInput(): void {
  const { listeners, pads } = setupInputGlobals();
  const input = new Input();
  input.configureLobby(2);
  const pad0 = makePad(0, true);
  const pad1 = makePad(1, true);
  pads.push(pad0, pad1);
  input.poll();
  input.advanceStep(10);
  equal(input.joinRequests.length, 2, 'Les deux manettes demandent à rejoindre');
  assert(input.claimGamepad(0, 0), 'La première manette est attribuée au joueur 1');
  assert(input.claimGamepad(1, 1), 'La deuxième manette est attribuée au joueur 2');

  input.poll();
  input.advanceStep(20);
  assert(input.player(0).pressed('a'), 'La transition pressed est générée par pas simulé');
  assert(input.player(1).down('a'), 'Le joueur 2 reçoit l’état de sa manette');
  equal(input.player(1).gamepadIndex, 1, 'Le joueur 2 conserve son index de manette');
  equal(input.player(0).source, 'gamepad', 'La source du joueur 1 est indiquée');
  input.clearEdges();
  input.player(0).taps.length = 0;

  pads.splice(0, 1);
  input.poll();
  input.advanceStep(30);
  equal(input.player(0).gamepadIndex, null, 'Une manette déconnectée libère son slot');
  equal(input.player(1).gamepadIndex, 1, 'La déconnexion du joueur 1 ne réordonne pas le joueur 2');

  emit(listeners, 'keydown', { code: 'Space', repeat: false, timeStamp: 40, preventDefault: () => {} });
  input.poll();
  input.advanceStep(40);
  assert(input.player(0).pressed('a'), 'Le clavier reste disponible pour le joueur 1');
  equal(input.player(0).taps.length, 1, 'Une pression clavier produit un tap unique');
  emit(listeners, 'keyup', { code: 'Space' });
  input.poll();
  input.advanceStep(50);
  assert(input.player(0).released('a'), 'La transition released est conservée');

  const pad1Axes = pad1.axes as number[];
  pad1Axes[0] = 0.1;
  pad1Axes[1] = 0.1;
  input.clearEdges();
  input.poll();
  close(input.player(1).moveX, 0, 'La deadzone radiale neutralise un petit déplacement');
  let rumbleCount = 0;
  (pad1.vibrationActuator as unknown as { playEffect: () => Promise<string> }).playEffect = () => {
    rumbleCount++;
    return Promise.resolve('complete');
  };
  input.player(1).rumble(0.4, 0.05);
  equal(rumbleCount, 1, 'Le rumble cible la manette du joueur demandé');
  const [x, y] = radial(1, 0);
  close(x, 1, 'La normalisation radiale conserve un axe plein');
  close(y, 0, 'La normalisation radiale conserve zéro sur l’axe secondaire');
}

function testPoolAndHash(): void {
  let nextId = 0;
  const pool = new ObjectPool(() => ({ id: ++nextId }), 1);
  const first = pool.acquire();
  const second = pool.acquire();
  assert(pool.has(first) && pool.has(second), 'Les objets acquis sont actifs');
  pool.release(first);
  equal(pool.active.length, 1, 'La suppression par échange retire l’objet');
  assert(pool.active[0] === second, 'La suppression par échange conserve le dernier objet');
  const reused = pool.acquire();
  assert(reused === first, 'Le pool réutilise l’objet libéré');
  pool.clear();
  equal(pool.active.length, 0, 'clear() vide les objets actifs');
  assert(!pool.has(second), 'clear() ne laisse pas de référence active');

  const hash = new SpatialHash<{ id: number }>(64);
  const large = { id: 1 };
  const far = { id: 2 };
  hash.insert(large, 0, 0, 128, 128);
  hash.insert(far, 300, 300, 320, 320);
  const result = hash.queryAabb(0, 0, 64, 64);
  equal(result.length, 1, 'La requête spatiale déduplique les cellules');
  equal(result[0], large, 'La requête spatiale retourne le bon objet');
  hash.remove(large);
  equal(hash.queryAabb(0, 0, 64, 64).length, 0, 'remove() retire immédiatement l’objet');
}

function testCollisionsAndPhysics(): void {
  assert(circleIntersectsCircle({ x: 0, y: 0, radius: 4 }, { x: 7, y: 0, radius: 4 }), 'Deux cercles qui se touchent sont détectés');
  assert(!circleIntersectsCircle({ x: 0, y: 0, radius: 2 }, { x: 5, y: 0, radius: 2 }), 'Deux cercles séparés ne sont pas détectés');
  assert(circleIntersectsAabb({ x: 3, y: 3, radius: 2 }, { x: 4, y: 4, w: 8, h: 8 }), 'Cercle/AABB est détecté');
  assert(!circleIntersectsAabb({ x: 0, y: 0, radius: 2 }, { x: 4, y: 4, w: 2, h: 2 }), 'Cercle/AABB écarte les faux positifs');
  assert(segmentIntersectsAabb({ x0: -2, y0: 5, x1: 12, y1: 5 }, { x: 0, y: 0, w: 10, h: 10 }), 'Un segment traversant une AABB est détecté');
  assert(!segmentIntersectsAabb({ x0: -2, y0: -2, x1: -1, y1: -1 }, { x: 0, y: 0, w: 10, h: 10 }), 'Un segment éloigné est écarté');

  const world = new PhysicsWorld(16);
  const ball = world.createBody({ x: 5, y: 10, vx: 100, shape: { kind: 'circle', radius: 5 }, restitution: 1 });
  const wall = world.createBody({ x: 19, y: 10, shape: { kind: 'aabb', width: 4, height: 40 }, static: true, restitution: 1 });
  let collisions = 0;
  world.onCollision(() => collisions++);
  world.step(0.1);
  assert(collisions > 0, 'La physique déclenche un callback de collision');
  assert(ball.vx < 0, 'La restitution inverse la vitesse contre un mur');
  assert(world.queryCircle(19, 10, 2).includes(wall), 'La requête cercle retrouve le mur');
  assert(!world.queryCircle(0, 0, 2).includes(wall), 'La requête cercle filtre les candidats éloignés');
  const masked = world.createBody({ x: 5, y: 10, shape: { kind: 'circle', radius: 2 }, layer: 2, mask: 2 });
  const maskedWall = world.createBody({ x: 5, y: 10, shape: { kind: 'aabb', width: 6, height: 6 }, static: true, layer: 4, mask: 4 });
  let maskedCollisions = 0;
  world.onCollision(() => maskedCollisions++);
  world.step(1 / 60);
  assert(masked && maskedWall, 'Les couches peuvent être créées sans collision implicite');
  equal(maskedCollisions, 0, 'Les masques de collision isolent les couches');
}

function testSystems(): void {
  const grid = new GridSystem(3, 2, () => 0);
  grid.set(1, 1, 7);
  equal(grid.get(1, 1), 7, 'GridSystem adresse une cellule');
  assert(!grid.inBounds(3, 0) && grid.get(3, 0) === undefined, 'GridSystem protège ses limites');

  const scroller = new Scroller(12, 10);
  close(scroller.update(1), 2, 'Scroller boucle son offset');
  scroller.reset(-3);
  close(scroller.value(), 7, 'Scroller normalise un offset négatif');

  const events: string[] = [];
  const phases = new PhaseMachine<'idle' | 'play'>('idle',
    (next, previous) => events.push(`enter:${previous}->${next}`),
    (previous, next) => events.push(`exit:${previous}->${next}`));
  assert(phases.set('play'), 'PhaseMachine change de phase');
  equal(events.join(','), 'exit:idle->play,enter:idle->play', 'PhaseMachine ordonne sortie puis entrée');
  close(phases.update(0.25), 0.25, 'PhaseMachine mesure le temps de phase');
}

function testDevTools(): void {
  const dev = new DevTools();
  dev.activate();
  let command = '';
  dev.setCommandHandler((name) => { command = name; });
  dev.command('pause');
  equal(command, 'pause', 'DevTools relaie les commandes');
  dev.count('objects', 4);
  dev.state('mode', 'test');
  dev.mark('frame');
  assert(dev.counters.get('objects') === 4 && dev.states.get('mode') === 'test', 'DevTools conserve les diagnostics');
  dev.assertFinite('ok', 1);
}

const tests: readonly [string, Test][] = [
  ['FixedClock', testClock],
  ['SeededRng', testRng],
  ['Replay', testReplay],
  ['InputManager', testInput],
  ['ObjectPool + SpatialHash', testPoolAndHash],
  ['Collisions + PhysicsWorld', testCollisionsAndPhysics],
  ['GridSystem + Scroller + PhaseMachine', testSystems],
  ['DevTools', testDevTools],
];

for (const [name, test] of tests) {
  await test();
  console.log(`✓ ${name}`);
}

console.log(`\n${tests.length} groupes de tests moteur passés.`);
