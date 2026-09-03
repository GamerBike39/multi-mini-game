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
import { simonPadPressed } from '../js/games/simon';
import {
  ColumnBoard,
  ReleaseLatch,
  applyGravity,
  clearTier,
  colorCountForLevel,
  computeGaze,
  computeGravityMoves,
  cycleSlide,
  emptyGrid,
  fallIntervalForLevel,
  findMatches,
  garbageForClear,
  scoreForClear,
  slotGaze,
  stackHeight,
  GARB,
} from '../js/games/columns';
import {
  adjacentGarbage,
  attackForShots,
  bcellCenter,
  bemptyGrid,
  bpixelToCell,
  colorCountForPopLevel,
  crossesLine,
  distinctColors,
  findFloaters,
  findPopGroups,
  floodGroup,
  hexNeighbors,
  makePattern,
  nearestEmptyCell,
  patternRowsForLevel,
  pickBubbleColor,
  pushRow,
  randomRowColors,
  resolveGrid,
  scoreForShot,
  BGARB,
  type BubbleLayout,
} from '../js/games/bubble';

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

function testSimonControls(): void {
  const input = (keys: string[] = [], actions: string[] = []) => ({
    keyPressed: (code: string) => keys.includes(code),
    pressed: (action: string) => actions.includes(action),
  });

  equal(simonPadPressed(input(['ArrowUp'])), 0, 'Simon : flèche haut sélectionne Y');
  equal(simonPadPressed(input(['ArrowLeft'])), 1, 'Simon : flèche gauche sélectionne X');
  equal(simonPadPressed(input(['ArrowRight'])), 2, 'Simon : flèche droite sélectionne B');
  equal(simonPadPressed(input(['ArrowDown'])), 3, 'Simon : flèche bas sélectionne A');
  equal(simonPadPressed(input([], ['y'])), 0, 'Simon : bouton Y de manette sélectionne le haut');
  equal(simonPadPressed(input([], ['x'])), 1, 'Simon : bouton X de manette sélectionne la gauche');
  equal(simonPadPressed(input([], ['b'])), 2, 'Simon : bouton B de manette sélectionne la droite');
  equal(simonPadPressed(input([], ['a'])), 3, 'Simon : bouton A de manette sélectionne le bas');
  equal(simonPadPressed(input(['KeyU'], ['y'])), -1, 'Simon : U ne déclenche plus de note');
  equal(simonPadPressed(input(['KeyL'], ['x'])), -1, 'Simon : L ne déclenche plus de note');
  equal(simonPadPressed(input(['KeyK'], ['b'])), -1, 'Simon : K ne déclenche plus de note');
  equal(simonPadPressed(input(['KeyJ'], ['a'])), -1, 'Simon : J ne déclenche plus de note');
  equal(simonPadPressed(input(['Space'], ['a'])), -1, 'Simon : Espace ne déclenche pas la note A');
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

function testColumns(): void {
  // Groupe lié horizontal de 4.
  const horizontal = emptyGrid(4, 6);
  horizontal[3][1] = 1;
  horizontal[3][2] = 1;
  horizontal[3][3] = 1;
  horizontal[3][4] = 1;
  equal(findMatches(horizontal).length, 4, 'Dr Blob détecte un groupe lié de 4');

  // Trio : trop petit, rien ne part.
  const trio = emptyGrid(4, 6);
  trio[3][1] = 1;
  trio[3][2] = 1;
  trio[3][3] = 1;
  equal(findMatches(trio).length, 0, 'Un trio ne fusionne pas (seuil à 4)');

  // Diagonale de 4 : ignorée, la liaison est strictement orthogonale.
  const diagonal = emptyGrid(5, 5);
  diagonal[0][0] = 2;
  diagonal[1][1] = 2;
  diagonal[2][2] = 2;
  diagonal[3][3] = 2;
  equal(findMatches(diagonal).length, 0, 'Les diagonales ne fusionnent jamais');

  // Les gris ne matchent jamais entre eux.
  const grey = emptyGrid(4, 6);
  grey[3][0] = GARB;
  grey[3][1] = GARB;
  grey[3][2] = GARB;
  equal(findMatches(grey).length, 0, 'Les blobs gris ne forment aucun groupe');

  // Gravité : les trous se rebouchent par le bas.
  const falling = emptyGrid(4, 3);
  falling[0][1] = 3;
  falling[2][1] = 4;
  applyGravity(falling);
  equal(falling[3][1], 4, 'La gravité tasse la colonne vers le bas');
  equal(falling[2][1], 3, 'La gravité conserve l’ordre de la colonne');
  equal(falling[0][1], 0, 'La gravité libère le haut de la colonne');

  // Cycle des couleurs d'un trio.
  const board = new ColumnBoard(6, 6);
  assert(board.trySpawn([1, 2, 3], [1, 1, 1]), 'Le spawn initial réussit');
  board.cycle(1);
  equal(board.active?.colors.join(','), '3,1,2', 'La permutation fait remonter le bas');
  board.cycle(-1);
  equal(board.active?.colors.join(','), '1,2,3', 'La permutation inverse annule la première');

  // Injection d'ordure : pousse la colonne vers le haut.
  const victim = new ColumnBoard(4, 3);
  assert(victim.inject(1, () => 1), 'L’injection d’un gris réussit');
  equal(victim.grid[3][1], GARB, 'Le gris se pose au fond de la colonne');

  // Barèmes : le nettoyage de base (4 liés) attaque déjà un peu.
  equal(garbageForClear(3, 1), 0, 'Sous le seuil, aucune attaque');
  assert(garbageForClear(4, 1) >= 1, 'Un groupe de 4 attaque');
  assert(garbageForClear(4, 2) >= 1, 'Une chaîne attaque');
  assert(scoreForClear(5, 1, 1) > scoreForClear(4, 1, 1), 'La taille augmente le score');
  assert(scoreForClear(4, 2, 1) > scoreForClear(4, 1, 1), 'La chaîne augmente le score');
  equal(scoreForClear(4, 1, 1), 60, 'Un groupe de 4 vaut 60 au niveau 1');
  equal(colorCountForLevel(1), 4, 'Niveau 1 : 4 couleurs');
  equal(colorCountForLevel(3), 5, 'Niveau 3 : 5 couleurs');
  assert(fallIntervalForLevel(5) < fallIntervalForLevel(1), 'La vitesse augmente avec le niveau');
}

// Situations limites de DR BLOB : formes qui se chevauchent, trous,
// diagonales inverses, chaînes après gravité, morts au plafond.
function testColumnsScenarios(): void {
  // Croix : ligne de 5 + colonne de 3 partageant le centre = 7 uniques.
  const cross = emptyGrid(5, 6);
  for (let c = 0; c < 5; c++) cross[2][c] = 1;
  cross[1][2] = 1;
  cross[3][2] = 1;
  equal(findMatches(cross).length, 7, 'La croix compte 7 cellules uniques');

  // Trou au milieu : deux paires, rien ne part.
  const gap = emptyGrid(4, 6);
  gap[3][0] = 1;
  gap[3][1] = 1;
  gap[3][3] = 1;
  gap[3][4] = 1;
  equal(findMatches(gap).length, 0, 'Un trou casse la liaison');

  // Anti-diagonale : ignorée elle aussi.
  const anti = emptyGrid(4, 6);
  anti[0][3] = 2;
  anti[1][2] = 2;
  anti[2][1] = 2;
  anti[3][0] = 2;
  equal(findMatches(anti).length, 0, 'L’anti-diagonale est ignorée (pas de liaison)');

  // Carré 2×2 : aucune ligne, mais un groupe lié de 4 → ça part.
  const square = emptyGrid(4, 4);
  square[1][1] = 2;
  square[1][2] = 2;
  square[2][1] = 2;
  square[2][2] = 2;
  equal(findMatches(square).length, 4, 'Le carré 2×2 fusionne sans aucune ligne');

  // Verticale de 4.
  const vertical = emptyGrid(5, 3);
  vertical[0][1] = 3;
  vertical[1][1] = 3;
  vertical[2][1] = 3;
  vertical[3][1] = 3;
  equal(findMatches(vertical).length, 4, 'La colonne de 4 est détectée');

  // Deux groupes séparés de même couleur : tous les deux trouvés.
  const duo = emptyGrid(4, 6);
  duo[0][0] = 1;
  duo[0][1] = 1;
  duo[0][2] = 1;
  duo[0][3] = 1;
  duo[3][2] = 1;
  duo[3][3] = 1;
  duo[3][4] = 1;
  duo[3][5] = 1;
  equal(findMatches(duo).length, 8, 'Deux groupes séparés sont tous détectés');

  // Grille vide : rien.
  equal(findMatches(emptyGrid(4, 4)).length, 0, 'La grille vide ne matche rien');

  // Gravité multi-colonnes indépendantes.
  const multi = emptyGrid(4, 3);
  multi[0][0] = 1;
  multi[0][2] = 2;
  multi[1][2] = 3;
  applyGravity(multi);
  equal(multi[3][0], 1, 'La colonne 0 tasse son unique blob');
  equal(multi[3][2], 3, 'La colonne 2 garde l’ordre bas');
  equal(multi[2][2], 2, 'La colonne 2 garde l’ordre haut');
  equal(multi[0][2], 0, 'Le haut de la colonne 2 est libéré');

  // Colonne pleine : inchangée.
  const full = emptyGrid(3, 2);
  full[0][0] = 1;
  full[1][0] = 2;
  full[2][0] = 3;
  applyGravity(full);
  equal(full[0][0] + full[1][0] + full[2][0], 6, 'La colonne pleine est inchangée');

  // Spawn bloqué au plafond : mort immédiate.
  const roof = new ColumnBoard();
  roof.grid[0][2] = 4;
  equal(roof.trySpawn([1, 2, 3], [1, 1, 1]), false, 'Le spawn bloqué échoue');
  assert(roof.dead, 'Le spawn bloqué tue le puits');

  // Murs : déplacement refusé au bord.
  const walls = new ColumnBoard(6, 6);
  assert(walls.trySpawn([1, 2, 3], [1, 1, 1]), 'Spawn pour le test des murs');
  assert(walls.move(-1) && walls.move(-1), 'Deux pas vers la gauche');
  equal(walls.move(-1), false, 'Le troisième pas sort du puits');

  // Fantôme sur puits vide : la pièce touche le fond.
  const ghost = new ColumnBoard(6, 6);
  assert(ghost.trySpawn([1, 1, 1], [2, 2, 2]), 'Spawn pour le fantôme');
  equal(ghost.ghostRow(), 3, 'Le fantôme vise le fond du puits vide');

  // Verrouillage : l’ordre haut→bas est conservé.
  const lock = new ColumnBoard(6, 6);
  assert(lock.trySpawn([1, 2, 3], [1, 1, 1]), 'Spawn pour le verrouillage');
  assert(lock.active, 'La pièce est active');
  lock.active.r = 3;
  const written = lock.lock();
  equal(written.length, 3, 'Les 3 cellules sont écrites');
  equal([lock.grid[3][2], lock.grid[4][2], lock.grid[5][2]].join(','), '1,2,3', 'L’ordre des couleurs est conservé');

  // Verrouillage hors grille : mort au plafond.
  const above = new ColumnBoard(6, 6);
  assert(above.trySpawn([1, 2, 3], [1, 1, 1]), 'Spawn pour le test hors grille');
  assert(above.active, 'La pièce est active');
  above.active.r = -3;
  equal(above.lock().length, 0, 'Rien n’est écrit totalement hors grille');
  assert(above.dead, 'Le verrouillage hors grille tue le puits');
  // Cas limite r=-2 : la cellule du bas (ligne 0) est écrite, mais c’est la mort.
  const edge = new ColumnBoard(6, 6);
  assert(edge.trySpawn([1, 2, 3], [1, 1, 1]), 'Spawn pour le cas limite');
  assert(edge.active, 'La pièce est active');
  edge.active.r = -2;
  equal(edge.lock().length, 1, 'Une seule cellule dépasse dans la grille');
  assert(edge.dead, 'Toucher le plafond en verrouillant tue le puits');

  // Gris orthogonal mangé, gris éloigné épargné (puis tassé en bas).
  const eat = new ColumnBoard(4, 5);
  eat.grid[0][0] = 1;
  eat.grid[0][1] = 1;
  eat.grid[0][2] = 1;
  eat.grid[0][3] = 1;
  eat.grid[1][1] = GARB;
  eat.grid[1][4] = GARB;
  assert(eat.beginClear(), 'Le groupe de 4 démarre son explosion');
  const cleared = eat.resolveClear();
  equal(cleared.removed, 5, 'Le groupe + le gris orthogonal sont supprimés');
  equal(cleared.garbageEaten, 1, 'Un seul gris est mangé');
  equal(eat.grid[3][4], GARB, 'Le gris non voisin survit et glisse en bas par gravité');

  // Mouvements de tassement : ordre et distances exacts.
  const gm = emptyGrid(4, 3);
  gm[0][1] = 3;
  gm[2][1] = 4;
  const moves = computeGravityMoves(gm);
  equal(moves.length, 2, 'Deux cellules chutent dans la colonne 1');
  equal(moves[0].c + ',' + moves[0].from + ',' + moves[0].to, '1,2,3', 'Le bas arrive en premier');
  equal(moves[1].c + ',' + moves[1].from + ',' + moves[1].to, '1,0,2', 'Le haut suit');
  equal(computeGravityMoves(emptyGrid(3, 3)).length, 0, 'Aucun mouvement sur grille vide');

  // Transition de chute : resolveClear arme l'animation au lieu de téléporter.
  const fall = new ColumnBoard(4, 3);
  fall.grid[1][0] = 2;
  fall.grid[1][1] = 2;
  fall.grid[1][2] = 2;
  fall.grid[2][2] = 2;
  fall.grid[0][1] = 5;
  assert(fall.beginClear(), 'Le groupe de 4 démarre');
  const fell = fall.resolveClear();
  equal(fell.removed, 4, 'Le groupe est supprimé');
  equal(fell.fell, 3, 'La plus grande chute fait 3 cases');
  assert(fall.fallAnim !== null, 'Une animation de chute est armée');
  assert(fall.busy, 'Le puits est occupé pendant la chute');
  equal(fall.grid[3][1], 5, 'La logique pose déjà l’état final');
  const landed = fall.fallAnim.moves.some((m) => m.c === 1 && m.from === 0 && m.to === 3);
  assert(landed, 'Le blob du haut atterrit en bas de la colonne 1');
  fall.fallAnim = null; // fin de la chute
  assert(!fall.busy, 'Le puits est libre après la chute');
  equal(fall.beginClear(), false, 'Aucune chaîne ici');

  // Chaîne après chute : le groupe de 2 libère un groupe de 1 en bas.
  const chain = new ColumnBoard(5, 4);
  chain.grid[1] = [2, 2, 2, 2];
  chain.grid[2] = [1, 1, 0, 0];
  chain.grid[3] = [1, 0, 0, 0];
  chain.grid[4] = [0, 1, 1, 0];
  assert(chain.beginClear(), 'Premier groupe détecté');
  chain.resolveClear();
  chain.fallAnim = null; // la chute se termine
  assert(chain.beginClear(), 'La chute forme un second groupe : chaîne');
  equal(chain.clearAnim?.cells.length, 5, 'La chaîne porte sur 5 cellules');
  chain.resolveClear();
  chain.fallAnim = null;
  equal(chain.beginClear(), false, 'Fin de la chaîne');
  equal(chain.cleared, 9, 'Les deux vagues totalisent 9 blobs');
  equal(chain.level, 1, '9 blobs ne changent pas encore de niveau');

  // Seuil de niveau : 12 blobs éclatés = niveau 2.
  const level = new ColumnBoard(4, 6);
  level.grid[2] = [1, 1, 1, 1, 1, 1];
  level.grid[3] = [2, 2, 2, 2, 2, 2];
  assert(level.beginClear(), 'Double ligne détectée');
  level.resolveClear();
  equal(level.cleared, 12, '12 blobs éclatés');
  equal(level.level, 2, 'Le niveau passe à 2');

  // Ordures pendant la chute : mises en attente, grille intacte.
  const busy = new ColumnBoard(6, 6);
  assert(busy.trySpawn([1, 2, 3], [1, 1, 1]), 'Spawn pour l’attente d’ordures');
  assert(busy.inject(2, () => 0), 'L’injection en chute est acceptée');
  equal(busy.pending, 2, 'Les 2 gris sont en attente');
  equal(busy.grid[5][0], 0, 'La grille n’est pas modifiée pendant la chute');

  // Injection qui déborde : mort.
  const overflow = new ColumnBoard(4, 3);
  overflow.grid[0][1] = 5;
  equal(overflow.inject(1, () => 1), false, 'L’injection qui déborde échoue');
  assert(overflow.dead, 'Le débordement par ordures tue le puits');

  // Barèmes exacts et plafond d’attaque.
  equal(scoreForClear(3, 1, 1), 30, 'Un trio de base vaut 30');
  equal(scoreForClear(5, 1, 1), 90, 'Un groupe de 5 vaut 90 au niveau 1');
  assert(scoreForClear(3, 1, 5) > scoreForClear(3, 1, 1), 'Le niveau booste le score');
  equal(garbageForClear(9, 5), 6, 'L’attaque est plafonnée à 6');
  equal(clearTier(0), 'base', 'Sous le seuil : palier de base');
  equal(clearTier(4), 'base', '4 liés : palier de base');
  equal(clearTier(5), 'super', '5 liés : SUPER');
  equal(clearTier(6), 'super', '6 liés : SUPER');
  equal(clearTier(7), 'mega', '7 liés : MÉGA');
  equal(clearTier(9), 'mega', '9 liés : MÉGA');
  equal(clearTier(10), 'ultra', '10 liés : ULTRA');
  equal(clearTier(25), 'ultra', '25 liés : ULTRA');
  equal(stackHeight(emptyGrid(3, 3)), 0, 'La hauteur d’une grille vide est 0');
  const tall = emptyGrid(4, 3);
  tall[1][0] = 2;
  equal(stackHeight(tall), 3, 'La hauteur compte depuis le plus haut blob');
}

// Situations limites de BLOB POP : voisinage hexagonal, groupes, grappes,
// plafond, collage, attaques.
function testBubble(): void {
  const layout = (overrides: Partial<BubbleLayout> = {}): BubbleLayout => ({
    ox: 100, oy: 50, R: 20, cols: 6, rows: 8,
    lx: 80, rx: 320, cx: 200, shooterY: 400, lineY: 0, ceilY: 0,
    ...overrides,
  });
  const L = layout();

  // Voisinage : coins, bords, parités.
  equal(hexNeighbors(0, 0, 6, 8).length, 2, 'Le coin (0,0) a 2 voisins');
  equal(hexNeighbors(2, 2, 6, 8).length, 6, 'Le centre pair a 6 voisins');
  equal(hexNeighbors(1, 0, 6, 8).length, 5, 'Le bord impair (1,0) a 5 voisins');
  const oddNeighbors = hexNeighbors(1, 1, 6, 8).map((n) => n.r + ',' + n.c).sort().join('|');
  equal(oddNeighbors, '0,1|0,2|1,0|1,2|2,1|2,2', 'La parité impaire décale à droite');

  // Aller-retour pixel ↔ cellule, lignes paires et impaires.
  for (const [r, c] of [[0, 0], [1, 2], [2, 5], [3, 0], [4, 4]] as Array<[number, number]>) {
    const p = bcellCenter(L, r, c);
    const back = bpixelToCell(L, p.x, p.y);
    equal(back.r + ',' + back.c, r + ',' + c, `La cellule (${r},${c}) survit à l’aller-retour`);
  }

  // Connexité hexagonale : trio horizontal + coude impair.
  const elbow = bemptyGrid(8, 6);
  elbow[2][2] = 3;
  elbow[3][2] = 3;
  elbow[3][3] = 3; // ligne impaire : E de (3,2), au-dessus de (2,2)
  equal(floodGroup(elbow, 2, 2).length, 3, 'Le coude hexagonal est connexe');

  // Faux diagonaux : (0,0) et (1,1) ne se touchent pas en odd-r.
  const diag = bemptyGrid(8, 6);
  diag[0][0] = 1;
  diag[1][1] = 1;
  equal(floodGroup(diag, 0, 0).length, 1, 'La fausse diagonale ne connecte pas');

  // Groupes : paire ignorée, deux trios trouvés, gris exclus.
  const groups = bemptyGrid(8, 6);
  groups[0][0] = 1;
  groups[0][1] = 1; // paire : ignorée
  groups[2][0] = 2;
  groups[2][1] = 2;
  groups[2][2] = 2;
  groups[4][3] = 4;
  groups[4][4] = 4;
  groups[4][5] = 4;
  groups[6][0] = BGARB;
  groups[6][1] = BGARB;
  groups[6][2] = BGARB;
  const found = findPopGroups(groups);
  equal(found.length, 2, 'Deux trios de couleurs, zéro trio gris');
  equal(found.reduce((n, g) => n + g.length, 0), 6, 'Les deux trios totalisent 6 bulles');

  // Ordures adjacentes mangées, lointaines épargnées.
  const eat = bemptyGrid(8, 6);
  eat[2][1] = 1;
  eat[2][2] = 1;
  eat[2][3] = 1;
  eat[2][4] = BGARB; // E de (2,3) : mangé
  eat[4][5] = BGARB; // loin : survit
  const eaten = adjacentGarbage(eat, [{ r: 2, c: 1 }, { r: 2, c: 2 }, { r: 2, c: 3 }]);
  equal(eaten.length, 1, 'Un seul gris adjacent est mangé');
  equal(eaten[0].r + ',' + eaten[0].c, '2,4', 'C’est le gris collé au trio');

  // Grappes : îlot détaché tombe, colonne au plafond reste.
  const hang = bemptyGrid(8, 6);
  hang[0][0] = 1;
  hang[1][0] = 2;
  hang[2][0] = 2;
  hang[5][3] = 4;
  hang[5][4] = 4;
  const floaters = findFloaters(hang);
  equal(floaters.length, 2, 'L’îlot de 2 bulles est détecté');
  assert(floaters.every((cell) => cell.r === 5), 'L’îlot est bien en ligne 5');

  // Résolution complète : pop + gris voisin + chute de l’îlot.
  const full = bemptyGrid(8, 6);
  full[2][1] = 1;
  full[2][2] = 1;
  full[2][3] = 1;
  full[2][4] = BGARB;
  full[5][3] = 4;
  full[5][4] = 4;
  const result = resolveGrid(full);
  equal(result.popped.length, 3, 'Le trio éclate');
  equal(result.garbage.length, 1, 'Le gris voisin est emporté');
  equal(result.dropped.length, 2, 'L’îlot décroché tombe');
  equal(result.popped[0].v, 1, 'La couleur éclatée est conservée pour les effets');
  assert(full[2][1] === 0 && full[2][4] === 0 && full[5][3] === 0, 'La grille est vidée aux bons endroits');

  // Sans pop, l’îlot reste (aucune résolution ne le décroche seul).
  const calm = bemptyGrid(8, 6);
  calm[0][0] = 1;
  calm[5][5] = 2;
  equal(findPopGroups(calm).length, 0, 'Aucun groupe : rien n’éclate');
  equal(findFloaters(calm).length, 1, 'L’îlot isolé reste une grappe flottante');

  // Plafond : insertion en haut, perte en bas.
  const push = bemptyGrid(4, 3);
  push[0] = [1, 2, 3];
  push[3] = [7, 7, 7];
  pushRow(push, [4, 5, 6]);
  equal(push[0].join(','), '4,5,6', 'La nouvelle ligne arrive au plafond');
  equal(push[1].join(','), '1,2,3', 'L’ancienne ligne 0 descend');
  equal(push[3].join(','), '0,0,0', 'L’ancienne ligne du bas est perdue');

  // Ligne de mort.
  const danger = bemptyGrid(8, 6);
  danger[5][0] = 1;
  equal(crossesLine(danger, 6), false, 'Sous la limite : pas de mort');
  danger[6][0] = 2;
  equal(crossesLine(danger, 6), true, 'Sur la limite : mort');

  // Collage : le trou unique est trouvé, grille pleine = null.
  const hole = bemptyGrid(3, 3);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) hole[r][c] = 1;
  hole[1][1] = 0;
  const p = bcellCenter(layout({ cols: 3, rows: 3 }), 1, 1);
  const snap = nearestEmptyCell(hole, layout({ cols: 3, rows: 3 }), p.x + 2, p.y - 3);
  equal(snap?.r + ',' + snap?.c, '1,1', 'Le collage trouve le trou unique');
  hole[1][1] = 2;
  equal(nearestEmptyCell(hole, layout({ cols: 3, rows: 3 }), p.x, p.y), null, 'La grille pleine ne colle nulle part');

  // Attaques : barème exact et plafond.
  equal(attackForShots(3, 0), 0, 'Un trio simple n’attaque pas');
  equal(attackForShots(4, 0), 1, 'Un groupe de 4 envoie 1 ligne');
  equal(attackForShots(7, 0), 2, 'Un groupe de 7 envoie 2 lignes');
  equal(attackForShots(9, 9), 2, 'L’attaque est plafonnée à 2 lignes');
  equal(attackForShots(0, 3), 1, '3 bulles tombées envoient 1 ligne');
  equal(attackForShots(0, 2), 0, '2 bulles tombées n’attaquent pas');

  // Scores exacts.
  equal(scoreForShot(3, 0, 0, 1), 30, 'Un trio vaut 30');
  equal(scoreForShot(5, 0, 0, 1), 80, 'Un groupe de 5 vaut 80');
  equal(scoreForShot(0, 2, 0, 1), 40, 'Deux chutes valent 40');

  // Tirages : jamais de couleur absente, motif initial sain.
  const rng = new SeededRng(42);
  const sparse = bemptyGrid(8, 6);
  sparse[0][0] = 2;
  sparse[1][1] = 4;
  for (let i = 0; i < 30; i++) {
    const v = pickBubbleColor(rng, sparse, 5);
    assert(v === 2 || v === 4, 'La bulle chargée existe sur le plateau');
  }
  const pattern = makePattern(new SeededRng(7), 4, 6, 3);
  equal(findPopGroups(pattern).length, 0, 'Le motif initial ne contient aucun groupe');
  assert(pattern[3][0] !== 0 && pattern[4][0] === 0, 'Le motif occupe exactement 4 lignes');
  equal(colorCountForPopLevel(1), 3, 'Niveau 1 : 3 couleurs');
  equal(colorCountForPopLevel(3), 4, 'Niveau 3 : 4 couleurs');
  equal(colorCountForPopLevel(5), 5, 'Niveau 5 : 5 couleurs');
  equal(patternRowsForLevel(1), 4, 'Niveau 1 : 4 lignes');
  equal(patternRowsForLevel(7), 6, 'Le motif est plafonné à 6 lignes');
  const grayRow = randomRowColors(new SeededRng(3), 6, 3, 1);
  assert(grayRow.every((v) => v === BGARB), 'Probabilité 1 : ligne 100 % grise');
  const cleanRow = randomRowColors(new SeededRng(3), 6, 3, 0);
  assert(cleanRow.every((v) => v >= 1 && v <= 3), 'Probabilité 0 : que des couleurs');
  const present = distinctColors(sparse);
  equal(present.join(','), '2,4', 'distinctColors ignore le vide');
  sparse[2][2] = BGARB;
  equal(distinctColors(sparse).join(','), '2,4', 'distinctColors ignore les gris');
}

// Verrous "un coup par appui" et regards des blobs (Dr Blob).
function testLatchAndGaze(): void {
  // Le verrou ne tire qu'une fois par appui complet.
  const latch = new ReleaseLatch();
  assert(latch.isArmed, 'Le verrou démarre armé');
  equal(latch.fire(false, false), false, 'Sans touche : rien');
  equal(latch.fire(true, true), true, 'Le premier appui tire');
  equal(latch.fire(true, false), false, 'Maintenu sans front : rien');
  equal(latch.fire(true, true), false, 'Maintenu avec front répété : toujours rien');
  equal(latch.fire(false, false), false, 'La remontée réarme silencieusement');
  assert(latch.isArmed, 'Le verrou est réarmé après remontée');
  equal(latch.fire(true, true), true, 'Le nouvel appui tire');
  equal(latch.fire(false, true), false, 'Front sans appui : rien');

  // Regards liés : paire horizontale mutuelle, strictement sur les côtés.
  const pair = emptyGrid(4, 4);
  pair[1][1] = 1;
  pair[1][2] = 1;
  const gazes = computeGaze(pair);
  equal(gazes.get(1 * 4 + 1)?.x, 1, 'Le gauche regarde à droite');
  equal(gazes.get(1 * 4 + 1)?.y, 0, '... strictement horizontal');
  equal(gazes.get(1 * 4 + 2)?.x, -1, 'Le droit regarde à gauche');
  equal(gazes.get(1 * 4 + 2)?.y, 0, '... strictement horizontal');

  // Centre en L : moyenne normalisée des deux voisins.
  const ell = emptyGrid(4, 4);
  ell[1][1] = 2;
  ell[1][2] = 2;
  ell[2][1] = 2;
  const center = computeGaze(ell).get(1 * 4 + 1);
  assert(center, 'Le centre du L a un regard');
  close(center.x, Math.SQRT1_2, 'Le regard penche à droite', 1e-9);
  close(center.y, Math.SQRT1_2, 'Le regard penche en bas', 1e-9);

  // Milieu de trio : voisins équilibrés → regard neutre (absent).
  const trio = emptyGrid(4, 6);
  trio[2][0] = 1;
  trio[2][1] = 1;
  trio[2][2] = 1;
  const trioGaze = computeGaze(trio);
  assert(!trioGaze.has(2 * 6 + 1), 'Le milieu équilibré regarde droit devant');
  equal(trioGaze.get(2 * 6 + 0)?.x, 1, 'Le bout gauche regarde le groupe');

  // Presque liés : trio + partenaire à 2 cases → œillade mutuelle.
  const almost = emptyGrid(4, 6);
  almost[0][0] = 3;
  almost[0][1] = 3;
  almost[0][2] = 3;
  almost[0][4] = 3;
  const ga = computeGaze(almost);
  for (const c of [0, 1, 2]) {
    equal(ga.get(c)?.x, 1, `Le membre ${c} vise le partenaire (x)`);
    equal(ga.get(c)?.y, 0, `Le membre ${c} vise le partenaire (y)`);
  }
  equal(ga.get(4)?.x, -1, 'Le partenaire vise le groupe (x)');
  equal(ga.get(4)?.y, 0, 'Le partenaire vise le groupe (y)');

  // Gris boudent : absents de la carte des regards.
  const grumpy = emptyGrid(4, 4);
  grumpy[0][0] = GARB;
  grumpy[0][1] = 1;
  grumpy[1][1] = 1;
  const gg = computeGaze(grumpy);
  assert(!gg.has(0), 'Le gris ne regarde personne');
  equal(gg.get(1)?.y, 1, 'Le voisin du dessous est regardé');

  // Pièce qui arrive : la case posée neutre se tourne vers elle.
  const incoming = emptyGrid(6, 6);
  incoming[5][2] = 1;
  const gi = computeGaze(incoming, { c: 2, r: 2, colors: [4, 4, 1] });
  equal(gi.get(5 * 6 + 2)?.x, 0, 'La posée vise la pièce (x)');
  equal(gi.get(5 * 6 + 2)?.y, -1, 'La posée vise la pièce qui arrive par le haut');

  // Cases de la pièce : entre elles et vers le puits.
  const slots = slotGaze(incoming, { c: 2, r: 2, colors: [4, 4, 1] });
  equal(slots[0].x, 0, 'Case 0 : pas de voisin latéral');
  equal(slots[0].y, 1, 'Case 0 : regarde sa jumelle en dessous');
  equal(slots[1].y, -1, 'Case 1 : regarde sa jumelle au-dessus');
  equal(slots[2].x, 0, 'Case 2 : centrée (x)');
  equal(slots[2].y, 1, 'Case 2 : regarde la posée en dessous');
  const uni = slotGaze(emptyGrid(4, 4), { c: 0, r: 0, colors: [2, 2, 2] });
  equal(uni[0].y, 1, 'Trio uniforme : le haut regarde vers le bas');
  equal(uni[2].y, -1, 'Trio uniforme : le bas regarde vers le haut');
  equal(uni[1].x, 0, 'Trio uniforme : le milieu est neutre (x)');
  equal(uni[1].y, 0, 'Trio uniforme : le milieu est neutre (y)');

  // Glissé de permutation : extrêmes exacts et mi-course.
  equal(cycleSlide(1, 0, 0), 2, 'dir=1 : le haut part de 2 cases plus bas');
  equal(cycleSlide(1, 0, 1), 0, 'dir=1 : le haut arrive à sa case');
  equal(cycleSlide(1, 1, 0), -1, 'dir=1 : le milieu glisse vers le haut');
  equal(cycleSlide(1, 2, 0), -1, 'dir=1 : le bas glisse vers le haut');
  equal(cycleSlide(-1, 2, 0), -2, 'dir=-1 : le bas part de 2 cases plus haut');
  equal(cycleSlide(-1, 0, 0), 1, 'dir=-1 : le haut glisse vers le bas');
  equal(cycleSlide(-1, 2, 1), 0, 'dir=-1 : le bas arrive à sa case');
  close(cycleSlide(1, 0, 0.5), 0.5, 'Mi-course : quart du trajet restant', 1e-9);
}

const tests: readonly [string, Test][] = [
  ['FixedClock', testClock],
  ['SeededRng', testRng],
  ['Replay', testReplay],
  ['InputManager', testInput],
  ['Simon : contrôles', testSimonControls],
  ['ObjectPool + SpatialHash', testPoolAndHash],
  ['Collisions + PhysicsWorld', testCollisionsAndPhysics],
  ['GridSystem + Scroller + PhaseMachine', testSystems],
  ['DevTools', testDevTools],
  ['Dr Blob (Columns)', testColumns],
  ['Dr Blob : situations', testColumnsScenarios],
  ['Dr Blob : verrous & regards', testLatchAndGaze],
  ['Blob Pop (Bubble)', testBubble],
];

for (const [name, test] of tests) {
  await test();
  console.log(`✓ ${name}`);
}

console.log(`\n${tests.length} groupes de tests moteur passés.`);
