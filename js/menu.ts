// Menu principal, trois vues :
//  - FICHE (défaut)  : plein écran pour le jeu sélectionné — démo simulée en fond,
//                      détails, statistiques, rangs, succès du jeu, et en bas le
//                      bandeau de vignettes (fenêtre scrollable).
//  - GRILLE (globale): grille scrollable avec genres, recherche, tri, favoris.
//  - SUCCÈS          : galerie des succès (progression, filtres, par jeu).
// A lance ; V (ou LB/RB) alterne les vues ; Échap ouvre les options.
// La souris ne pilote que l'interface ; le gameplay reste manette/clavier.

import { Fx } from './core/fx';
import { Blob } from './core/blob';
import { Demo } from './demos';
import * as UI from './core/ui';
import { MenuMusicAdapter } from './core/music/game-adapter';
import type { GameConstructor, GameMeta, InputLike, EngineLike, AudioLike, GameGenre } from './core/types';

// ---------- genres (fallback tant que les jeux ne renseignent pas meta.genre) ----------
const GENRE_LABEL: Record<GameGenre, string> = {
  action: 'ACTION',
  pilotage: 'PILOTAGE',
  puzzle: 'PUZZLE',
  flow: 'FLOW',
};
const GENRE_COLOR: Record<GameGenre, string> = {
  action: '#fb7185',
  pilotage: '#818cf8',
  puzzle: '#facc15',
  flow: '#34d399',
};
const GENRE_BY_ID: Record<string, GameGenre> = {
  beat: 'flow', surv: 'action', shoot: 'action', runner: 'pilotage', cave: 'pilotage',
  simon: 'puzzle', snake: 'action', breaker: 'action', golf: 'flow', fish: 'flow',
  pong: 'action', columns: 'puzzle', bubble: 'puzzle', sort: 'puzzle', path: 'puzzle',
  frog: 'pilotage', flap: 'pilotage', dig: 'pilotage', cycle: 'action', bloom: 'puzzle',
};
const GENRE_PILLS: Array<'all' | GameGenre> = ['all', 'action', 'pilotage', 'puzzle', 'flow'];

function gameGenre(meta: GameMeta): GameGenre {
  return meta.genre ?? GENRE_BY_ID[meta.id] ?? 'action';
}

function norm(str: string): string {
  return String(str).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// ---------- grille scrollable ----------
const COLS = 6;
const CARD_W = 162;
const CARD_H = 130;
const GAP_X = 12;
const GAP_Y = 10;
const GRID_Y0 = 200;
const GRID_Y1 = 632;
const ROW_H = CARD_H + GAP_Y;
const DIGIT_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0'] as const;

// Bandeau de vignettes (fiche) : fenêtre fixe, scrollable.
const TH_H = 74;
const TH_GAP = 8;
const TH_Y = 626;
const TH_W = 88;
const TH_MAX = 13;

// Galerie succès.
const TROPHY_ROW_H = 58;
const TROPHY_Y0 = 216;
const TROPHY_Y1 = 634;

const PILL = { x: 918 - 116, y: 532 - 23, w: 232, h: 46 } as const;
const TROPHY_LINE = { x: 648, y: 564, w: 540, h: 24 } as const;

const SWAP_T = 0.38;
const VIEW_T = 0.4;
const VIEW_NOTICE_T = 1.2;
const VIEW_BUTTONS: Array<{ id: MenuView; label: string; x: number; w: number }> = [
  { id: 'detail', label: 'FICHE', x: 452, w: 104 },
  { id: 'grid', label: 'GRILLE', x: 560, w: 104 },
  { id: 'trophies', label: 'SUCCÈS', x: 668, w: 104 },
];
const VIEW_BUTTON_Y = 18;
const VIEW_BUTTON_H = 26;
const SETTINGS_BUTTON = { x: 1112, y: 16, w: 140, h: 34 } as const;

const FAVS_KEY = 'blobArcade.menu.favs';
const RECENT_KEY = 'blobArcade.menu.recent';
const PREFS_KEY = 'blobArcade.menu.prefs';

type MenuView = 'detail' | 'grid' | 'trophies';
type SortMode = 'az' | 'played' | 'best' | 'trophies' | 'recent';
type TrophyStatus = 'all' | 'done' | 'todo';
type HoverTarget = number | 'pill' | 'trophy-line' | 'fav' | 'view-detail' | 'view-grid' | 'view-trophies' | 'settings' | string | -1;

interface Point {
  x: number;
  y: number;
}

interface Dot extends Point {
  z: number;
  s: number;
}

interface DemoLike {
  reset(id: string, accent: string): void;
  update(dt: number): void;
  draw(ctx: CanvasRenderingContext2D): void;
}

const ease = (k: number): number => k * k * (3 - 2 * k);
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));

const SORT_LABEL: Record<SortMode, string> = {
  az: 'A→Z',
  played: '+JOUÉS',
  best: 'RECORDS',
  trophies: 'SUCCÈS',
  recent: 'RÉCENTS',
};
const SORT_ORDER: SortMode[] = ['az', 'played', 'best', 'trophies', 'recent'];

function loadStrings(key: string, max: number): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string').slice(0, max);
  } catch {
    return [];
  }
}

function saveStrings(key: string, values: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(values.slice(0, 20)));
  } catch {
    // Préférence facultative.
  }
}

export class Menu {
  engine?: EngineLike;
  readonly eng: EngineLike;
  readonly games: GameConstructor[];
  readonly input: InputLike;
  readonly audio: AudioLike;
  readonly musicAdapter: MenuMusicAdapter;
  readonly fx: Fx;
  accent = '#7dd3fc';
  sel = 0;
  view: MenuView = 'detail';
  viewT = 1;
  rep = 0;
  wasL = false;
  wasR = false;
  wasU = false;
  wasD = false;
  t = 0;
  lastBeat = 0;
  hop = 0;
  swapT = 0;
  pendingDemo: number | null = null;
  hover: HoverTarget = -1;
  cursor = 'default';
  viewNoticeT = 0;
  viewNoticeLabel = '';
  readonly demo: DemoLike;
  readonly blob: Blob;
  readonly dots: Dot[] = [];

  // --- navigation scalable ---
  genre: 'all' | GameGenre = 'all';
  sort: SortMode = 'az';
  favOnly = false;
  query = '';
  searching = false;
  favs = new Set<string>();
  recents: string[] = [];
  gridScroll = 0;
  gridScrollTarget = 0;
  gridFocus: 'grid' | 'filters' = 'grid';
  filterSel = 0;
  trophyStatus: TrophyStatus = 'all';
  trophyScope: 'all' | 'game' = 'all';
  trophySel = 0;
  trophyScroll = 0;
  trophyScrollTarget = 0;
  trophyFocus: 'list' | 'filters' = 'list';
  trophyFilterSel = 0;
  private readonly onKeyDown: (event: KeyboardEvent) => void;

  constructor(engine: EngineLike, games: GameConstructor[]) {
    this.eng = engine;
    this.games = games;
    this.input = engine.input;
    this.audio = engine.audio;
    this.musicAdapter = new MenuMusicAdapter(this.audio);
    this.fx = new Fx();
    this.demo = new Demo(games[0].meta.id, games[0].meta.accent);
    this.blob = new Blob({ x: 0, y: 0, r: 13, color: '#7dd3fc' });
    for (let i = 0; i < 46; i++) {
      this.dots.push({ x: Math.random() * 1280, y: Math.random() * 720, z: 0.2 + Math.random() * 0.8, s: Math.random() * 6.28 });
    }
    for (const id of loadStrings(FAVS_KEY, 64)) this.favs.add(id);
    this.recents = loadStrings(RECENT_KEY, 10).filter((id) => games.some((g) => g.meta.id === id));
    try {
      const prefs = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}') as {
        view?: MenuView; genre?: 'all' | GameGenre; sort?: SortMode;
      };
      if (prefs.view === 'detail' || prefs.view === 'grid' || prefs.view === 'trophies') this.view = prefs.view;
      if (prefs.genre === 'all' || prefs.genre === 'action' || prefs.genre === 'pilotage' || prefs.genre === 'puzzle' || prefs.genre === 'flow') {
        this.genre = prefs.genre;
      }
      if (prefs.sort && (SORT_ORDER as string[]).includes(prefs.sort)) this.sort = prefs.sort;
    } catch {
      // Prefs facultatives.
    }
    this.onKeyDown = (event: KeyboardEvent) => this.handleSearchKey(event);
  }

  enter(): void {
    this.musicAdapter.start();
    addEventListener('keydown', this.onKeyDown);
  }

  exit(): void {
    this.musicAdapter.stop();
    removeEventListener('keydown', this.onKeyDown);
    if (this.searching) this.leaveSearch(false);
  }

  private savePrefs(): void {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ view: this.view, genre: this.genre, sort: this.sort }));
    } catch {
      // Préférence facultative.
    }
  }

  // ---------- sélection / filtres ----------
  filteredIndices(): number[] {
    let indices = this.games.map((_, i) => i);
    if (this.genre !== 'all') indices = indices.filter((i) => gameGenre(this.games[i].meta) === this.genre);
    if (this.favOnly) indices = indices.filter((i) => this.favs.has(this.games[i].meta.id));
    const q = norm(this.query.trim());
    if (q) {
      indices = indices.filter((i) => {
        const meta = this.games[i].meta;
        return norm(meta.name + ' ' + meta.desc + ' ' + meta.id).includes(q);
      });
    }
    const recents = this.recents;
    const achievements = this.eng.achievements;
    const byName = (a: number, b: number): number => this.games[a].meta.name.localeCompare(this.games[b].meta.name, 'fr');
    switch (this.sort) {
      case 'az':
        indices.sort(byName);
        break;
      case 'played':
        indices.sort((a, b) => (UI.getStats(this.games[b].meta.id).plays || 0) - (UI.getStats(this.games[a].meta.id).plays || 0) || byName(a, b));
        break;
      case 'best':
        indices.sort((a, b) => UI.getBest(this.games[b].meta.id) - UI.getBest(this.games[a].meta.id) || byName(a, b));
        break;
      case 'trophies':
        indices.sort((a, b) => {
          const ca = achievements?.completionForGame(this.games[a].meta.id);
          const cb = achievements?.completionForGame(this.games[b].meta.id);
          const ra = ca && ca.total ? ca.unlocked / ca.total : 0;
          const rb = cb && cb.total ? cb.unlocked / cb.total : 0;
          return rb - ra || byName(a, b);
        });
        break;
      case 'recent':
        indices.sort((a, b) => {
          const ia = recents.indexOf(this.games[a].meta.id);
          const ib = recents.indexOf(this.games[b].meta.id);
          return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib) || byName(a, b);
        });
        break;
    }
    return indices;
  }

  filteredPos(): number {
    return this.filteredIndices().indexOf(this.sel);
  }

  private clampSelToFilter(): void {
    const list = this.filteredIndices();
    if (list.length === 0) return;
    if (!list.includes(this.sel)) {
      this.sel = list[0];
      this.swapT = SWAP_T;
      this.pendingDemo = this.sel;
    }
  }

  private setGenre(genre: 'all' | GameGenre): void {
    if (this.genre === genre) return;
    this.genre = genre;
    this.savePrefs();
    this.gridScrollTarget = 0;
    this.clampSelToFilter();
    this.audio.uiMove();
  }

  private cycleSort(direction = 1): void {
    const i = SORT_ORDER.indexOf(this.sort);
    this.sort = SORT_ORDER[(i + direction + SORT_ORDER.length) % SORT_ORDER.length];
    this.savePrefs();
    const list = this.filteredIndices();
    if (list.length && !list.includes(this.sel)) this.sel = list[0];
    this.audio.uiMove();
  }

  toggleFav(id?: string): void {
    const gameId = id ?? this.games[this.sel].meta.id;
    if (this.favs.has(gameId)) this.favs.delete(gameId);
    else this.favs.add(gameId);
    saveStrings(FAVS_KEY, Array.from(this.favs));
    this.audio.uiOk();
    if (this.favOnly) this.clampSelToFilter();
  }

  private pushRecent(id: string): void {
    this.recents = [id, ...this.recents.filter((r) => r !== id)].slice(0, 10);
    saveStrings(RECENT_KEY, this.recents);
  }

  // ---------- recherche clavier (mode explicite, sans conflit manette) ----------
  beginSearch(): void {
    if (this.searching) return;
    this.searching = true;
    this.input.setBlocked(true);
    this.audio.uiMove();
  }

  private leaveSearch(clear: boolean): void {
    this.searching = false;
    if (clear) this.query = '';
    this.input.setBlocked(false);
    this.input.absorb();
    this.clampSelToFilter();
  }

  private handleSearchKey(event: KeyboardEvent): void {
    if (!this.searching) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      this.audio.uiOk();
      this.leaveSearch(false);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      this.audio.uiBack();
      this.leaveSearch(true);
    } else if (event.key === 'Backspace') {
      event.preventDefault();
      this.query = this.query.slice(0, -1);
      this.clampSelToFilter();
    } else if (event.key.length === 1 && this.query.length < 24) {
      event.preventDefault();
      this.query += event.key;
      this.clampSelToFilter();
    }
  }

  // ---------- navigation ----------
  move(delta: number): void {
    const list = this.filteredIndices();
    if (list.length === 0) return;
    let pos = list.indexOf(this.sel);
    if (pos < 0) pos = 0;
    else pos = (pos + delta + list.length) % list.length;
    this.setGame(list[pos]);
  }

  setGame(index: number): void {
    if (index === this.sel || index < 0 || index >= this.games.length) return;
    this.sel = index;
    this.swapT = SWAP_T;
    this.pendingDemo = index;
    this.audio.uiMove();
  }

  openView(view: MenuView): void {
    if (this.view === view) return;
    this.view = view;
    this.viewT = 0;
    this.savePrefs();
    this.showViewNotice();
    this.audio.uiOk();
  }

  cycleView(direction = 1): void {
    const order: MenuView[] = ['detail', 'grid', 'trophies'];
    this.openView(order[(order.indexOf(this.view) + direction + order.length) % order.length]);
  }

  showViewNotice(): void {
    this.viewNoticeT = VIEW_NOTICE_T;
    this.viewNoticeLabel = this.view === 'detail' ? 'FICHE DÉTAILLÉE' : this.view === 'grid' ? "VUE D'ENSEMBLE" : 'SUCCÈS';
  }

  openSettings(): void {
    if (this.searching) return;
    this.audio.uiOk();
    this.eng.settings.open();
  }

  launch(): void {
    if (this.searching) return;
    const game = this.games[this.sel];
    this.pushRecent(game.meta.id);
    this.audio.uiOk();
    this.eng.startGame(game);
  }

  openTrophiesForCurrentGame(): void {
    this.trophyScope = 'game';
    this.trophyStatus = 'all';
    this.trophySel = 0;
    this.trophyScrollTarget = 0;
    this.openView('trophies');
  }

  // ---------- géométrie ----------
  cardPos(index: number): Point {
    const col = index % COLS;
    const row = Math.floor(index / COLS);
    const totalW = COLS * CARD_W + (COLS - 1) * GAP_X;
    return { x: (1280 - totalW) / 2 + col * (CARD_W + GAP_X), y: GRID_Y0 + row * ROW_H - this.gridScroll };
  }

  gridRows(count: number): number {
    return Math.ceil(Math.max(1, count) / COLS);
  }

  maxGridScroll(count: number): number {
    return Math.max(0, this.gridRows(count) * ROW_H - GAP_Y - (GRID_Y1 - GRID_Y0));
  }

  ensureGridVisible(pos: number, count: number): void {
    if (pos < 0) return;
    const row = Math.floor(pos / COLS);
    const top = row * ROW_H;
    const bottom = top + CARD_H;
    const viewTop = this.gridScrollTarget;
    const viewBottom = viewTop + (GRID_Y1 - GRID_Y0);
    if (top < viewTop) this.gridScrollTarget = top;
    else if (bottom > viewBottom) this.gridScrollTarget = bottom - (GRID_Y1 - GRID_Y0);
    this.gridScrollTarget = clamp(this.gridScrollTarget, 0, this.maxGridScroll(count));
  }

  thumbWindow(): { start: number; width: number } {
    const n = this.games.length;
    if (n <= TH_MAX) {
      const width = Math.min(108, Math.max(64, (1280 - 40 - Math.max(0, n - 1) * TH_GAP) / Math.max(1, n)));
      return { start: 0, width };
    }
    const start = clamp(this.sel - Math.floor(TH_MAX / 2), 0, n - TH_MAX);
    return { start, width: TH_W };
  }

  thumbRect(index: number): { x: number; y: number; w: number; h: number } {
    const { start, width } = this.thumbWindow();
    const total = Math.min(this.games.length, TH_MAX) * width + (Math.min(this.games.length, TH_MAX) - 1) * TH_GAP;
    const x0 = (1280 - total) / 2;
    return { x: x0 + (index - start) * (width + TH_GAP), y: TH_Y, w: width, h: TH_H };
  }

  thumbVisible(index: number): boolean {
    const { start } = this.thumbWindow();
    return index >= start && index < start + TH_MAX;
  }

  // ---------- succès : lignes + scroll ----------
  trophyRows(): Array<ReturnType<NonNullable<EngineLike['achievements']>['stateOf']> & object> {
    const achievements = this.eng.achievements;
    if (!achievements) return [];
    let rows = achievements.states();
    if (this.trophyScope === 'game') {
      const id = this.games[this.sel].meta.id;
      rows = rows.filter((r) => r.def.gameId === id);
    }
    if (this.trophyStatus === 'done') rows = rows.filter((r) => r.unlocked);
    else if (this.trophyStatus === 'todo') rows = rows.filter((r) => !r.unlocked);
    rows.sort((a, b) => {
      if (a.unlocked !== b.unlocked) return a.unlocked ? -1 : 1;
      const ap = a.progress / Math.max(1, a.needed);
      const bp = b.progress / Math.max(1, b.needed);
      if (!a.unlocked && !b.unlocked && ap !== bp) return bp - ap;
      if (a.unlocked && b.unlocked) return b.unlockedAt - a.unlockedAt;
      return b.def.points - a.def.points;
    });
    return rows;
  }

  maxTrophyScroll(count: number): number {
    return Math.max(0, count * TROPHY_ROW_H - (TROPHY_Y1 - TROPHY_Y0));
  }

  ensureTrophyVisible(): void {
    const count = this.trophyRows().length;
    const top = this.trophySel * TROPHY_ROW_H;
    const bottom = top + TROPHY_ROW_H;
    if (top < this.trophyScrollTarget) this.trophyScrollTarget = top;
    else if (bottom > this.trophyScrollTarget + (TROPHY_Y1 - TROPHY_Y0)) {
      this.trophyScrollTarget = bottom - (TROPHY_Y1 - TROPHY_Y0);
    }
    this.trophyScrollTarget = clamp(this.trophyScrollTarget, 0, this.maxTrophyScroll(count));
  }

  // ---------- souris (interface uniquement) ----------
  hitThumb(x: number, y: number): number {
    for (let i = 0; i < this.games.length; i++) {
      if (!this.thumbVisible(i)) continue;
      const rect = this.thumbRect(i);
      if (x >= rect.x && x <= rect.x + rect.w && y >= rect.y - 8 && y <= rect.y + rect.h) return i;
    }
    return -1;
  }

  hitCard(x: number, y: number): number {
    const list = this.filteredIndices();
    for (let pos = 0; pos < list.length; pos++) {
      const posInfo = this.cardPos(pos);
      if (y < GRID_Y0 - 4 || y > GRID_Y1 + 4) continue;
      if (x >= posInfo.x && x <= posInfo.x + CARD_W && y >= posInfo.y && y <= posInfo.y + CARD_H) return list[pos];
    }
    return -1;
  }

  hitPill(x: number, y: number): boolean {
    return x >= PILL.x && x <= PILL.x + PILL.w && y >= PILL.y && y <= PILL.y + PILL.h;
  }

  hitTrophyLine(x: number, y: number): boolean {
    return x >= TROPHY_LINE.x && x <= TROPHY_LINE.x + TROPHY_LINE.w && y >= TROPHY_LINE.y && y <= TROPHY_LINE.y + TROPHY_LINE.h;
  }

  hitFavStar(x: number, y: number): boolean {
    return x >= 556 && x <= 588 && y >= 62 && y <= 94;
  }

  hitViewButton(x: number, y: number): MenuView | null {
    for (const button of VIEW_BUTTONS) {
      if (x >= button.x && x <= button.x + button.w && y >= VIEW_BUTTON_Y && y <= VIEW_BUTTON_Y + VIEW_BUTTON_H) return button.id;
    }
    return null;
  }

  hitSettingsButton(x: number, y: number): boolean {
    return x >= SETTINGS_BUTTON.x && x <= SETTINGS_BUTTON.x + SETTINGS_BUTTON.w && y >= SETTINGS_BUTTON.y && y <= SETTINGS_BUTTON.y + SETTINGS_BUTTON.h;
  }

  gridPills(): Array<{ id: string; x: number; w: number; label: string }> {
    const pills: Array<{ id: string; label: string; w: number }> = [];
    for (const genre of GENRE_PILLS) {
      const label = genre === 'all' ? 'TOUT' : GENRE_LABEL[genre];
      pills.push({ id: 'genre:' + genre, label, w: 30 + label.length * 8.5 });
    }
    pills.push({ id: 'fav', label: this.favOnly ? '★ FAVORIS' : '☆ FAVORIS', w: 108 });
    pills.push({ id: 'sort', label: 'TRI · ' + SORT_LABEL[this.sort], w: 128 });
    const searchLabel = this.query ? '🔍 ' + (this.query.length > 12 ? this.query.slice(0, 12) + '…' : this.query) : '🔍 CHERCHER';
    pills.push({ id: 'search', label: searchLabel, w: Math.max(130, 30 + searchLabel.length * 7.5) });
    const gap = 8;
    const total = pills.reduce((n, p) => n + p.w, 0) + gap * (pills.length - 1);
    let x = (1280 - total) / 2;
    return pills.map((p) => {
      const rect = { id: p.id, x, w: p.w, label: p.label };
      x += p.w + gap;
      return rect;
    });
  }

  hitGridPill(x: number, y: number): string | null {
    if (y < 156 || y > 184) return null;
    for (const pill of this.gridPills()) {
      if (x >= pill.x && x <= pill.x + pill.w) return pill.id;
    }
    return null;
  }

  trophyPills(): Array<{ id: string; x: number; w: number; label: string }> {
    const status: Array<[TrophyStatus, string]> = [['all', 'TOUS'], ['done', 'OBTENUS'], ['todo', 'À FAIRE']];
    const pills: Array<{ id: string; label: string; w: number }> = status.map(([id, label]) => ({
      id: 'status:' + id, label, w: 30 + label.length * 8.5,
    }));
    pills.push({ id: 'scope', label: this.trophyScope === 'all' ? 'TOUS LES JEUX' : this.games[this.sel].meta.name, w: this.trophyScope === 'all' ? 150 : 190 });
    const gap = 8;
    const total = pills.reduce((n, p) => n + p.w, 0) + gap * (pills.length - 1);
    let x = (1280 - total) / 2;
    return pills.map((p) => {
      const rect = { id: p.id, x, w: p.w, label: p.label };
      x += p.w + gap;
      return rect;
    });
  }

  hitTrophyPill(x: number, y: number): string | null {
    if (y < 164 || y > 192) return null;
    for (const pill of this.trophyPills()) {
      if (x >= pill.x && x <= pill.x + pill.w) return pill.id;
    }
    return null;
  }

  hitTrophyRow(x: number, y: number): number {
    if (y < TROPHY_Y0 || y > TROPHY_Y1 || x < 220 || x > 1060) return -1;
    const row = Math.floor((y - TROPHY_Y0 + this.trophyScroll) / TROPHY_ROW_H);
    return row >= 0 && row < this.trophyRows().length ? row : -1;
  }

  activateGridPill(id: string): void {
    if (id.startsWith('genre:')) this.setGenre(id.slice(6) as 'all' | GameGenre);
    else if (id === 'fav') {
      this.favOnly = !this.favOnly;
      this.clampSelToFilter();
      this.audio.uiMove();
    } else if (id === 'sort') this.cycleSort(1);
    else if (id === 'search') this.beginSearch();
  }

  activateTrophyPill(id: string): void {
    if (id.startsWith('status:')) {
      this.trophyStatus = id.slice(7) as TrophyStatus;
      this.trophySel = 0;
      this.trophyScrollTarget = 0;
      this.audio.uiMove();
    } else if (id === 'scope') {
      this.trophyScope = this.trophyScope === 'all' ? 'game' : 'all';
      this.trophySel = 0;
      this.trophyScrollTarget = 0;
      this.audio.uiMove();
    }
  }

  onPointer(x: number, y: number): void {
    if (this.eng.settings.active) {
      this.eng.settings.onPointer(x, y);
      return;
    }
    if (this.searching) {
      if (!(x >= 490 && x <= 790 && y >= 150 && y <= 190)) this.leaveSearch(false);
      return;
    }
    if (this.hitSettingsButton(x, y)) {
      this.openSettings();
      return;
    }
    const viewButton = this.hitViewButton(x, y);
    if (viewButton) {
      this.openView(viewButton);
      return;
    }
    if (this.view === 'detail') {
      if (this.hitFavStar(x, y)) {
        this.toggleFav();
        return;
      }
      if (this.hitTrophyLine(x, y)) {
        this.openTrophiesForCurrentGame();
        return;
      }
      const index = this.hitThumb(x, y);
      if (index >= 0) {
        if (index === this.sel) this.launch();
        else this.setGame(index);
        return;
      }
      if (this.hitPill(x, y)) this.launch();
      return;
    }
    if (this.view === 'grid') {
      const pill = this.hitGridPill(x, y);
      if (pill) {
        if (this.gridFocus === 'filters') this.activateGridPill(pill);
        else {
          this.gridFocus = 'filters';
          this.filterSel = Math.max(0, this.gridPills().findIndex((p) => p.id === pill));
          this.activateGridPill(pill);
        }
        return;
      }
      const index = this.hitCard(x, y);
      if (index >= 0) {
        if (index === this.sel) this.launch();
        else {
          this.setGame(index);
          this.gridFocus = 'grid';
        }
      }
      return;
    }
    const pill = this.hitTrophyPill(x, y);
    if (pill) {
      this.activateTrophyPill(pill);
      return;
    }
    const row = this.hitTrophyRow(x, y);
    if (row >= 0) {
      this.trophySel = row;
      this.trophyFocus = 'list';
      this.ensureTrophyVisible();
      this.audio.uiMove();
    }
  }

  onPointerMove(x: number, y: number): void {
    this.cursor = 'default';
    if (this.eng.settings.active) {
      this.hover = -1;
      if (this.eng.settings.onPointerMove(x, y)) this.cursor = 'pointer';
      return;
    }
    if (this.searching) return;
    if (this.hitSettingsButton(x, y)) {
      this.hover = 'settings';
      this.cursor = 'pointer';
      return;
    }
    const viewButton = this.hitViewButton(x, y);
    if (viewButton) {
      this.hover = viewButton === 'detail' ? 'view-detail' : viewButton === 'grid' ? 'view-grid' : 'view-trophies';
      this.cursor = 'pointer';
      return;
    }
    if (this.view === 'detail') {
      if (this.hitFavStar(x, y)) {
        this.hover = 'fav';
        this.cursor = 'pointer';
        return;
      }
      if (this.hitTrophyLine(x, y)) {
        this.hover = 'trophy-line';
        this.cursor = 'pointer';
        return;
      }
      this.hover = this.hitThumb(x, y);
      if (this.hover < 0 && this.hitPill(x, y)) this.hover = 'pill';
      if (this.hover !== -1) this.cursor = 'pointer';
    } else if (this.view === 'grid') {
      const pill = this.hitGridPill(x, y);
      if (pill) {
        this.hover = 'gridpill:' + pill;
        this.cursor = 'pointer';
        return;
      }
      this.hover = this.hitCard(x, y);
      if (this.hover >= 0) this.cursor = 'pointer';
    } else {
      const pill = this.hitTrophyPill(x, y);
      if (pill) {
        this.hover = 'trophypill:' + pill;
        this.cursor = 'pointer';
        return;
      }
      this.hover = this.hitTrophyRow(x, y);
      if (this.hover >= 0) this.cursor = 'pointer';
    }
  }

  onPointerUp(): void {
    this.eng.settings.onPointerUp();
  }

  onPointerLeave(): void {
    this.hover = -1;
    this.cursor = 'default';
  }

  onWheel(deltaY: number): void {
    if (this.eng.settings.active || this.searching) return;
    if (this.view === 'grid') {
      const count = this.filteredIndices().length;
      this.gridScrollTarget = clamp(this.gridScrollTarget + deltaY * 0.6, 0, this.maxGridScroll(count));
    } else if (this.view === 'trophies') {
      const count = this.trophyRows().length;
      this.trophyScrollTarget = clamp(this.trophyScrollTarget + deltaY * 0.6, 0, this.maxTrophyScroll(count));
    }
  }

  // ---------- update ----------
  update(dt: number): void {
    this.t += dt;
    this.musicAdapter.update(dt);
    this.viewT = Math.min(1, this.viewT + dt / VIEW_T);
    this.viewNoticeT = Math.max(0, this.viewNoticeT - dt);
    const input = this.input;

    if (this.searching) {
      // La frappe passe par le listener DOM ; ici on garde le décor vivant.
    } else if (this.eng.settings.active) {
      this.eng.settings.update(dt);
    } else if (this.view === 'detail') this.updateDetail(dt, input);
    else if (this.view === 'grid') this.updateGrid(dt, input);
    else this.updateTrophies(dt, input);

    this.gridScroll += (this.gridScrollTarget - this.gridScroll) * Math.min(1, dt * 10);
    if (Math.abs(this.gridScrollTarget - this.gridScroll) < 0.5) this.gridScroll = this.gridScrollTarget;
    this.trophyScroll += (this.trophyScrollTarget - this.trophyScroll) * Math.min(1, dt * 10);
    if (Math.abs(this.trophyScrollTarget - this.trophyScroll) < 0.5) this.trophyScroll = this.trophyScrollTarget;

    // Démo : fondu au changement de jeu.
    if (this.swapT > 0) {
      this.swapT -= dt;
      if (this.pendingDemo !== null && this.swapT <= SWAP_T / 2) {
        const game = this.games[this.pendingDemo];
        this.demo.reset(game.meta.id, game.meta.accent);
        this.pendingDemo = null;
      }
    }
    this.demo.update(dt);

    // Blob : rebond sur le beat, perché sur l'élément sélectionné.
    const beat = this.audio.beat();
    const beatIndex = Math.floor(Math.max(0, beat));
    if (beatIndex !== this.lastBeat && beat > 0) {
      this.lastBeat = beatIndex;
      this.hop = 0.26;
    }
    this.hop = Math.max(0, this.hop - dt);

    const anchor = this.blobAnchor();
    const hopH = this.hop > 0 ? Math.sin((1 - this.hop / 0.26) * Math.PI) * 16 : 0;
    const prevX = this.blob.x;
    const prevY = this.blob.y;
    this.blob.x += (anchor.x - this.blob.x) * Math.min(1, dt * 10);
    this.blob.y = anchor.y - hopH;
    this.blob.vx = (this.blob.x - prevX) / Math.max(dt, 1e-4);
    this.blob.vy = (prevY - this.blob.y) / Math.max(dt, 1e-4);
    this.blob.update(dt);

    for (const dot of this.dots) {
      dot.x -= (8 + dot.z * 22) * dt;
      dot.y += Math.sin(this.t * 0.8 + dot.s) * 6 * dt;
      if (dot.x < -4) {
        dot.x = 1284;
        dot.y = Math.random() * 720;
      }
    }

    this.fx.zoom = 1;
  }

  private blobAnchor(): Point {
    if (this.view === 'detail') {
      const rect = this.thumbRect(this.sel);
      return { x: rect.x + rect.w / 2, y: rect.y - 2 };
    }
    if (this.view === 'grid') {
      const pos = this.filteredPos();
      if (pos >= 0) {
        const card = this.cardPos(pos);
        return { x: card.x + CARD_W / 2, y: Math.max(GRID_Y0, card.y) - 2 };
      }
      return { x: 640, y: GRID_Y0 - 2 };
    }
    return { x: 640, y: TROPHY_Y0 + this.trophySel * TROPHY_ROW_H - this.trophyScroll - 2 };
  }

  private cycleViewInput(input: InputLike): boolean {
    if (input.pressed('lb')) {
      this.cycleView(-1);
      return true;
    }
    if (input.pressed('rb')) {
      this.cycleView(1);
      return true;
    }
    if (input.keyPressed('KeyV')) {
      this.cycleView(1);
      return true;
    }
    return false;
  }

  private settingsInput(input: InputLike): boolean {
    if (input.pressed('back') || input.pressed('select')) {
      if (this.query) {
        this.query = '';
        this.clampSelToFilter();
        this.audio.uiBack();
        return true;
      }
      this.openSettings();
      return true;
    }
    return false;
  }

  private launchInput(input: InputLike): boolean {
    if (input.pressed('a') || input.pressed('start')) {
      this.launch();
      return true;
    }
    for (let i = 0; i < DIGIT_KEYS.length; i++) {
      if (input.key(DIGIT_KEYS[i])) {
        const list = this.filteredIndices();
        if (i < list.length) {
          this.setGame(list[i]);
          this.launch();
        }
        return true;
      }
    }
    return false;
  }

  private favInput(input: InputLike): boolean {
    if (input.pressed('y') || input.keyPressed('KeyE')) {
      this.toggleFav();
      return true;
    }
    return false;
  }

  updateDetail(dt: number, input: InputLike): void {
    if (this.cycleViewInput(input)) return;
    if (this.settingsInput(input)) return;
    if (this.favInput(input)) return;

    const left = input.down('left') || input.moveX < -0.5;
    const right = input.down('right') || input.moveX > 0.5;
    if (input.pressed('left') || (left && !this.wasL)) {
      this.setGame(this.sel - 1);
      this.rep = 0.34;
    } else if (input.pressed('right') || (right && !this.wasR)) {
      this.setGame(this.sel + 1);
      this.rep = 0.34;
    } else if (left || right) {
      this.rep -= dt;
      if (this.rep <= 0) {
        this.setGame(this.sel + (left ? -1 : 1));
        this.rep = 0.14;
      }
    }
    this.wasL = left;
    this.wasR = right;

    if (input.pressed('x') || input.keyPressed('KeyT')) {
      this.openTrophiesForCurrentGame();
      return;
    }
    this.launchInput(input);
  }

  gridFilterCount(): number {
    return GENRE_PILLS.length + 3;
  }

  gridFilterId(at: number): string {
    if (at < GENRE_PILLS.length) return 'genre:' + GENRE_PILLS[at];
    if (at === GENRE_PILLS.length) return 'fav';
    if (at === GENRE_PILLS.length + 1) return 'sort';
    return 'search';
  }

  updateGrid(dt: number, input: InputLike): void {
    if (this.cycleViewInput(input)) return;
    if (this.settingsInput(input)) return;
    if (this.launchInput(input)) return;

    const list = this.filteredIndices();
    let pos = list.indexOf(this.sel);
    if (pos < 0 && list.length) {
      this.sel = list[0];
      pos = 0;
    }

    // Raccourcis directs : C genre, T tri, E favori, / recherche.
    if (input.keyPressed('KeyC')) {
      const i = GENRE_PILLS.indexOf(this.genre);
      this.setGenre(GENRE_PILLS[(i + 1) % GENRE_PILLS.length]);
      return;
    }
    if (input.keyPressed('KeyT') || input.pressed('x')) {
      this.cycleSort(1);
      return;
    }
    if (this.favInput(input)) return;
    if (input.keyPressed('Slash')) {
      this.beginSearch();
      return;
    }

    const left = input.down('left') || input.moveX < -0.5;
    const right = input.down('right') || input.moveX > 0.5;
    const up = input.down('up') || input.moveY < -0.5;
    const down = input.down('down') || input.moveY > 0.5;

    if (this.gridFocus === 'filters') {
      if (input.pressed('left') || (left && !this.wasL)) {
        this.filterSel = (this.filterSel + this.gridFilterCount() - 1) % this.gridFilterCount();
        this.audio.uiMove();
        this.rep = 0.3;
      } else if (input.pressed('right') || (right && !this.wasR)) {
        this.filterSel = (this.filterSel + 1) % this.gridFilterCount();
        this.audio.uiMove();
        this.rep = 0.3;
      } else if (left || right) {
        this.rep -= dt;
        if (this.rep <= 0) {
          this.filterSel = (this.filterSel + (left ? -1 : 1) + this.gridFilterCount()) % this.gridFilterCount();
          this.audio.uiMove();
          this.rep = 0.14;
        }
      }
      if (input.pressed('down') || (down && !this.wasD)) {
        this.gridFocus = 'grid';
        this.audio.uiMove();
      }
      if (input.pressed('a') || input.pressed('start')) {
        this.activateGridPill(this.gridFilterId(this.filterSel));
        return;
      }
      if (input.pressed('b')) {
        this.gridFocus = 'grid';
        this.audio.uiBack();
      }
      this.wasL = left;
      this.wasR = right;
      this.wasU = up;
      this.wasD = down;
      return;
    }

    if (input.pressed('up') || (up && !this.wasU)) {
      if (pos < COLS) {
        this.gridFocus = 'filters';
        this.filterSel = 0;
        this.audio.uiMove();
      } else {
        this.move(-COLS);
        this.ensureGridVisible(this.filteredPos(), list.length);
      }
    } else if (input.pressed('down') || (down && !this.wasD)) {
      if (pos >= 0) {
        this.move(COLS);
        this.ensureGridVisible(this.filteredPos(), list.length);
      }
    } else if (input.pressed('left') || (left && !this.wasL)) {
      this.move(-1);
      this.ensureGridVisible(this.filteredPos(), list.length);
      this.rep = 0.3;
    } else if (input.pressed('right') || (right && !this.wasR)) {
      this.move(1);
      this.ensureGridVisible(this.filteredPos(), list.length);
      this.rep = 0.3;
    } else if (left || right) {
      this.rep -= dt;
      if (this.rep <= 0) {
        this.move(left ? -1 : 1);
        this.ensureGridVisible(this.filteredPos(), list.length);
        this.rep = 0.12;
      }
    }
    if (input.keyPressed('PageUp')) {
      this.move(-COLS * 3);
      this.ensureGridVisible(this.filteredPos(), list.length);
    }
    if (input.keyPressed('PageDown')) {
      this.move(COLS * 3);
      this.ensureGridVisible(this.filteredPos(), list.length);
    }
    this.wasL = left;
    this.wasR = right;
    this.wasU = up;
    this.wasD = down;
  }

  updateTrophies(dt: number, input: InputLike): void {
    void dt;
    if (this.cycleViewInput(input)) return;
    if (this.settingsInput(input)) return;
    const rows = this.trophyRows();
    if (this.trophySel >= rows.length) this.trophySel = Math.max(0, rows.length - 1);

    if (input.keyPressed('KeyC')) {
      this.trophyScope = this.trophyScope === 'all' ? 'game' : 'all';
      this.trophySel = 0;
      this.trophyScrollTarget = 0;
      this.audio.uiMove();
      return;
    }

    const up = input.down('up') || input.moveY < -0.5;
    const down = input.down('down') || input.moveY > 0.5;
    const left = input.down('left') || input.moveX < -0.5;
    const right = input.down('right') || input.moveX > 0.5;

    if (this.trophyFocus === 'filters') {
      if (input.pressed('left') || (left && !this.wasL)) {
        this.trophyFilterSel = (this.trophyFilterSel + 3) % 4;
        this.audio.uiMove();
      }
      if (input.pressed('right') || (right && !this.wasR)) {
        this.trophyFilterSel = (this.trophyFilterSel + 1) % 4;
        this.audio.uiMove();
      }
      if (input.pressed('down') || (down && !this.wasD)) {
        this.trophyFocus = 'list';
        this.audio.uiMove();
      }
      if (input.pressed('a') || input.pressed('start')) {
        const ids = ['status:all', 'status:done', 'status:todo', 'scope'];
        this.activateTrophyPill(ids[this.trophyFilterSel]);
        return;
      }
      if (input.pressed('b')) {
        this.trophyFocus = 'list';
        this.audio.uiBack();
      }
      this.wasL = left;
      this.wasR = right;
      this.wasU = up;
      this.wasD = down;
      return;
    }

    if (input.pressed('up') || (up && !this.wasU)) {
      if (this.trophySel <= 0) {
        this.trophyFocus = 'filters';
        this.trophyFilterSel = 0;
        this.audio.uiMove();
      } else {
        this.trophySel -= 1;
        this.ensureTrophyVisible();
        this.audio.uiMove();
      }
    }
    if (input.pressed('down') || (down && !this.wasD)) {
      if (this.trophySel < rows.length - 1) {
        this.trophySel += 1;
        this.ensureTrophyVisible();
        this.audio.uiMove();
      }
    }
    if (input.keyPressed('PageUp')) {
      this.trophySel = Math.max(0, this.trophySel - 7);
      this.ensureTrophyVisible();
    }
    if (input.keyPressed('PageDown')) {
      this.trophySel = Math.min(Math.max(0, rows.length - 1), this.trophySel + 7);
      this.ensureTrophyVisible();
    }
    this.wasL = left;
    this.wasR = right;
    this.wasU = up;
    this.wasD = down;
  }

  // ---------- rendu ----------
  glyph(ctx: CanvasRenderingContext2D, id: string, x: number, y: number, color: string): void {
    UI.gameGlyph(ctx, id, x, y, color);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = '#070910';
    ctx.fillRect(0, 0, 1280, 720);
    this.fx.world(ctx);

    UI.grid(ctx, { gap: 72, off: this.t * 8, alpha: 0.035 });
    for (const dot of this.dots) {
      ctx.globalAlpha = 0.05 + dot.z * 0.1;
      ctx.fillStyle = '#7dd3fc';
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, 1.2 + dot.z * 1.8, 0, 6.2832);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    if (this.view === 'detail') this.renderDetail(ctx);
    else if (this.view === 'grid') this.renderGrid(ctx);
    else this.renderTrophies(ctx);

    if (this.view !== 'trophies') this.blob.render(ctx);
    this.fx.drawWorld(ctx);
    this.fx.endWorld(ctx);

    this.drawTopControls(ctx);
    this.drawViewNotice(ctx);
    if (this.searching) this.drawSearchOverlay(ctx);

    if (!this.audio.ctx) {
      UI.txt(ctx, 'Appuie sur une touche pour activer le son', 640, 610, { size: 12, align: 'center', color: '#5d6480' });
    }
  }

  private pillButton(
    ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number,
    label: string, active: boolean, hovered: boolean, color = '#7dd3fc',
  ): void {
    UI.panel(ctx, x, y, w, h, {
      radius: h / 2,
      fill: active ? color + 'dd' : hovered ? 'rgba(20,26,38,0.95)' : 'rgba(9,12,19,0.88)',
      stroke: active ? '#ffffff88' : hovered ? 'rgba(255,255,255,0.3)' : color + '44',
      lineWidth: 1,
    });
    UI.txt(ctx, label, x + w / 2, y + h / 2 + 4, {
      size: 10.5, align: 'center', weight: 900,
      color: active ? '#06121c' : hovered ? '#ffffff' : '#c3cbd8',
    });
  }

  drawTopControls(ctx: CanvasRenderingContext2D): void {
    const accent = this.games[this.sel].meta.accent;
    for (const button of VIEW_BUTTONS) {
      const active = this.view === button.id;
      const hovered = this.hover === ('view-' + button.id);
      this.pillButton(ctx, button.x, VIEW_BUTTON_Y, button.w, VIEW_BUTTON_H, button.label, active, hovered, accent);
    }
    const stats = this.eng.achievements?.stats();
    if (stats && stats.total > 0) {
      UI.txt(ctx, `🏆 ${stats.unlocked}/${stats.total}`, 786, 37, { size: 11, mono: true, color: '#ffd166' });
    }

    const settingsFill = this.hover === 'settings' ? accent + 'dd' : 'rgba(9,12,19,0.88)';
    UI.panel(ctx, SETTINGS_BUTTON.x, SETTINGS_BUTTON.y, SETTINGS_BUTTON.w, SETTINGS_BUTTON.h, {
      radius: 17,
      fill: settingsFill,
      stroke: this.hover === 'settings' ? '#ffffff88' : accent + '55',
      lineWidth: 1.5,
    });
    const gx = SETTINGS_BUTTON.x + 22;
    const gy = SETTINGS_BUTTON.y + SETTINGS_BUTTON.h / 2;
    ctx.save();
    ctx.translate(gx, gy);
    ctx.strokeStyle = this.hover === 'settings' ? '#06121c' : accent;
    ctx.fillStyle = this.hover === 'settings' ? '#06121c' : accent;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, 6.2832);
    ctx.stroke();
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * 8, Math.sin(a) * 8);
      ctx.lineTo(Math.cos(a) * 11, Math.sin(a) * 11);
      ctx.stroke();
    }
    ctx.fillStyle = this.hover === 'settings' ? '#06121c' : accent;
    ctx.beginPath(); ctx.arc(0, 0, 2.5, 0, 6.2832); ctx.fill();
    ctx.restore();
    UI.txt(ctx, 'OPTIONS', SETTINGS_BUTTON.x + 84, SETTINGS_BUTTON.y + 22, {
      size: 11,
      align: 'center',
      mono: true,
      color: this.hover === 'settings' ? '#06121c' : '#dfe6f0',
      weight: 900,
    });
  }

  drawViewNotice(ctx: CanvasRenderingContext2D): void {
    if (this.viewNoticeT <= 0) return;
    const accent = this.games[this.sel].meta.accent;
    const alpha = Math.min(0.82, this.viewNoticeT / 0.28);
    const y = this.view === 'grid' ? 142 : 56;
    const noticeW = 190;
    const noticeH = 22;
    const noticeX = (1280 - noticeW) / 2;
    ctx.save();
    ctx.globalAlpha = alpha;
    UI.panel(ctx, noticeX, y, noticeW, noticeH, { radius: 11, fill: accent + '12', stroke: accent + '55', lineWidth: 1 });
    UI.txt(ctx, this.viewNoticeLabel, 640, y + 15, {
      size: 8.5,
      align: 'center',
      mono: true,
      color: '#dfe6f0',
      weight: 700,
    });
    ctx.restore();
  }

  drawSearchOverlay(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = 'rgba(2,3,8,0.55)';
    ctx.fillRect(0, 0, 1280, 720);
    const w = 420;
    const x = (1280 - w) / 2;
    UI.panel(ctx, x, 150, w, 96, { radius: 16, fill: 'rgba(10,14,22,0.97)', stroke: '#7dd3fc88', lineWidth: 2 });
    UI.txt(ctx, 'RECHERCHER UN JEU', x + w / 2, 176, { size: 11, align: 'center', mono: true, color: '#7dd3fc' });
    const cursor = Math.sin(this.t * 6) > 0 ? '▌' : '';
    UI.txt(ctx, (this.query || '') + cursor || cursor, x + w / 2, 214, { size: 22, align: 'center', color: '#eaf6ff', weight: 800 });
    const count = this.filteredIndices().length;
    UI.txt(ctx, `${count} jeu${count > 1 ? 'x' : ''} · Entrée valider · Échap annuler`, x + w / 2, 234, {
      size: 11, align: 'center', color: '#7c8698',
    });
  }

  // ----- vue fiche : plein écran pour le jeu sélectionné -----
  renderDetail(ctx: CanvasRenderingContext2D): void {
    const game = this.games[this.sel];
    const meta = game.meta;
    const accent = meta.accent;
    const entry = ease(this.viewT);
    const slide = (1 - entry) * 34;

    // ----- écran démo compact (à droite) : la colonne gauche respire -----
    const SX = 648;
    const SY = 128;
    const SW = 540;
    const SH = 352;
    const IX = SX + 12;
    const IY = SY + 38;
    const IW = SW - 24;
    const IH = SH - 50;
    ctx.save();
    ctx.globalAlpha = entry;
    ctx.translate(-slide * 0.4, 0);
    UI.panel(ctx, SX, SY, SW, SH, { radius: 18, fill: 'rgba(9,12,19,0.94)', stroke: accent + '55', lineWidth: 2 });
    UI.txt(ctx, 'APERÇU · DÉMO', SX + 18, SY + 25, { size: 11, mono: true, color: accent });
    if (Math.sin(this.t * 3.2) > -0.3) {
      ctx.fillStyle = '#ff5470';
      ctx.beginPath();
      ctx.arc(SX + SW - 24, SY + 20, 5, 0, 6.2832);
      ctx.fill();
    }
    UI.txt(ctx, 'SIMULÉ EN BOUCLE', SX + SW - 38, SY + 25, { size: 10, align: 'right', mono: true, color: '#5d6480' });

    ctx.save();
    UI.roundRect(ctx, IX, IY, IW, IH, 10);
    ctx.clip();
    ctx.fillStyle = '#05070d';
    ctx.fillRect(IX, IY, IW, IH);
    UI.grid(ctx, { gap: 56, off: this.t * 6, alpha: 0.05, color: accent });
    ctx.save();
    ctx.translate(SX + SW / 2, IY + IH / 2);
    ctx.scale(0.62, 0.62);
    ctx.translate(-690, -385);
    this.demo.draw(ctx);
    ctx.restore();
    // Scanlines discrètes, façon borne d'arcade.
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = '#000000';
    for (let y = IY + 2; y < IY + IH; y += 4) ctx.fillRect(IX, y, IW, 1);
    ctx.globalAlpha = 1;
    // Fondu de changement de jeu, limité à l'écran.
    if (this.swapT > 0) {
      ctx.fillStyle = `rgba(5, 7, 13, ${Math.sin(Math.PI * (1 - this.swapT / SWAP_T)) * 0.85})`;
      ctx.fillRect(IX, IY, IW, IH);
    }
    ctx.restore();
    ctx.restore();

    // ----- colonne gauche : titre, détails, stats, rangs -----
    ctx.save();
    ctx.globalAlpha = entry;
    ctx.translate(-slide, 0);

    UI.panel(ctx, 46, 62, 26, 26, { radius: 8, fill: accent + '22', stroke: accent + '66' });
    UI.txt(ctx, String(this.sel + 1), 59, 80, { size: 13, align: 'center', mono: true, color: accent });
    UI.txt(ctx, '/ ' + this.games.length, 108, 80, { size: 12, mono: true, color: '#5d6480' });
    const genre = gameGenre(meta);
    const genreW = 26 + GENRE_LABEL[genre].length * 7.5;
    UI.panel(ctx, 170, 62, genreW, 26, {
      radius: 13, fill: GENRE_COLOR[genre] + '1e', stroke: GENRE_COLOR[genre] + '66',
    });
    UI.txt(ctx, GENRE_LABEL[genre], 170 + genreW / 2, 79, { size: 10.5, align: 'center', mono: true, color: GENRE_COLOR[genre], weight: 900 });
    const fav = this.favs.has(meta.id);
    const favHover = this.hover === 'fav';
    UI.panel(ctx, 556, 62, 32, 32, {
      radius: 16, fill: fav ? '#ffd16622' : favHover ? 'rgba(20,26,38,0.95)' : 'rgba(9,12,19,0.88)',
      stroke: fav ? '#ffd166aa' : '#ffffff22',
    });
    UI.txt(ctx, fav ? '★' : '☆', 572, 85, { size: 17, align: 'center', color: fav ? '#ffd166' : '#5d6480' });
    if (this.recents[0] === meta.id) {
      UI.txt(ctx, '● RÉCENT', 500, 80, { size: 10, mono: true, color: '#34d399' });
    }
    ctx.font = '900 46px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = accent;
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#eaf6ff';
    ctx.fillText(meta.name, 60, 140);
    ctx.shadowBlur = 0;
    UI.txt(ctx, meta.desc, 60, 172, { size: 17, color: '#b9c2d0' });

    // ----- panneau détails -----
    const dx = 60;
    const dw = 540;
    const dy = 194;
    const dh = 180;
    UI.panel(ctx, dx, dy, dw, dh, { radius: 16, fill: 'rgba(9,12,19,0.88)', stroke: 'rgba(255,255,255,0.07)' });
    UI.txt(ctx, 'DÉTAILS', dx + 20, dy + 28, { size: 11, color: accent, mono: true });
    UI.txt(ctx, 'MANETTE', dx + 20, dy + 54, { size: 10.5, color: '#6a7488', mono: true });
    UI.txt(ctx, meta.controls, dx + 96, dy + 54, { size: 14, color: '#e8ecf2' });
    UI.txt(ctx, 'CLAVIER', dx + 20, dy + 82, { size: 10.5, color: '#6a7488', mono: true });
    UI.txt(ctx, meta.keys || '—', dx + 96, dy + 82, { size: 14, color: '#e8ecf2' });
    UI.txt(ctx, 'ASTUCE', dx + 20, dy + 110, { size: 10.5, color: '#6a7488', mono: true });
    ctx.font = '600 13px "Segoe UI", system-ui, sans-serif';
    const lines = UI.wrap(ctx, meta.hint, dw - 118);
    let lineY = dy + 128;
    for (const line of lines.slice(0, 2)) {
      UI.txt(ctx, line, dx + 20, lineY, { size: 13, color: '#aeb8c8', weight: 600 });
      lineY += 19;
    }

    // ----- panneau statistiques -----
    const stats = UI.getStats(meta.id);
    const best = UI.getBest(meta.id);
    const sy = 388;
    const sh = 164;
    UI.panel(ctx, dx, sy, dw, sh, { radius: 16, fill: 'rgba(9,12,19,0.88)', stroke: 'rgba(255,255,255,0.07)' });
    UI.txt(ctx, 'STATISTIQUES', dx + 20, sy + 26, { size: 11, color: accent, mono: true });
    UI.txt(ctx, best > 0 ? UI.fmt(best) : '—', dx + 20, sy + 62, { size: 30, mono: true, weight: 700, color: '#eaf6ff' });
    UI.txt(ctx, best > 0 ? meta.unit : 'aucun record', dx + 20, sy + 82, { size: 11, color: '#7c8698' });

    const cellW = (dw - 40) / 3;
    const cells: Array<[string, string]> = [
      ['PARTIES', stats.plays ? String(stats.plays) : '—'],
      ['TEMPS', stats.time ? UI.fmtTime(stats.time) : '—'],
      ['MOYENNE', stats.plays ? UI.fmt((stats.total || 0) / stats.plays) : '—'],
      ['DERNIER', stats.last !== undefined ? UI.fmt(stats.last) : '—'],
      ['GAGNÉES', stats.wins ? String(stats.wins) : '—'],
    ];
    for (let i = 0; i < 3; i++) {
      const cellX = dx + 20 + i * cellW;
      UI.txt(ctx, cells[i][1], cellX, sy + 116, { size: 17, mono: true, weight: 700, color: '#dfe6f0' });
      UI.txt(ctx, cells[i][0], cellX, sy + 130, { size: 9.5, color: '#5d6480', mono: true });
    }
    for (let i = 3; i < 5; i++) {
      const cellX = dx + 20 + (i - 3) * cellW;
      UI.txt(ctx, cells[i][1], cellX, sy + 148, { size: 17, mono: true, weight: 700, color: '#dfe6f0' });
      UI.txt(ctx, cells[i][0], cellX, sy + 162, { size: 9.5, color: '#5d6480', mono: true });
    }

    // ----- échelle de rangs -----
    UI.txt(ctx, 'RANGS', dx, sy + 182, { size: 11, color: '#6a7488', mono: true });
    const letters = ['S', 'A', 'B', 'C', 'D'] as const;
    const rankColors: Record<(typeof letters)[number], string> = { S: '#ffd166', A: '#a3e635', B: '#38bdf8', C: '#94a3b8', D: '#64748b' };
    for (let i = 0; i < 5; i++) {
      const threshold = meta.ranks[i];
      const reached = best >= threshold;
      const x = dx + 64 + i * 71;
      const rankColor = rankColors[letters[i]];
      UI.panel(ctx, x, sy + 186, 64, 34, { radius: 9, fill: reached ? rankColor + '22' : 'rgba(255,255,255,0.04)', stroke: reached ? rankColor + '99' : 'rgba(255,255,255,0.08)' });
      UI.txt(ctx, letters[i], x + 13, sy + 209, { size: 15, weight: 900, color: reached ? rankColor : '#3d4454' });
      UI.txt(ctx, UI.fmt(threshold), x + 56, sy + 209, { size: 9, align: 'right', mono: true, color: reached ? '#aeb8c8' : '#3d4454' });
    }
    ctx.restore();

    // ----- bouton lancer, sous l'écran de démo -----
    const beat = Math.max(0, this.audio.beat());
    const pulse = Math.max(0, 1 - (beat % 1) * 2.4);
    const pillWidth = 224 + pulse * 6 + (this.hover === 'pill' ? 10 : 0);
    const pillCenterX = SX + SW / 2;
    const pillCenterY = 532;
    ctx.save();
    ctx.globalAlpha = entry;
    UI.panel(ctx, pillCenterX - pillWidth / 2, pillCenterY - 23 - pulse * 2, pillWidth, 46, { radius: 23, fill: accent + (this.hover === 'pill' ? 'ff' : 'e6'), stroke: '#ffffff55' });
    UI.txt(ctx, '▶  LANCER', pillCenterX, pillCenterY + 7, { size: 19, align: 'center', color: '#06121c', weight: 900 });
    UI.txt(ctx, 'A', pillCenterX + pillWidth / 2 + 18, pillCenterY + 7, { size: 12, align: 'center', mono: true, color: '#5d6480' });
    ctx.restore();

    // ----- ligne succès du jeu (cliquable → galerie) -----
    ctx.save();
    ctx.globalAlpha = entry;
    const completion = this.eng.achievements?.completionForGame(meta.id);
    const unlockedCount = completion?.unlocked ?? 0;
    const totalCount = completion?.total ?? 0;
    const lineHover = this.hover === 'trophy-line';
    UI.panel(ctx, TROPHY_LINE.x, TROPHY_LINE.y, TROPHY_LINE.w, TROPHY_LINE.h, {
      radius: 12,
      fill: lineHover ? 'rgba(255,209,102,0.14)' : 'rgba(9,12,19,0.88)',
      stroke: lineHover ? '#ffd166aa' : 'rgba(255,255,255,0.08)',
    });
    const states = this.eng.achievements?.forGame(meta.id) ?? [];
    const icons = states.map((s) => (s.unlocked ? s.def.icon || '★' : '·')).join(' ');
    UI.txt(ctx, `🏆 ${unlockedCount}/${totalCount}`, TROPHY_LINE.x + 14, TROPHY_LINE.y + 16, {
      size: 11, mono: true, color: '#ffd166', weight: 900,
    });
    UI.txt(ctx, icons, TROPHY_LINE.x + 108, TROPHY_LINE.y + 16, { size: 11, color: '#8b95a8' });
    UI.txt(ctx, 'voir les succès ›', TROPHY_LINE.x + TROPHY_LINE.w - 12, TROPHY_LINE.y + 16, {
      size: 10.5, align: 'right', color: lineHover ? '#ffd166' : '#5d6480',
    });
    ctx.restore();

    // ----- bandeau de vignettes (fenêtre scrollable) -----
    ctx.save();
    ctx.globalAlpha = entry;
    const { start } = this.thumbWindow();
    if (start > 0) UI.txt(ctx, '‹', 24, TH_Y + 44, { size: 22, align: 'center', color: '#5d6480' });
    if (start + TH_MAX < this.games.length) UI.txt(ctx, '›', 1256, TH_Y + 44, { size: 22, align: 'center', color: '#5d6480' });
    for (let i = 0; i < this.games.length; i++) {
      if (!this.thumbVisible(i)) continue;
      const gameMeta = this.games[i].meta;
      const isSelected = i === this.sel;
      const isHovered = this.hover === i && !isSelected;
      const rect = this.thumbRect(i);
      const lift = isSelected ? -6 : isHovered ? -3 : 0;
      ctx.save();
      if (isSelected) {
        ctx.shadowColor = gameMeta.accent;
        ctx.shadowBlur = 20;
      }
      UI.roundRect(ctx, rect.x, rect.y + lift, rect.w, rect.h, 12);
      ctx.fillStyle = isSelected ? 'rgba(16,21,32,0.96)' : isHovered ? 'rgba(13,17,26,0.9)' : 'rgba(9,12,19,0.82)';
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = isSelected ? gameMeta.accent : isHovered ? 'rgba(255,255,255,0.3)' : 'rgba(255,255,255,0.08)';
      ctx.lineWidth = isSelected ? 2.5 : isHovered ? 2 : 1.5;
      ctx.stroke();

      ctx.save();
      ctx.translate(rect.x + rect.w / 2, rect.y + lift + 27);
      ctx.scale(0.52, 0.52);
      this.glyph(ctx, gameMeta.id, 0, 0, isSelected ? gameMeta.accent : isHovered ? gameMeta.accent + 'aa' : gameMeta.accent + '77');
      ctx.restore();
      if (this.favs.has(gameMeta.id)) UI.txt(ctx, '★', rect.x + 12, rect.y + lift + 14, { size: 10, color: '#ffd166' });
      UI.txt(ctx, gameMeta.name, rect.x + rect.w / 2, rect.y + lift + 52, { size: 9, align: 'center', color: isSelected ? '#ffffff' : '#8b95a8' });
      const gameBest = UI.getBest(gameMeta.id);
      UI.txt(ctx, gameBest > 0 ? UI.fmt(gameBest) : '·', rect.x + rect.w / 2, rect.y + lift + 65, { size: 8.5, align: 'center', mono: true, color: isSelected ? gameMeta.accent : '#566072' });
      ctx.restore();
    }
    ctx.restore();

    // Pied de page.
    ctx.save();
    ctx.globalAlpha = entry;
    UI.txt(ctx, '← →  jeu      A  lancer      Y/E  ★      X/T  succès      V  vue      Échap  options', 640, 716, {
      size: 12.5, align: 'center', color: '#7c8698',
    });
    const padConnected = this.input.padConnected;
    UI.txt(ctx, padConnected ? '● MANETTE' : '○ CLAVIER', 1252, 716, {
      size: 11, align: 'right', color: padConnected ? '#34d399' : '#5d6480', mono: true,
    });
    ctx.restore();
  }

  // ----- vue grille : scrollable + filtres + recherche + tri -----
  renderGrid(ctx: CanvasRenderingContext2D): void {
    const entry = ease(this.viewT);
    const beat = Math.max(0, this.audio.beat());
    const pulse = Math.max(0, 1 - (beat % 1) * 2.8);

    ctx.save();
    ctx.translate(640, 78);
    const titleScale = 1 + pulse * 0.02;
    ctx.scale(titleScale, titleScale);
    ctx.font = '900 44px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.shadowColor = '#7dd3fc';
    ctx.shadowBlur = 22;
    ctx.fillStyle = '#eaf6ff';
    ctx.fillText('BLOB ARCADE', 0, 0);
    ctx.shadowBlur = 0;
    ctx.restore();
    const list = this.filteredIndices();
    const stats = this.eng.achievements?.stats();
    const trophyBit = stats && stats.total > 0 ? ` · 🏆 ${stats.unlocked}/${stats.total}` : '';
    const filterBit = this.genre !== 'all' ? ' · ' + GENRE_LABEL[this.genre] : '';
    const favBit = this.favOnly ? ' · ★' : '';
    const queryBit = this.query ? ` · 🔍 “${this.query}”` : '';
    UI.txt(ctx, `${list.length}/${this.games.length} jeux${filterBit}${favBit}${queryBit} · tri ${SORT_LABEL[this.sort]}${trophyBit}`, 640, 108, {
      size: 13.5, align: 'center', color: '#8b95a8',
    });

    // Barre de filtres.
    ctx.save();
    ctx.globalAlpha = entry;
    for (const pill of this.gridPills()) {
      const active = pill.id === 'genre:' + this.genre
        || (pill.id === 'fav' && this.favOnly)
        || (pill.id === 'search' && !!this.query);
      const hovered = this.hover === 'gridpill:' + pill.id;
      const focused = this.gridFocus === 'filters' && this.gridFilterId(this.filterSel) === pill.id;
      const color = pill.id.startsWith('genre:') && pill.id !== 'genre:all'
        ? GENRE_COLOR[pill.id.slice(6) as GameGenre]
        : '#7dd3fc';
      this.pillButton(ctx, pill.x, 158, pill.w, 24, pill.label, active || focused, hovered, color);
    }
    ctx.restore();

    // Grille scrollable (clippée).
    ctx.save();
    ctx.globalAlpha = entry;
    ctx.beginPath();
    ctx.rect(0, GRID_Y0 - 6, 1280, GRID_Y1 - GRID_Y0 + 12);
    ctx.clip();
    for (let pos = 0; pos < list.length; pos++) {
      const i = list[pos];
      const game = this.games[i];
      const meta = game.meta;
      const isSelected = i === this.sel;
      const isHovered = this.hover === i && !isSelected;
      const card = this.cardPos(pos);
      if (card.y + CARD_H < GRID_Y0 - 8 || card.y > GRID_Y1 + 8) continue;
      const x = card.x;
      const y = card.y;

      ctx.save();
      if (isSelected) {
        ctx.translate(x + CARD_W / 2, y + CARD_H / 2);
        ctx.scale(1.04, 1.04);
        ctx.translate(-(x + CARD_W / 2), -(y + CARD_H / 2));
      }
      UI.roundRect(ctx, x, y, CARD_W, CARD_H, 14);
      ctx.fillStyle = isSelected ? 'rgba(18, 24, 36, 0.95)' : isHovered ? 'rgba(14, 18, 28, 0.9)' : 'rgba(12, 15, 22, 0.85)';
      ctx.fill();
      ctx.strokeStyle = isSelected ? meta.accent : isHovered ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.09)';
      ctx.lineWidth = isSelected ? 3 : isHovered ? 2 : 1.5;
      if (isSelected) {
        ctx.shadowColor = meta.accent;
        ctx.shadowBlur = 20;
      }
      ctx.stroke();
      ctx.shadowBlur = 0;

      if (this.favs.has(meta.id)) UI.txt(ctx, '★', x + 12, y + 20, { size: 12, color: '#ffd166' });
      const genreTag = gameGenre(meta);
      UI.txt(ctx, GENRE_LABEL[genreTag], x + CARD_W - 10, y + 19, {
        size: 8.5, align: 'right', mono: true, color: GENRE_COLOR[genreTag],
      });
      this.glyph(ctx, meta.id, x + CARD_W / 2, y + 48, isSelected ? meta.accent : isHovered ? meta.accent + 'aa' : meta.accent + '88');
      ctx.font = '800 13px "Segoe UI", system-ui, sans-serif';
      let name = meta.name;
      while (name.length > 2 && ctx.measureText(name).width > CARD_W - 16) name = name.slice(0, -1);
      if (name !== meta.name) name = name.slice(0, -1) + '…';
      UI.txt(ctx, name, x + CARD_W / 2, y + 82, { size: 13, align: 'center', color: isSelected ? '#ffffff' : '#b9c2d0' });
      const best = UI.getBest(meta.id);
      UI.txt(ctx, best > 0 ? UI.fmt(best) + ' ' + meta.unit : '—', x + CARD_W / 2, y + 100, {
        size: 11.5, align: 'center', mono: true, color: '#7c8698',
      });
      const completion = this.eng.achievements?.completionForGame(meta.id);
      if (completion && completion.total > 0) {
        const done = completion.unlocked === completion.total;
        UI.txt(ctx, `🏆 ${completion.unlocked}/${completion.total}`, x + CARD_W / 2, y + 116, {
          size: 10, align: 'center', mono: true, color: done ? '#ffd166' : '#566072',
        });
      }
      ctx.restore();
    }
    ctx.restore();

    // Scrollbar.
    const rows = this.gridRows(list.length);
    const maxScroll = this.maxGridScroll(list.length);
    if (maxScroll > 0 && rows > 0) {
      const trackY = GRID_Y0;
      const trackH = GRID_Y1 - GRID_Y0;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(1258, trackY, 4, trackH);
      const thumbH = Math.max(24, (trackH / (rows * ROW_H)) * trackH);
      const thumbY = trackY + (this.gridScroll / maxScroll) * (trackH - thumbH);
      ctx.fillStyle = '#7dd3fc88';
      ctx.fillRect(1258, thumbY, 4, thumbH);
    }

    ctx.save();
    ctx.globalAlpha = entry;
    if (list.length === 0) {
      UI.txt(ctx, 'AUCUN JEU — Échap efface la recherche, C change de genre', 640, 400, {
        size: 16, align: 'center', color: '#8b95a8',
      });
    } else {
      const meta = this.games[this.sel].meta;
      UI.txt(ctx, `${meta.desc}`, 640, 652, { size: 14, align: 'center', color: '#c3cbd8' });
    }
    ctx.restore();

    UI.txt(ctx, '↑ ↓ ← →  choisir · ↑ depuis le haut = filtres      A  lancer      Y/E  ★      X/T  tri      C  genre      /  chercher', 640, 700, {
      size: 12, align: 'center', color: '#7c8698',
    });
    const padConnected = this.input.padConnected;
    UI.txt(ctx, padConnected ? '● MANETTE OK' : '○ CLAVIER', 1252, 700, {
      size: 12, align: 'right', color: padConnected ? '#34d399' : '#5d6480', mono: true,
    });
  }

  // ----- vue succès : galerie scrollable -----
  renderTrophies(ctx: CanvasRenderingContext2D): void {
    const entry = ease(this.viewT);
    const stats = this.eng.achievements?.stats();
    const total = stats?.total ?? 0;
    const unlocked = stats?.unlocked ?? 0;
    const points = stats ? `${stats.pointsEarned}/${stats.pointsTotal} PTS` : '';

    ctx.save();
    ctx.globalAlpha = entry;
    ctx.font = '900 40px "Segoe UI", system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#ffd166';
    ctx.shadowBlur = 20;
    ctx.fillStyle = '#eaf6ff';
    ctx.fillText('SUCCÈS', 640, 84);
    ctx.shadowBlur = 0;
    UI.txt(ctx, total > 0 ? `${unlocked}/${total} débloqués · ${points}` : 'succès indisponibles', 640, 110, {
      size: 14, align: 'center', color: '#8b95a8',
    });
    if (total > 0) {
      const barW = 400;
      const barX = (1280 - barW) / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.08)';
      ctx.fillRect(barX, 122, barW, 8);
      ctx.fillStyle = '#ffd166';
      ctx.fillRect(barX, 122, barW * (unlocked / total), 8);
    }
    for (const pill of this.trophyPills()) {
      const active = (pill.id === 'status:' + this.trophyStatus)
        || (pill.id === 'scope' && this.trophyScope === 'game');
      const hovered = this.hover === 'trophypill:' + pill.id;
      const ids = ['status:all', 'status:done', 'status:todo', 'scope'];
      const focused = this.trophyFocus === 'filters' && ids[this.trophyFilterSel] === pill.id;
      this.pillButton(ctx, pill.x, 166, pill.w, 24, pill.label, active || focused, hovered, '#ffd166');
    }
    if (this.trophyScope === 'game') {
      UI.txt(ctx, 'portée : ' + this.games[this.sel].meta.name + ' (C pour élargir)', 640, 206, {
        size: 11.5, align: 'center', mono: true, color: '#ffd166',
      });
    }

    const rows = this.trophyRows();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, TROPHY_Y0 - 4, 1280, TROPHY_Y1 - TROPHY_Y0 + 8);
    ctx.clip();
    for (let i = 0; i < rows.length; i++) {
      const y = TROPHY_Y0 + i * TROPHY_ROW_H - this.trophyScroll;
      if (y + TROPHY_ROW_H < TROPHY_Y0 - 4 || y > TROPHY_Y1 + 4) continue;
      const state = rows[i];
      const isSelected = i === this.trophySel && this.trophyFocus === 'list';
      const isHovered = this.hover === i;
      const hidden = state.def.secret && !state.unlocked;
      UI.panel(ctx, 220, y + 4, 840, TROPHY_ROW_H - 8, {
        radius: 12,
        fill: state.unlocked ? 'rgba(255,209,102,0.07)' : 'rgba(9,12,19,0.85)',
        stroke: isSelected || isHovered ? '#ffd166aa' : state.unlocked ? '#ffd16644' : 'rgba(255,255,255,0.07)',
        lineWidth: isSelected ? 2 : 1.5,
      });
      ctx.beginPath();
      ctx.arc(258, y + TROPHY_ROW_H / 2, 17, 0, 6.2832);
      ctx.fillStyle = state.unlocked ? '#ffd16622' : 'rgba(255,255,255,0.04)';
      ctx.fill();
      ctx.strokeStyle = state.unlocked ? '#ffd166' : '#3d4454';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      UI.txt(ctx, hidden ? '?' : state.def.icon || '🏆', 258, y + TROPHY_ROW_H / 2 + 6, {
        size: 16, align: 'center', color: state.unlocked ? '#ffd166' : '#3d4454',
      });
      UI.txt(ctx, hidden ? '???' : state.def.name, 286, y + 26, {
        size: 14, color: state.unlocked ? '#f1f5f9' : '#8b95a8', weight: 900,
      });
      UI.txt(ctx, hidden ? 'Succès secret' : state.def.desc, 286, y + 44, { size: 12, color: '#5d6480' });
      if (state.unlocked) {
        UI.txt(ctx, '✓', 1022, y + 36, { size: 16, align: 'center', color: '#a3e635', weight: 900 });
      } else if (state.needed > 1) {
        UI.txt(ctx, `${Math.min(state.progress, state.needed)}/${state.needed}`, 1022, y + 36, {
          size: 12, align: 'center', mono: true, color: '#7c8698',
        });
      }
      UI.txt(ctx, `+${state.def.points}`, 1048, y + 30, {
        size: 10, align: 'right', mono: true, color: '#a3e635', weight: 900,
      });
      if (!state.def.gameId) UI.txt(ctx, 'ARCADE', 1048, y + 45, { size: 9, align: 'right', mono: true, color: '#5d6480' });
    }
    ctx.restore();

    const maxScroll = this.maxTrophyScroll(rows.length);
    if (maxScroll > 0) {
      const trackH = TROPHY_Y1 - TROPHY_Y0;
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(1072, TROPHY_Y0, 4, trackH);
      const thumbH = Math.max(24, (trackH / (rows.length * TROPHY_ROW_H)) * trackH);
      const thumbY = TROPHY_Y0 + (this.trophyScroll / maxScroll) * (trackH - thumbH);
      ctx.fillStyle = '#ffd16688';
      ctx.fillRect(1072, thumbY, 4, thumbH);
    }
    if (rows.length === 0) {
      UI.txt(ctx, 'AUCUN SUCCÈS ICI — C change la portée, filtres en haut', 640, 420, {
        size: 15, align: 'center', color: '#8b95a8',
      });
    }
    ctx.restore();

    UI.txt(ctx, '↑ ↓  naviguer · ↑ depuis le haut = filtres      C  portée      V / LB·RB  vue', 640, 700, {
      size: 12.5, align: 'center', color: '#7c8698',
    });
  }
}
