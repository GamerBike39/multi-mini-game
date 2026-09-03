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
import { AchievementSystem, buildAchievementCatalog } from '../js/core/achievements';
import { arpOffsetAt, brassOffsetAt, dottedEighth, fillDrumsAt, isBreakBar, leadOffsetAt, progressionRoot, swingOffsetAt, voxStepAt } from '../js/core/music/mood-utils';
import { MOODS } from '../js/core/audio';
import { RhythmGame } from '../js/games/rhythm';
import { SurvivalGame } from '../js/games/survival';
import { ShooterGame } from '../js/games/shooter';
import { RunnerGame } from '../js/games/runner';
import { CaveGame } from '../js/games/cave';
import { SimonGame } from '../js/games/simon';
import { SnakeGame } from '../js/games/snake';
import { BreakerGame } from '../js/games/breaker';
import { GolfGame } from '../js/games/golf';
import { FishingGame } from '../js/games/fish';
import { PongGame } from '../js/games/pong';
import { ColumnsGame } from '../js/games/columns';
import { BubbleGame } from '../js/games/bubble';
import { SortGame } from '../js/games/sort';
import { PathGame } from '../js/games/path';
import { DigGame } from '../js/games/dig';
import {
  CYCLE_ENERGY_COST,
  CYCLE_H,
  CYCLE_W,
  CycleGame,
  cycleCanTurn,
  cycleDirVec,
  cycleWantDir,
  pointSegDist,
} from '../js/games/cycle';
import { ACTIONS, type AudioLike, type EngineLike, type InputLike, type ReplayPlayerFrame } from '../js/core/types';
import { simonPadPressed } from '../js/games/simon';
import { sortChoiceCorrect, sortDifficulty, sortDirectionPressed } from '../js/games/sort';
import { createMemoryPath, isOrthogonalPath, nextPathVisualMode, pathDirectionPressed } from '../js/games/path';
import { golfAngleDelta, golfShotSpeed, resolveGolfWall } from '../js/games/golf';
import {
  FROG_CELL,
  FROG_COLS,
  FROG_HOME_COLS,
  FrogGame,
  frogCellCenterX,
  frogCellCenterY,
  frogHomeIndex,
  frogIsHomeCol,
  frogLevelMult,
  frogLevelTime,
  frogOverlaps,
} from '../js/games/frog';
import {
  FLAPPY_FLAP,
  FLAPPY_FLAP_VY,
  FLAPPY_GAP_0,
  FLAPPY_GAP_MIN,
  FLAPPY_PIPE_W,
  FLAPPY_R,
  FLAPPY_SPEED_0,
  FLAPPY_SPEED_MAX,
  FlappyGame,
  flappyCentered,
  flappyGapFor,
  flappyHitsPipe,
  flappySpeedFor,
} from '../js/games/flappy';
import {
  DIG_COLS,
  DIG_O2_ROW,
  Dig,
  digCarveRoom,
  digDepthBand,
  digGenRow,
  digGravityStep,
  digIsFallable,
  digIsOxygenZone,
  digIsSolid,
  digOxygenDrain,
  digPlanRooms,
  digVeinGap,
} from '../js/games/dig';
import {
  RUNNER_JUMP,
  advanceJumpAir,
  applyJumpCut,
  armCoyote,
  createJumpState,
  decayJumpTimers,
  jumpGravity,
  landJump,
  launchJump,
  pressJumpButton,
  releaseJump,
  resetJumpAir,
  riseGravity,
  tryLaunch,
} from '../js/core/jump';
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

function testSortGame(): void {
  const input = (actions: string[]) => ({ pressed: (action: string) => actions.includes(action) });
  equal(sortDirectionPressed(input(['left'])), 'left', 'Blob Tri : lit une direction');
  equal(sortDirectionPressed(input([])), null, 'Blob Tri : aucune direction reste neutre');

  equal(sortDifficulty(0).colorCount, 2, 'Blob Tri commence avec deux couleurs');
  equal(sortDifficulty(23).colorCount, 2, 'Blob Tri conserve deux couleurs sur les deux premiers paliers');
  equal(sortDifficulty(24).colorCount, 3, 'Blob Tri débloque la troisième couleur');
  equal(sortDifficulty(47).colorCount, 3, 'Blob Tri laisse vingt-quatre blobs au palier trois couleurs');
  equal(sortDifficulty(48).colorCount, 4, 'Blob Tri débloque la quatrième couleur pour le dernier tiers');
  assert(sortDifficulty(71).decisionTime < sortDifficulty(0).decisionTime, 'Blob Tri accélère avec le stock');

  equal(sortChoiceCorrect({ intruder: false, colorIndex: 0 }, 'up'), true, 'Blob Tri : jaune vers le haut');
  equal(sortChoiceCorrect({ intruder: false, colorIndex: 1 }, 'right'), false, 'Blob Tri : mauvais garage refusé');
  equal(sortChoiceCorrect({ intruder: true, colorIndex: 0 }, 'eject'), true, 'Blob Tri : intrus éjecté');
  equal(sortChoiceCorrect({ intruder: false, colorIndex: 0 }, 'eject'), false, 'Blob Tri : blob valide non éjectable');
}

function testPathGame(): void {
  const input = (actions: string[]) => ({ pressed: (action: string) => actions.includes(action) });
  equal(pathDirectionPressed(input(['down'])), 'down', 'Blob Trace : lit une direction');
  equal(pathDirectionPressed(input([])), null, 'Blob Trace : aucune direction reste neutre');
  equal(nextPathVisualMode('line'), 'tiles', 'Blob Trace : la trace bascule vers les cases');
  equal(nextPathVisualMode('tiles'), 'line', 'Blob Trace : les cases rebascule vers la trace difficile');

  for (let size = 4; size <= 9; size++) {
    const path = createMemoryPath(size, size - 3, new SeededRng(0x7000 + size));
    assert(isOrthogonalPath(path), `Blob Trace : chemin ${size}×${size} orthogonal et sans boucle`);
    equal(path[0].x, 0, `Blob Trace ${size}×${size} : départ à gauche`);
    equal(path[0].y, size - 1, `Blob Trace ${size}×${size} : départ en bas`);
    equal(path[path.length - 1].x, size - 1, `Blob Trace ${size}×${size} : arrivée à droite`);
    equal(path[path.length - 1].y, 0, `Blob Trace ${size}×${size} : arrivée en haut`);
    assert(path.length >= size * 2 - 1, `Blob Trace ${size}×${size} : longueur minimale respectée`);
  }
  equal(isOrthogonalPath([{ x: 0, y: 0 }, { x: 1, y: 1 }]), false, 'Blob Trace refuse les diagonales');
  equal(isOrthogonalPath([{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }]), false, 'Blob Trace refuse les boucles');
}

function testGolfFeel(): void {
  equal(golfShotSpeed(-1), golfShotSpeed(0), 'Golf : puissance bornée en bas');
  equal(golfShotSpeed(2), golfShotSpeed(1), 'Golf : puissance bornée en haut');
  assert(golfShotSpeed(0) < 200, 'Golf : un tap permet désormais un vrai petit coup');
  assert(golfShotSpeed(0.5) > golfShotSpeed(0.25), 'Golf : puissance strictement progressive');
  assert(golfShotSpeed(1) >= 880, 'Golf : pleine puissance conserve une grande portée');
  close(golfAngleDelta(Math.PI - 0.1, -Math.PI + 0.1), 0.2, 'Golf : visée prend le chemin angulaire le plus court');

  const ball = { x: 96, y: 50, vx: 120, vy: 0, r: 10 };
  const hit = resolveGolfWall(ball, { x: 100, y: 0, w: 20, h: 100 });
  assert(!!hit && hit.imp > 0, 'Golf : collision détectée sur le bloc');
  assert(ball.vx < 0, 'Golf : la collision réfléchit la vitesse');
  assert(ball.x <= 90, 'Golf : la balle est repoussée hors du bloc');
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

function testFrog(): void {
  equal(FROG_COLS, 15, 'Frogger : 15 colonnes');
  equal(FROG_HOME_COLS.length, 5, 'Frogger : 5 alcôves');
  assert(frogIsHomeCol(1), 'Frogger : la colonne 1 est une alcôve');
  assert(frogIsHomeCol(13), 'Frogger : la colonne 13 est une alcôve');
  assert(!frogIsHomeCol(0), 'Frogger : la colonne 0 est de l’eau');
  assert(!frogIsHomeCol(2), 'Frogger : la colonne 2 est de l’eau');
  equal(frogHomeIndex(7), 2, 'Frogger : la colonne 7 est l’alcôve centrale');
  equal(frogHomeIndex(3), -1, 'Frogger : la colonne 3 n’est pas une alcôve');

  equal(frogLevelMult(1), 1, 'Frogger : niveau 1 sans accélération');
  assert(frogLevelMult(2) > 1, 'Frogger : le niveau 2 accélère');
  assert(frogLevelMult(5) > frogLevelMult(2), 'Frogger : la vitesse croît avec le niveau');
  assert(frogLevelMult(99) <= 2.2, 'Frogger : la vitesse est plafonnée');

  equal(frogLevelTime(1), 60, 'Frogger : 60 s au niveau 1');
  assert(frogLevelTime(3) < 60, 'Frogger : le timer se resserre');
  assert(frogLevelTime(99) >= 30, 'Frogger : le timer garde un plancher');

  assert(frogOverlaps(0, 2, 1, 2), 'Frogger : chevauchement détecté');
  assert(!frogOverlaps(0, 1, 1, 1), 'Frogger : contact bord à bord ignoré');
  assert(!frogOverlaps(0, 1, 5, 1), 'Frogger : les plateformes éloignées sont écartées');

  // Non-régression : un saut = exactement une case (grille régulière).
  equal(frogCellCenterX(6) - frogCellCenterX(5), FROG_CELL, 'Frogger : pas horizontal = 1 case');
  equal(frogCellCenterY(7) - frogCellCenterY(6), FROG_CELL, 'Frogger : pas vertical = 1 case');
}

function testFlappy(): void {
  equal(flappyGapFor(0), FLAPPY_GAP_0, 'Flappy : ouverture de départ');
  assert(flappyGapFor(10) < FLAPPY_GAP_0, 'Flappy : l’ouverture se resserre');
  equal(flappyGapFor(1000), FLAPPY_GAP_MIN, 'Flappy : l’ouverture garde un plancher');

  equal(flappySpeedFor(0), FLAPPY_SPEED_0, 'Flappy : vitesse de départ');
  assert(flappySpeedFor(10) > FLAPPY_SPEED_0, 'Flappy : la vitesse augmente');
  equal(flappySpeedFor(1000), FLAPPY_SPEED_MAX, 'Flappy : la vitesse est plafonnée');

  assert(flappyCentered(360, 360, 200), 'Flappy : le centre = passe parfaite');
  assert(flappyCentered(360 + 200 / 6, 360, 200), 'Flappy : le bord du tiers médian compte');
  assert(!flappyCentered(360 + 200 / 6 + 1, 360, 200), 'Flappy : hors tiers médian = passe simple');

  // Arche en x=400 (largeur 96), ouverture 260..460.
  const pipe = { x: 400, gapY: 360, gapH: 200, passed: false };
  assert(!flappyHitsPipe(448, 360, FLAPPY_R, pipe), 'Flappy : dans l’ouverture, pas de contact');
  assert(!flappyHitsPipe(100, 100, FLAPPY_R, pipe), 'Flappy : loin de l’arche, pas de contact');
  assert(flappyHitsPipe(448, 250, FLAPPY_R, pipe), 'Flappy : la mâchoire haute tue');
  assert(flappyHitsPipe(448, 470, FLAPPY_R, pipe), 'Flappy : la mâchoire basse tue');
  assert(!flappyHitsPipe(400 - FLAPPY_PIPE_W, 100, FLAPPY_R, pipe), 'Flappy : le bord gauche exact pardonne');
}

function testFlappyInput(): void {
  // Un appui = un battement : flap() écrase la vitesse (pas d’accumulation),
  // donc même un double front ne ferait pas monter deux fois plus haut.
  const noop = (): void => undefined;
  const audio = new Proxy({}, { get: () => noop }) as unknown as AudioLike;
  const hub = {
    moveX: 0, moveY: 0, aimX: 0, aimY: 0,
    padConnected: false, vibration: false, taps: [],
    gesture: noop, setBlocked: noop, clearEdges: noop, absorb: noop, rumble: noop,
    down: (): boolean => false,
    pressed: (): boolean => false,
    released: (): boolean => false,
    key: (): boolean => false, keyPressed: (): boolean => false,
    player: () => hub,
  } as unknown as InputLike;
  const engine = {
    input: hub, audio,
    settings: { active: false },
    session: {
      id: 'test', gameId: 'flap', mode: 'solo', playerCount: 1,
      seed: 4321, buildVersion: 'test', replayMode: 'live',
    },
  } as unknown as EngineLike;

  const game = new FlappyGame(engine);
  assert(!game.started, 'Flappy : en attente avant le premier battement');
  game.flap();
  assert(game.started, 'Flappy : le premier battement démarre la partie');
  equal(game.vy, FLAPPY_FLAP_VY, 'Flappy : le battement fixe l’impulsion');
  game.vy = 500;
  game.flap();
  equal(game.vy, FLAPPY_FLAP_VY, 'Flappy : un second battement écrase, il n’additionne pas');
}

function testJump(): void {
  // Tuning historique du runner, verrouillé contre les régressions.
  equal(RUNNER_JUMP.jumpSpeed, 1080, 'Saut : impulsion du runner');
  equal(RUNNER_JUMP.holdGravity, 1700, 'Saut : gravité tenue du runner');
  equal(RUNNER_JUMP.riseGravity, 3150, 'Saut : gravité relâchée du runner');
  equal(RUNNER_JUMP.fallGravity, 3600, 'Saut : gravité de chute du runner');
  equal(RUNNER_JUMP.fastFallExtra, 4200, 'Saut : bonus de descente du runner');
  equal(RUNNER_JUMP.cutSpeed, 430, 'Saut : vitesse de coupe du runner');
  close(RUNNER_JUMP.minTime, 0.07, 'Saut : temps minimum du runner');
  close(RUNNER_JUMP.holdTime, 0.18, 'Saut : fenêtre de maintien du runner');
  close(RUNNER_JUMP.coyoteTime, 0.11, 'Saut : coyote time du runner');
  close(RUNNER_JUMP.bufferTime, 0.13, 'Saut : buffer du runner');
  equal(RUNNER_JUMP.maxJumps, 2, 'Saut : double saut du runner');

  // Décollage : rien sans appui, sol prioritaire, coyote = sol.
  const idle = createJumpState();
  equal(tryLaunch(idle, RUNNER_JUMP, true), null, 'Saut : rien sans appui');
  pressJumpButton(idle, RUNNER_JUMP);
  equal(tryLaunch(idle, RUNNER_JUMP, true), 'ground', 'Saut : appui + sol = décollage');
  equal(idle.jumps, 1, 'Saut : le décollage au sol consomme un saut');
  equal(idle.buffer, 0, 'Saut : l’appui est consommé au décollage');

  const spent = createJumpState();
  spent.jumps = 2;
  pressJumpButton(spent, RUNNER_JUMP);
  equal(tryLaunch(spent, RUNNER_JUMP, false), null, 'Saut : compteur épuisé = refusé');
  assert(spent.buffer > 0, 'Saut : l’appui refusé reste mémorisé');
  decayJumpTimers(spent, 1);
  equal(spent.buffer, 0, 'Saut : le buffer expire');

  const coy = createJumpState();
  armCoyote(coy, RUNNER_JUMP);
  pressJumpButton(coy, RUNNER_JUMP);
  equal(tryLaunch(coy, RUNNER_JUMP, false), 'ground', 'Saut : coyote = décollage au sol');
  equal(coy.jumps, 1, 'Saut : le coyote ne mange pas le double saut');

  // Double saut : sol, air, puis refusé.
  const dbl = createJumpState();
  pressJumpButton(dbl, RUNNER_JUMP);
  equal(tryLaunch(dbl, RUNNER_JUMP, true), 'ground', 'Saut : premier appui au sol');
  pressJumpButton(dbl, RUNNER_JUMP);
  equal(tryLaunch(dbl, RUNNER_JUMP, false), 'air', 'Saut : second appui en l’air');
  equal(dbl.jumps, 2, 'Saut : le double saut consomme le compteur');
  pressJumpButton(dbl, RUNNER_JUMP);
  equal(tryLaunch(dbl, RUNNER_JUMP, false), null, 'Saut : troisième appui refusé');

  // launchJump direct : le sol repart d’un compteur plein.
  const lj = createJumpState();
  lj.buffer = 0.05;
  lj.coyote = 0.05;
  launchJump(lj, false, 2);
  equal(lj.jumps, 1, 'Saut : launchJump au sol');
  equal(lj.buffer, 0, 'Saut : launchJump vide le buffer');
  launchJump(lj, true, 2);
  equal(lj.jumps, 2, 'Saut : launchJump en l’air');

  // Vol : minuteur, relâche, réarmement.
  const v = createJumpState();
  advanceJumpAir(v, 0.1);
  close(v.jumpT, 0.1, 'Saut : le temps de vol avance');
  releaseJump(v, true);
  assert(!v.released, 'Saut : tenu = pas relâché');
  releaseJump(v, false);
  assert(v.released, 'Saut : lâché = relâché');
  resetJumpAir(v);
  equal(v.jumpT, 0, 'Saut : resetJumpAir remet le minuteur');
  assert(!v.released, 'Saut : resetJumpAir réarme la relâche');

  // Coupe du tap : fenêtre [minTime, holdTime[, montée rapide, relâché.
  const c = createJumpState();
  c.released = true;
  c.jumpT = 0.1;
  equal(applyJumpCut(c, RUNNER_JUMP, -900), -430, 'Saut : le tap coupe la montée');
  c.jumpT = 0.01;
  equal(applyJumpCut(c, RUNNER_JUMP, -900), -900, 'Saut : pas de coupe avant le temps minimum');
  c.jumpT = 0.1;
  c.released = false;
  equal(applyJumpCut(c, RUNNER_JUMP, -900), -900, 'Saut : pas de coupe bouton tenu');
  c.released = true;
  equal(applyJumpCut(c, RUNNER_JUMP, -100), -100, 'Saut : pas de coupe en montée lente');
  c.jumpT = 0.5;
  equal(applyJumpCut(c, RUNNER_JUMP, -900), -900, 'Saut : pas de coupe hors fenêtre');

  // Gravité trois temps.
  const g = createJumpState();
  g.jumpT = 0.05;
  equal(jumpGravity(g, RUNNER_JUMP, -500, true, false), 1700, 'Saut : maintien = montée retenue');
  equal(jumpGravity(g, RUNNER_JUMP, -500, false, false), 3150, 'Saut : lâché = montée normale');
  g.released = true;
  equal(jumpGravity(g, RUNNER_JUMP, -500, true, false), 3150, 'Saut : relâché même tenu = montée normale');
  equal(jumpGravity(g, RUNNER_JUMP, 200, true, false), 3600, 'Saut : chute lourde');
  equal(jumpGravity(g, RUNNER_JUMP, 200, false, true), 7800, 'Saut : descente rapide B');
  g.jumpT = 0.5;
  equal(jumpGravity(g, RUNNER_JUMP, -500, true, false), 3150, 'Saut : hors fenêtre = montée normale');

  // Nuancier direct : tenu + jeune + non relâché = gravité tenue.
  equal(riseGravity(true, false, 0.05, 0.18, 1700, 3150), 1700, 'Saut : riseGravity tenue');
  equal(riseGravity(false, false, 0.05, 0.18, 1700, 3150), 3150, 'Saut : riseGravity lâchée');
  equal(riseGravity(true, true, 0.05, 0.18, 1700, 3150), 3150, 'Saut : riseGravity relâchée');
  equal(riseGravity(true, false, 0.3, 0.18, 1700, 3150), 3150, 'Saut : riseGravity hors fenêtre');

  // Atterrissage : compteur plein, appui mémorisé conservé.
  const l = createJumpState();
  l.jumps = 2;
  l.jumpT = 0.4;
  l.released = true;
  l.coyote = 0.05;
  l.buffer = 0.05;
  landJump(l);
  equal(l.jumps, 0, 'Saut : l’atterrissage rend les sauts');
  equal(l.jumpT, 0, 'Saut : l’atterrissage remet le minuteur');
  assert(!l.released, 'Saut : l’atterrissage réarme la relâche');
  equal(l.coyote, 0, 'Saut : l’atterrissage vide le coyote');
  equal(l.buffer, 0.05, 'Saut : l’atterrissage garde l’appui mémorisé');

  // Flappy : le nuancier est branché dans le bon sens (tap < maintien).
  assert(FLAPPY_FLAP.holdGravity < FLAPPY_FLAP.riseGravity, 'Flappy : le maintien retient la montée');
  assert(FLAPPY_FLAP.cutSpeed < -FLAPPY_FLAP_VY, 'Flappy : le tap coupe sous l’impulsion');
}

function testDig(): void {
  // Bandes de profondeur.
  equal(digDepthBand(0), 'surface', 'Dig : la surface commence en haut');
  equal(digDepthBand(2), 'surface', 'Dig : trois rangées de surface');
  equal(digDepthBand(3), 'shallow', 'Dig : peu profond ensuite');
  equal(digDepthBand(16), 'mid', 'Dig : palier intermédiaire');
  equal(digDepthBand(36), 'deep', 'Dig : les abysses en bas');
  equal(digDepthBand(1000), 'deep', 'Dig : le fond reste abyssal');

  // Oxygène : gratuit en haut, vital en bas.
  assert(!digIsOxygenZone(DIG_O2_ROW - 1), 'Dig : pas d’oxygène avant la zone');
  assert(digIsOxygenZone(DIG_O2_ROW), 'Dig : la zone oxygène commence à 25 m');
  equal(digOxygenDrain(0), 0, 'Dig : air gratuit en surface');
  equal(digOxygenDrain(DIG_O2_ROW - 1), 0, 'Dig : air gratuit juste au-dessus');
  assert(digOxygenDrain(DIG_O2_ROW) > 0, 'Dig : ça consomme dès l’entrée');
  assert(digOxygenDrain(60) > digOxygenDrain(DIG_O2_ROW), 'Dig : ça empire en profondeur');
  assert(digOxygenDrain(10000) <= 7, 'Dig : la conso est plafonnée');

  // Solidité : seul le vide laisse passer.
  assert(!digIsSolid(Dig.Empty), 'Dig : le vide n’est pas solide');
  for (const cell of [Dig.Dirt, Dig.Stone, Dig.Bedrock, Dig.Boulder, Dig.Diamond, Dig.Air]) {
    assert(digIsSolid(cell), 'Dig : la case ' + cell + ' porte');
  }
  assert(digIsFallable(Dig.Boulder), 'Dig : le rocher tombe');
  assert(digIsFallable(Dig.Diamond), 'Dig : le diamant tombe');
  assert(!digIsFallable(Dig.Dirt), 'Dig : la terre ne tombe pas');
  assert(!digIsFallable(Dig.Air), 'Dig : la bulle ne tombe pas');
}

function testDigGravity(): void {
  // Grille 3×5 : rocher en haut, diamant suspendu, vide, sol en terre.
  //   . O .      O = rocher, D = diamant, # = terre
  //   . . .
  //   . D .
  //   . . .
  //   # # #
  const cols = 3;
  const E = Dig.Empty;
  const grid = [
    E, Dig.Boulder, E,
    E, E, E,
    E, Dig.Diamond, E,
    E, E, E,
    Dig.Dirt, Dig.Dirt, Dig.Dirt,
  ];
  const falling = new Array<number>(15).fill(0);
  const res = digGravityStep(grid, falling, cols, -1);
  equal(res.moves.length, 2, 'Dig : le rocher et le diamant tombent');
  equal(res.crushed, false, 'Dig : personne dessous, pas d’écrasé');
  equal(grid[1 * cols + 1], Dig.Boulder, 'Dig : le rocher descend d’une case');
  equal(grid[0 * cols + 1], E, 'Dig : la case libérée est vide');
  equal(grid[3 * cols + 1], Dig.Diamond, 'Dig : le diamant descend d’une case');
  equal(falling[1 * cols + 1], 1, 'Dig : le rocher est marqué en chute');
  equal(falling[3 * cols + 1], 1, 'Dig : le diamant est marqué en chute');

  // Tick suivant : le diamant se pose, le rocher continue (un pas par tick).
  const res2 = digGravityStep(grid, falling, cols, -1);
  equal(res2.moves.length, 1, 'Dig : un seul mouvement par tick');
  equal(grid[2 * cols + 1], Dig.Boulder, 'Dig : le rocher continue sa chute');
  equal(grid[4 * cols + 1], Dig.Dirt, 'Dig : le sol porte toujours');
  equal(falling[3 * cols + 1], 0, 'Dig : le diamant posé n’est plus en chute');

  // Écrasé : rocher en chute + joueur dessous.
  const flat = [E, Dig.Boulder, E, E, E, E];
  const ff = [0, 1, 0, 0, 0, 0];
  const res3 = digGravityStep(flat, ff, cols, 1 * cols + 1);
  assert(res3.crushed, 'Dig : le rocher en chute écrase le joueur');
  equal(flat[1 * cols + 1], Dig.Boulder, 'Dig : le rocher occupe la case du joueur');

  // Retenu : rocher au repos + joueur dessous = ça tient.
  const hold = [E, Dig.Boulder, E, E, E, E];
  const hf = [0, 0, 0, 0, 0, 0];
  const res4 = digGravityStep(hold, hf, cols, 1 * cols + 1);
  assert(!res4.crushed, 'Dig : le rocher tenu par le joueur ne tombe pas');
  equal(res4.moves.length, 0, 'Dig : aucun mouvement quand le joueur retient');
  equal(hold[0 * cols + 1], Dig.Boulder, 'Dig : le rocher reste en place');
}

function testDigGen(): void {
  // Déterminisme : même seed -> mêmes rangées.
  const a = new SeededRng(99);
  const b = new SeededRng(99);
  for (const row of [0, 1, 2, 10, 25, 60]) {
    equal(digGenRow(a, row, DIG_COLS).join(','), digGenRow(b, row, DIG_COLS).join(','), 'Dig : rangée ' + row + ' déterministe');
  }
  // Surface : plafond bedrock, poche de départ vide.
  const top = digGenRow(new SeededRng(1), 0, DIG_COLS);
  assert(top.every((c) => c === Dig.Bedrock), 'Dig : plafond indestructible');
  const start = digGenRow(new SeededRng(1), 1, DIG_COLS);
  for (let c = 8; c <= 11; c++) equal(start[c], Dig.Empty, 'Dig : poche de départ en ' + c);
  // Cheminée sûre : pas de rocher sur la tête au départ.
  for (let r = 2; r <= 3; r++) {
    const row = digGenRow(new SeededRng(r), r, DIG_COLS);
    for (let c = 8; c <= 11; c++) equal(row[c], Dig.Dirt, 'Dig : cheminée sûre en ' + c + ',' + r);
  }
  // Veines : mur + passage obligé d'au moins 2 cases.
  const rng = new SeededRng(7);
  for (let k = 0; k < 10; k++) {
    const { gap, w } = digVeinGap(rng, DIG_COLS);
    assert(w >= 2, 'Dig : passage d’au moins 2 cases');
    assert(gap >= 1 && gap + w <= DIG_COLS - 1, 'Dig : passage dans les murs');
  }
  const vein = digGenRow(new SeededRng(5000), 22, DIG_COLS);
  const holes = vein.filter((c) => c !== Dig.Bedrock).length;
  assert(holes >= 2 && holes <= 3, 'Dig : la veine 22 laisse un passage (' + holes + ')');
  assert(vein.some((c) => c === Dig.Bedrock), 'Dig : la veine 22 bloque le reste');
  // Salles : bornées, dans le monde.
  const rooms = digPlanRooms(new SeededRng(3), DIG_COLS, 4);
  equal(rooms.length, 4, 'Dig : quatre salles planifiées');
  for (const room of rooms) {
    assert(room.x >= 1 && room.x + room.w <= DIG_COLS - 1, 'Dig : salle dans les murs');
    assert(room.y >= 16, 'Dig : salles en profondeur');
  }
  // Sculpture : coffre de pierre + diamants + piège au-dessus.
  const cells = new Array<number>(DIG_COLS).fill(Dig.Dirt);
  const room = { x: 4, y: 20, w: 6, h: 3 };
  digCarveRoom(cells, room, 20, DIG_COLS, new SeededRng(11));
  assert(cells[4] === Dig.Stone && cells[9] === Dig.Stone, 'Dig : coffre de pierre en haut');
  digCarveRoom(cells, room, 21, DIG_COLS, new SeededRng(11));
  assert(cells.slice(5, 9).every((c) => c === Dig.Empty || c === Dig.Diamond), 'Dig : intérieur creux');
  assert(cells.slice(5, 9).some((c) => c === Dig.Diamond), 'Dig : diamants tapis dedans');
}

function testFrogInput(): void {
  // Le moteur miroite les directions clavier/croix dans moveX/moveY
  // (composeRawStates) : un appui = front pressed() + stick la même frame.
  // Le jeu ne doit en tirer qu'un seul hop, pas deux cases.
  const noop = (): void => undefined;
  const audio = new Proxy({}, { get: () => noop }) as unknown as AudioLike;
  const pressedSet = new Set<string>();
  const downSet = new Set<string>();
  const hub = {
    moveX: 0, moveY: 0, aimX: 0, aimY: 0,
    padConnected: false, vibration: false, taps: [],
    gesture: noop, setBlocked: noop, clearEdges: noop, absorb: noop, rumble: noop,
    down: (a: string): boolean => downSet.has(a),
    pressed: (a: string): boolean => pressedSet.has(a),
    released: (): boolean => false,
    key: (): boolean => false, keyPressed: (): boolean => false,
    player: () => hub,
  } as unknown as InputLike;
  const engine = {
    input: hub, audio,
    settings: { active: false },
    session: {
      id: 'test', gameId: 'frog', mode: 'solo', playerCount: 1,
      seed: 1234, buildVersion: 'test', replayMode: 'live',
    },
  } as unknown as EngineLike;

  // Flèche haut : front + miroir moveY, comme en vrai.
  const up = new FrogGame(engine);
  pressedSet.add('up');
  downSet.add('up');
  (hub as { moveY: number }).moveY = -1;
  up.readInput(hub);
  assert(up.hop, 'Frogger : un appui démarre un hop');
  equal(up.buffered, null, 'Frogger : un appui ne met aucun hop en buffer (1 case, pas 2)');
  equal(up.hop?.tc, 7, 'Frogger : le hop va tout droit');
  equal(up.hop?.tr, 10, 'Frogger : le hop avance d’une seule rangée');

  // Frame suivante, touche maintenue sans nouveau front : toujours pas de double.
  pressedSet.clear();
  up.readInput(hub);
  equal(up.buffered, null, 'Frogger : le maintien n’empile pas de second hop immédiat');

  // Flèche gauche : même règle sur l’axe X.
  const left = new FrogGame(engine);
  pressedSet.add('left');
  downSet.clear();
  downSet.add('left');
  (hub as { moveX: number; moveY: number }).moveX = -1;
  (hub as { moveY: number }).moveY = 0;
  left.readInput(hub);
  assert(left.hop, 'Frogger : un appui horizontal démarre un hop');
  equal(left.buffered, null, 'Frogger : un appui horizontal = une seule colonne');
  equal(left.hop?.tc, 6, 'Frogger : le hop va d’une seule colonne');
  equal(left.hop?.tr, 11, 'Frogger : le hop horizontal ne change pas de rangée');

  // Stick analogique pur (pas de front) : un seul hop aussi.
  const stick = new FrogGame(engine);
  pressedSet.clear();
  downSet.clear();
  (hub as { moveX: number; moveY: number }).moveX = 0;
  (hub as { moveY: number }).moveY = -1;
  stick.readInput(hub);
  assert(stick.hop, 'Frogger : le stick démarre un hop');
  equal(stick.buffered, null, 'Frogger : le stick ne double pas le hop');
}

function memoryStorage(): { getItem(key: string): string | null; setItem(key: string, value: string): void; data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

function testAchievements(): void {
  // Compteur simple : 3 évènements requis.
  const storage = memoryStorage();
  const system = new AchievementSystem({ storage });
  system.register({ id: 'test.trio', name: 'Trio', desc: 'Trois fois', icon: '★', points: 5, event: 'custom:ping', count: 3 });
  equal(system.isUnlocked('test.trio'), false, 'Succès verrouillé au départ');
  system.emit('custom:ping');
  system.emit('custom:ping');
  equal(system.isUnlocked('test.trio'), false, 'Deux occurrences ne suffisent pas pour un compteur à 3');
  equal(system.progressOf('test.trio'), 2, 'La progression est comptée');
  const done = system.emit('custom:ping');
  equal(done.join(','), 'test.trio', 'La troisième occurrence débloque');
  assert(system.isUnlocked('test.trio'), 'Le succès est débloqué');
  system.emit('custom:ping');
  equal(system.progressOf('test.trio'), 3, 'La progression ne dépasse plus après déblocage');

  // Déblocage direct pour logiques complexes.
  system.register({ id: 'test.direct', name: 'Direct', desc: 'Manuel', icon: '◆', points: 10, event: 'never:fires' });
  assert(system.unlock('test.direct'), 'unlock() direct fonctionne');
  assert(!system.unlock('test.direct'), 'unlock() répété ne re-notifie pas');

  // Prédicat : seul le rang S compte.
  system.register({
    id: 'test.ranks', name: 'Rang S', desc: 'Seul S', icon: '★', points: 5,
    event: 'game:rank', when: (e) => e.rank === 'S',
  });
  system.emit('game:rank', { gameId: 'cave', rank: 'A' });
  assert(!system.isUnlocked('test.ranks'), 'Le rang A ne valide pas un succès rang S');
  system.emit('game:rank', { gameId: 'cave', rank: 'S' });
  assert(system.isUnlocked('test.ranks'), 'Le rang S valide');

  // Filtre jeu : un succès par jeu ignore les autres jeux.
  system.register({ id: 'cave.first', gameId: 'cave', name: 'Cave', desc: 'Une partie', icon: '▶', points: 5, event: 'game:over' });
  system.emit('game:over', { gameId: 'golf' });
  assert(!system.isUnlocked('cave.first'), 'Un évènement golf ne valide pas cave.first');
  system.emit('game:over', { gameId: 'cave' });
  assert(system.isUnlocked('cave.first'), 'Un évènement cave valide cave.first');

  // Distinct : 2 jeux différents requis, rejouer le même ne compte pas double.
  system.register({
    id: 'g.explorer', name: 'Explorateur', desc: '2 jeux', icon: '🧭', points: 10,
    event: 'game:over', count: 2, distinctBy: 'gameId',
  });
  system.emit('game:over', { gameId: 'cave' });
  system.emit('game:over', { gameId: 'cave' });
  assert(!system.isUnlocked('g.explorer'), 'Rejouer le même jeu ne compte qu’une fois');
  system.emit('game:over', { gameId: 'golf' });
  assert(system.isUnlocked('g.explorer'), 'Deux jeux distincts valident');

  // Persistance : rechargé depuis le même stockage.
  system.saveNow();
  const reloaded = new AchievementSystem({ storage });
  reloaded.register({ id: 'test.trio', name: 'Trio', desc: 'Trois fois', icon: '★', points: 5, event: 'custom:ping', count: 3 });
  reloaded.register({
    id: 'g.explorer', name: 'Explorateur', desc: '2 jeux', icon: '🧭', points: 10,
    event: 'game:over', count: 2, distinctBy: 'gameId',
  });
  assert(reloaded.isUnlocked('test.trio'), 'Le déblocage survit au rechargement');
  equal(reloaded.progressOf('g.explorer'), 2, 'La progression distincte survit au rechargement');

  // Catalogue : génériques par jeu + globaux, et câblage BaseGame.
  const catalog = buildAchievementCatalog([
    { id: 'cave', name: 'CAVE RACER', ranks: [6000, 4000, 2200, 1000, 0] },
    { id: 'golf', name: 'BLOB GOLF', ranks: [100, 60, 30, 10, 0] },
  ]);
  assert(catalog.some((d) => d.id === 'cave.rank-s'), 'Le catalogue contient cave.rank-s');
  assert(catalog.some((d) => d.id === 'g.complete'), 'Le catalogue contient le tour complet');
  const game2 = new AchievementSystem({ storage: memoryStorage() });
  game2.registerMany(catalog);
  equal(game2.size, catalog.length, 'Tout le catalogue est enregistré');
  game2.emit('game:over', { gameId: 'cave', score: 6500, rank: 'S', win: false });
  game2.emit('game:rank', { gameId: 'cave', score: 6500, rank: 'S' });
  assert(game2.isUnlocked('cave.first'), 'game:over valide la découverte du jeu');
  assert(game2.isUnlocked('cave.rank-b'), 'Le rang S valide aussi le palier B');
  assert(game2.isUnlocked('cave.rank-a'), 'Le rang S valide aussi le palier A');
  assert(game2.isUnlocked('cave.rank-s'), 'Le rang S valide le palier S');
  assert(game2.isUnlocked('g.first-play'), 'Le premier game:over valide PREMIERS PAS');
  assert(game2.isUnlocked('g.rank-s'), 'Le rang S valide ÉTOILE');
  const completion = game2.completionForGame('cave');
  equal(completion.unlocked, 4, 'La complétion par jeu compte les 4 succès cave');
  const statistics = game2.stats();
  equal(statistics.unlocked, 6, 'Un game:over + game:rank S valident 6 succès (découverte, B/A/S, PREMIERS PAS, ÉTOILE)');
  equal(statistics.total, catalog.length, 'Le total couvre tout le catalogue');
  assert(game2.forGame('golf').length === 4, 'forGame() isole un jeu');
  assert(game2.globals().length === catalog.length - 8, 'globals() isole les succès arcade');
}

function testMoodUtils(): void {
  equal(progressionRoot({ root: 45 }, 0), 45, 'Sans progression : tonique fixe');
  equal(progressionRoot({ root: 45 }, 137), 45, 'Sans progression : tonique fixe plus tard');
  const loop = { root: 45, progression: [0, -3, -7, -5] };
  equal(progressionRoot(loop, 0), 45, 'Mesure 1 : La (I)');
  equal(progressionRoot(loop, 15), 45, 'Fin de mesure 1 : toujours La');
  equal(progressionRoot(loop, 16), 42, 'Mesure 2 : Fa# (VI)');
  equal(progressionRoot(loop, 32), 38, 'Mesure 3 : Ré (IV)');
  equal(progressionRoot(loop, 48), 40, 'Mesure 4 : Mi (V)');
  equal(progressionRoot(loop, 64), 45, 'Mesure 5 : boucle sur La');
  equal(progressionRoot({ root: 45, progression: [] }, 32), 45, 'Progression vide : tonique fixe');

  equal(arpOffsetAt({ root: 45 }, 4), null, 'Sans arp : silence');
  const arp = { root: 45, arp: [12, null, 16, null] };
  equal(arpOffsetAt(arp, 0), 12, 'Pas 0 : première note');
  equal(arpOffsetAt(arp, 1), null, 'Pas 1 : silence');
  equal(arpOffsetAt(arp, 2), 16, 'Pas 2 : deuxième note');
  equal(arpOffsetAt(arp, 4), 12, 'Le motif boucle sur sa propre longueur');
  equal(arpOffsetAt({ root: 45, arp: [] }, 0), null, 'Arp vide : silence');

  const brass = { root: 45, brass: [null, null, 0, null] };
  equal(brassOffsetAt(brass, 1), null, 'Cuivre : silence hors stab');
  equal(brassOffsetAt(brass, 2), 0, 'Cuivre : stab sur le pas marqué');
  equal(brassOffsetAt(brass, 6), 0, 'Cuivre : le motif boucle');
  equal(brassOffsetAt({ root: 45 }, 2), null, 'Sans cuivre : silence');

  const vox = { root: 45, vox: [null, null, null, null, null, null, null, null, 7, null, null, null, null, null, null, null] };
  const hey = voxStepAt(vox, 8);
  assert(hey && hey.offset === 7 && hey.vowel === 'hey', 'Mesure 1 : "hey!" sur le pas 8');
  equal(voxStepAt(vox, 9), null, 'Mesure 1 : silence autour du cri');
  equal(voxStepAt(vox, 24), null, 'Mesure 2 (impaire) : silence complet');
  const oh = voxStepAt(vox, 40);
  assert(oh && oh.offset === 7 && oh.vowel === 'oh', 'Mesure 3 : la voyelle alterne');
  equal(voxStepAt({ root: 45 }, 8), null, 'Sans vox : silence');

  equal(leadOffsetAt({ root: 43, lead: [12, null] }, 0), 12, 'Leitmotiv : note sur le pas marqué');
  equal(leadOffsetAt({ root: 43, lead: [12, null] }, 1), null, 'Leitmotiv : silence ailleurs');
  equal(leadOffsetAt({ root: 43 }, 0), null, 'Sans leitmotiv : silence');

  close(dottedEighth(120), 0.375, 'Croche pointée à 120 BPM : 0,375 s');
  close(dottedEighth(112), (60 / 112) * 0.75, 'Croche pointée suit le tempo');

  equal(swingOffsetAt(0, 0.08, 112), 0, 'Swing : temps forts intacts');
  equal(swingOffsetAt(4, 0.08, 112), 0, 'Swing : temps pairs intacts');
  close(swingOffsetAt(2, 0.08, 112), 0.08 * (60 / 112 / 2), 'Swing : contretemps décalé');
  equal(swingOffsetAt(2, 0, 112), 0, 'Swing nul : droit');

  equal(fillDrumsAt('off', 63).length, 0, 'Fill off : rien');
  equal(fillDrumsAt(undefined, 63).length, 0, 'Fill absent : rien');
  equal(fillDrumsAt('light', 59).length, 0, 'Fill : rien avant le dernier temps');
  equal(fillDrumsAt('light', 61).length, 0, 'Fill léger : silence au premier contretemps');
  equal(fillDrumsAt('light', 62).join(','), 'snare', 'Fill léger : deux coups');
  equal(fillDrumsAt('light', 63).join(','), 'snare', 'Fill léger : deux coups (fin)');
  equal(fillDrumsAt('full', 60).join(','), 'kick,snare', 'Fill appuyé : attaque franche');
  equal(fillDrumsAt('full', 63).join(','), 'snare', 'Fill appuyé : roulement');

  equal(isBreakBar(undefined, 112), false, 'Sans respiration : jamais de break');
  equal(isBreakBar(8, 0), false, 'Break : pas sur la première mesure');
  equal(isBreakBar(8, 7 * 16), true, 'Break : huitième mesure en retrait');
  equal(isBreakBar(8, 8 * 16), false, 'Break : reprise après la respiration');
  equal(isBreakBar(8, 15 * 16), true, 'Break : le cycle se répète');
}

function testCycle(): void {
  // Directions cardinales.
  equal(cycleDirVec(0).y, -1, 'Cycles : le haut pointe vers le haut');
  equal(cycleDirVec(1).x, 1, 'Cycles : la droite pointe vers la droite');
  equal(cycleDirVec(2).y, 1, 'Cycles : le bas pointe vers le bas');
  equal(cycleDirVec(3).x, -1, 'Cycles : la gauche pointe vers la gauche');
  // Virages : 90° oui, sur-place et demi-tour non.
  assert(cycleCanTurn(0, 1), 'Cycles : virage à 90° autorisé');
  assert(cycleCanTurn(1, 0), 'Cycles : virage à 90° autorisé (retour)');
  equal(cycleCanTurn(0, 0), false, 'Cycles : le sur-place est refusé');
  equal(cycleCanTurn(0, 2), false, 'Cycles : le demi-tour est refusé (suicide)');
  equal(cycleCanTurn(1, 3), false, 'Cycles : le demi-tour horizontal est refusé');
  // Lecture du stick : axe dominant + deadzone.
  equal(cycleWantDir(0.8, 0.1), 1, 'Cycles : stick à droite = droite');
  equal(cycleWantDir(-0.1, -0.9), 0, 'Cycles : stick en haut = haut');
  equal(cycleWantDir(0.1, 0.1), null, 'Cycles : la deadzone reste neutre');
  // Distance point-segment : le cœur des collisions de filaments.
  close(pointSegDist(5, 3, 0, 0, 10, 0), 3, 'Cycles : distance perpendiculaire exacte');
  close(pointSegDist(15, 0, 0, 0, 10, 0), 5, 'Cycles : au-delà du bout, distance au cap');
  close(pointSegDist(0, 0, 0, 0, 10, 0), 0, 'Cycles : sur le segment = zéro');
  // Constantes d'équilibrage verrouillées (quick-win énergie).
  close(CYCLE_ENERGY_COST, 0.35, 'Cycles : traverser sa ligne coûte 35 % d’énergie');
  assert(CYCLE_W >= 1280 * 3 && CYCLE_H >= 720 * 3, 'Cycles : la map fait au moins 3× la scène');
  // Méta : 1 à 4 joueurs, lobby requis au-delà du solo.
  equal(CycleGame.meta.players?.min, 1, 'Cycles : solo autorisé (mode rapide)');
  equal(CycleGame.meta.players?.max, 4, 'Cycles : jusqu’à 4 manettes');
  assert(CycleGame.meta.genre === 'action', 'Cycles : genre action pour le filtre du hub');
}

function testMusicWiring(): void {
  const metas = [
    RhythmGame.meta, SurvivalGame.meta, ShooterGame.meta, RunnerGame.meta,
    CaveGame.meta, SimonGame.meta, SnakeGame.meta, BreakerGame.meta,
    GolfGame.meta, FishingGame.meta, PongGame.meta, ColumnsGame.meta,
    BubbleGame.meta, SortGame.meta, PathGame.meta, FrogGame.meta,
    FlappyGame.meta, DigGame.meta, CycleGame.meta,
  ];
  equal(metas.length, 19, 'Tous les jeux passent l’audit musical');
  for (const meta of metas) {
    assert(MOODS[meta.mood], `Musique : ${meta.id} pointe vers la mood "${meta.mood}" qui n'existe pas (jeu silencieux !)`);
  }
  for (const [name, mood] of Object.entries(MOODS)) {
    assert(mood.bpm >= 60 && mood.bpm <= 180, `Mood ${name} : tempo plausible`);
    assert(mood.root >= 20 && mood.root <= 72, `Mood ${name} : tonique audible`);
    for (const step of [...mood.kick, ...mood.snare]) {
      assert(Number.isInteger(step) && step >= 0 && step < 16, `Mood ${name} : pas de batterie dans 0..15`);
    }
    const patterns = [mood.bass, mood.progression, mood.arp, mood.brass, mood.vox, mood.lead];
    for (const pattern of patterns) {
      if (!pattern) continue;
      for (const value of pattern) {
        assert(value === null || Number.isFinite(value), `Mood ${name} : motif invalide`);
      }
    }
  }
}

const tests: readonly [string, Test][] = [
  ['FixedClock', testClock],
  ['SeededRng', testRng],
  ['Replay', testReplay],
  ['InputManager', testInput],
  ['Simon : contrôles', testSimonControls],
  ['Blob Tri', testSortGame],
  ['Blob Trace', testPathGame],
  ['Blob Golf : game feel', testGolfFeel],
  ['ObjectPool + SpatialHash', testPoolAndHash],
  ['Collisions + PhysicsWorld', testCollisionsAndPhysics],
  ['GridSystem + Scroller + PhaseMachine', testSystems],
  ['DevTools', testDevTools],
  ['Dr Blob (Columns)', testColumns],
  ['Dr Blob : situations', testColumnsScenarios],
  ['Dr Blob : verrous & regards', testLatchAndGaze],
  ['Blob Pop (Bubble)', testBubble],
  ['Blob Frogger', testFrog],
  ['Blob Frogger : un appui = une case', testFrogInput],
  ['Flappy Blob', testFlappy],
  ['Flappy Blob : un appui = un vol', testFlappyInput],
  ['Saut variable partagé', testJump],
  ['Mélodie des moods', testMoodUtils],
  ['Câblage musical', testMusicWiring],
  ['Succès arcade', testAchievements],
  ['Blob Digger', testDig],
  ['Blob Digger : chutes', testDigGravity],
  ['Blob Digger : génération', testDigGen],
  ['Blob Cycles', testCycle],
];

for (const [name, test] of tests) {
  await test();
  console.log(`✓ ${name}`);
}

console.log(`\n${tests.length} groupes de tests moteur passés.`);
