// Succès BLOB ARCADE : catalogue + progression + persistance + toasts.
// Contrôle total : les jeux débloquent directement (unlock) ou émettent des
// évènements (emit) que le catalogue écoute avec prédicats et compteurs.
// La simulation ne dépend jamais des succès : purely méta, localStorage OK.

import * as UI from './ui';

export interface AchievementEvent {
  type: string;
  gameId?: string;
  score?: number;
  rank?: string;
  win?: boolean;
  isNewRecord?: boolean;
  time?: number;
  value?: number;
}

export interface AchievementDef {
  /** Identifiant stable, ex. "cave.first" ou "g.explorer-5". */
  id: string;
  /** Jeu concerné (groupement UI + filtre implicite des évènements). */
  gameId?: string;
  name: string;
  desc: string;
  /** Icône texte/emoji dessinée dans le toast et la galerie. */
  icon?: string;
  points: number;
  secret?: boolean;
  /** Type d'évènement écouté, ex. "game:over", "game:rank", "surv:wave". */
  event: string;
  /** Occurrences requises (défaut 1). */
  count?: number;
  /** Déduplique par jeu : la progression = nombre de jeux distincts. */
  distinctBy?: 'gameId';
  /** Filtre fin sur le payload (rang S, score seuil, vague >= 5...). */
  when?: (e: AchievementEvent) => boolean;
}

export interface AchievementState {
  def: AchievementDef;
  unlocked: boolean;
  unlockedAt: number;
  progress: number;
  needed: number;
}

interface PersistedAchievements {
  unlocked?: Record<string, number>;
  progress?: Record<string, number>;
  sets?: Record<string, string[]>;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;

const STORAGE_KEY = 'blobArcade.achievements.v1';
const TOAST_LIFE = 5;
const TOAST_MAX = 3;

function storageAvailable(): StorageLike | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function neededOf(def: AchievementDef): number {
  return Math.max(1, Math.floor(def.count ?? 1));
}

export class AchievementSystem {
  private readonly defs = new Map<string, AchievementDef>();
  private readonly unlocked = new Map<string, number>();
  private readonly progress = new Map<string, number>();
  private readonly sets = new Map<string, Set<string>>();
  private readonly toasts: Array<{ def: AchievementDef; t: number }> = [];
  private readonly storage: StorageLike | null;
  private saveTimer: number | null = null;
  private dirty = false;
  onUnlock: ((def: AchievementDef) => void) | null = null;

  constructor(options: { storage?: StorageLike | null; onUnlock?: (def: AchievementDef) => void } = {}) {
    this.storage = options.storage === undefined ? storageAvailable() : options.storage;
    if (options.onUnlock) this.onUnlock = options.onUnlock;
    this.load();
  }

  // ---------- catalogue ----------
  register(def: AchievementDef): void {
    this.defs.set(def.id, def);
    if (!this.progress.has(def.id)) {
      const set = this.sets.get(def.id);
      this.progress.set(def.id, set ? set.size : 0);
    }
  }

  registerMany(defs: readonly AchievementDef[]): void {
    for (const def of defs) this.register(def);
  }

  get size(): number {
    return this.defs.size;
  }

  def(id: string): AchievementDef | undefined {
    return this.defs.get(id);
  }

  // ---------- évènements (contrôle total : n'importe quel jeu peut émettre) ----------
  emit(type: string, data: Omit<AchievementEvent, 'type'> = {}, amount = 1): string[] {
    const event: AchievementEvent = { ...data, type };
    const unlockedNow: string[] = [];
    for (const def of this.defs.values()) {
      if (this.unlocked.has(def.id)) continue;
      if (def.event !== type) continue;
      if (def.gameId && event.gameId && def.gameId !== event.gameId) continue;
      if (def.gameId && !event.gameId) continue;
      if (def.when) {
        let ok = false;
        try {
          ok = def.when(event);
        } catch {
          ok = false;
        }
        if (!ok) continue;
      }
      if (def.distinctBy === 'gameId') {
        const key = event.gameId ?? (event.value !== undefined ? String(event.value) : '');
        if (!key) continue;
        let set = this.sets.get(def.id);
        if (!set) {
          set = new Set<string>();
          this.sets.set(def.id, set);
        }
        if (set.has(key)) continue;
        set.add(key);
        this.progress.set(def.id, set.size);
      } else {
        const step = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1;
        this.progress.set(def.id, (this.progress.get(def.id) || 0) + step);
      }
      this.dirty = true;
      if ((this.progress.get(def.id) || 0) >= neededOf(def) && this.unlockNow(def.id)) {
        unlockedNow.push(def.id);
      }
    }
    if (this.dirty) this.scheduleSave();
    return unlockedNow;
  }

  /** Déblocage direct pour logiques complexes (combo, near-miss, speedrun...). */
  unlock(id: string): boolean {
    return this.unlockNow(id);
  }

  addProgress(id: string, amount = 1): boolean {
    const def = this.defs.get(id);
    if (!def || this.unlocked.has(id)) return false;
    const step = Number.isFinite(amount) && amount > 0 ? Math.floor(amount) : 1;
    this.progress.set(id, (this.progress.get(id) || 0) + step);
    this.dirty = true;
    const done = (this.progress.get(id) || 0) >= neededOf(def);
    if (done) return this.unlockNow(id);
    this.scheduleSave();
    return false;
  }

  private unlockNow(id: string): boolean {
    const def = this.defs.get(id);
    if (!def || this.unlocked.has(id)) return false;
    const at = Date.now();
    this.unlocked.set(id, at);
    this.progress.set(id, Math.max(this.progress.get(id) || 0, neededOf(def)));
    this.toasts.push({ def, t: 0 });
    if (this.toasts.length > 6) this.toasts.splice(0, this.toasts.length - 6);
    this.dirty = true;
    this.scheduleSave();
    try {
      this.onUnlock?.(def);
    } catch {
      // Le succès reste débloqué même si le hook audio échoue.
    }
    return true;
  }

  // ---------- lecture ----------
  isUnlocked(id: string): boolean {
    return this.unlocked.has(id);
  }

  progressOf(id: string): number {
    return this.progress.get(id) || 0;
  }

  stateOf(id: string): AchievementState | undefined {
    const def = this.defs.get(id);
    if (!def) return undefined;
    const unlockedAt = this.unlocked.get(id) || 0;
    return {
      def,
      unlocked: unlockedAt > 0,
      unlockedAt,
      progress: Math.min(this.progress.get(id) || 0, neededOf(def)),
      needed: neededOf(def),
    };
  }

  states(): AchievementState[] {
    return Array.from(this.defs.values(), (def) => this.stateOf(def.id) as AchievementState);
  }

  forGame(gameId: string): AchievementState[] {
    return this.states().filter((s) => s.def.gameId === gameId);
  }

  globals(): AchievementState[] {
    return this.states().filter((s) => !s.def.gameId);
  }

  completionForGame(gameId: string): { total: number; unlocked: number } {
    let total = 0;
    let unlocked = 0;
    for (const def of this.defs.values()) {
      if (def.gameId !== gameId) continue;
      total++;
      if (this.unlocked.has(def.id)) unlocked++;
    }
    return { total, unlocked };
  }

  stats(): { total: number; unlocked: number; pointsTotal: number; pointsEarned: number; percent: number } {
    let total = 0;
    let unlocked = 0;
    let pointsTotal = 0;
    let pointsEarned = 0;
    for (const def of this.defs.values()) {
      total++;
      pointsTotal += def.points;
      if (this.unlocked.has(def.id)) {
        unlocked++;
        pointsEarned += def.points;
      }
    }
    return { total, unlocked, pointsTotal, pointsEarned, percent: total ? unlocked / total : 0 };
  }

  resetAll(): void {
    this.unlocked.clear();
    this.progress.clear();
    this.sets.clear();
    this.toasts.length = 0;
    this.dirty = true;
    this.scheduleSave();
  }

  // ---------- toasts ----------
  update(dt: number): void {
    if (this.toasts.length === 0) return;
    for (let i = this.toasts.length - 1; i >= 0; i--) {
      this.toasts[i].t += Math.max(0, dt);
      if (this.toasts[i].t >= TOAST_LIFE) this.toasts.splice(i, 1);
    }
  }

  get pendingToasts(): number {
    return this.toasts.length;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const visible = this.toasts.slice(-TOAST_MAX);
    for (let i = 0; i < visible.length; i++) {
      this.drawToast(ctx, visible[i].def, visible[i].t, i);
    }
  }

  private drawToast(ctx: CanvasRenderingContext2D, def: AchievementDef, t: number, slot: number): void {
    const W = 344;
    const H = 78;
    const x1 = 1280 - 16 - W;
    const inK = Math.min(1, t / 0.35);
    const ease = 1 - Math.pow(1 - inK, 3);
    const x = x1 + (1 - ease) * (W + 24);
    const y = 88 + slot * (H + 10);
    ctx.save();
    if (t > TOAST_LIFE - 0.6) ctx.globalAlpha = Math.max(0, (TOAST_LIFE - t) / 0.6);
    UI.panel(ctx, x, y, W, H, { radius: 14, fill: 'rgba(10,13,20,0.94)', stroke: '#ffd166aa', lineWidth: 1.5 });
    ctx.beginPath();
    ctx.arc(x + 34, y + H / 2, 20, 0, 6.2832);
    ctx.fillStyle = '#ffd16622';
    ctx.fill();
    ctx.strokeStyle = '#ffd166';
    ctx.lineWidth = 2;
    ctx.stroke();
    UI.txt(ctx, def.icon || '🏆', x + 34, y + H / 2 + 7, { size: 20, align: 'center' });
    UI.txt(ctx, 'SUCCÈS DÉBLOQUÉ', x + 62, y + 22, { size: 10, mono: true, color: '#ffd166', weight: 900 });
    UI.txt(ctx, def.name, x + 62, y + 42, { size: 15, color: '#f1f5f9', weight: 900 });
    UI.txt(ctx, `+${def.points} PTS`, x + W - 12, y + 22, { size: 10, align: 'right', mono: true, color: '#a3e635', weight: 900 });
    ctx.font = '600 12px "Segoe UI", system-ui, sans-serif';
    const maxW = W - 74;
    let desc = def.desc;
    if (ctx.measureText(desc).width > maxW) {
      while (desc.length > 4 && ctx.measureText(desc + '…').width > maxW) desc = desc.slice(0, -1);
      desc += '…';
    }
    UI.txt(ctx, desc, x + 62, y + 60, { size: 12, color: '#9aa5b8', weight: 600 });
    ctx.restore();
  }

  // ---------- persistance ----------
  saveNow(): void {
    if (this.saveTimer !== null) {
      try {
        clearTimeout(this.saveTimer);
      } catch {
        // Timer déjà consommé.
      }
      this.saveTimer = null;
    }
    this.flush();
  }

  private scheduleSave(): void {
    if (!this.storage || this.saveTimer !== null) return;
    if (typeof setTimeout === 'undefined') {
      this.flush();
      return;
    }
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, 150);
  }

  private flush(): void {
    if (!this.storage || !this.dirty) return;
    this.dirty = false;
    try {
      const sets: Record<string, string[]> = {};
      for (const [id, set] of this.sets) sets[id] = Array.from(set).slice(0, 64);
      const payload: PersistedAchievements = {
        unlocked: Object.fromEntries(this.unlocked),
        progress: Object.fromEntries(this.progress),
        sets,
      };
      this.storage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // La session continue avec le cache mémoire.
    }
  }

  private load(): void {
    if (!this.storage) return;
    try {
      const raw = this.storage.getItem(STORAGE_KEY);
      if (!raw) return;
      const data = JSON.parse(raw) as PersistedAchievements;
      if (data.unlocked) {
        for (const [id, at] of Object.entries(data.unlocked)) {
          if (typeof at === 'number' && Number.isFinite(at)) this.unlocked.set(id, at);
        }
      }
      if (data.progress) {
        for (const [id, value] of Object.entries(data.progress)) {
          if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
            this.progress.set(id, Math.floor(value));
          }
        }
      }
      if (data.sets) {
        for (const [id, keys] of Object.entries(data.sets)) {
          if (Array.isArray(keys)) this.sets.set(id, new Set(keys.filter((k) => typeof k === 'string').slice(0, 64)));
        }
      }
    } catch {
      // Profil corrompu : on repart de zéro sans écraser tout de suite.
    }
  }
}

// ---------- catalogue : génériques par jeu (rangs) + globaux arcade ----------
export function buildAchievementCatalog(
  metas: ReadonlyArray<{ id: string; name: string; ranks: ReadonlyArray<number> }>,
): AchievementDef[] {
  const defs: AchievementDef[] = [];
  for (const meta of metas) {
    const gameId = meta.id;
    defs.push({
      id: `${gameId}.first`, gameId, name: `${meta.name} — DÉCOUVERTE`,
      desc: 'Termine une partie', icon: '▶', points: 5, event: 'game:over',
    });
    defs.push({
      id: `${gameId}.rank-b`, gameId, name: `${meta.name} — RANG B`,
      desc: 'Atteins le rang B ou mieux', icon: '◆', points: 5, event: 'game:rank',
      when: (e) => e.rank === 'S' || e.rank === 'A' || e.rank === 'B',
    });
    defs.push({
      id: `${gameId}.rank-a`, gameId, name: `${meta.name} — RANG A`,
      desc: 'Atteins le rang A ou mieux', icon: '▲', points: 10, event: 'game:rank',
      when: (e) => e.rank === 'S' || e.rank === 'A',
    });
    defs.push({
      id: `${gameId}.rank-s`, gameId, name: `${meta.name} — RANG S`,
      desc: 'Atteins le rang S', icon: '★', points: 20, event: 'game:rank',
      when: (e) => e.rank === 'S',
    });
  }
  const n = metas.length;
  defs.push(
    { id: 'g.first-play', name: 'PREMIERS PAS', desc: 'Termine ta première partie', icon: '🏁', points: 5, event: 'game:over' },
    { id: 'g.explorer-5', name: 'EXPLORATEUR', desc: 'Termine une partie sur 5 jeux différents', icon: '🧭', points: 10, event: 'game:over', count: Math.min(5, n), distinctBy: 'gameId' },
    { id: 'g.explorer-10', name: 'GRAND TOUR', desc: 'Termine une partie sur 10 jeux différents', icon: '🗺️', points: 20, event: 'game:over', count: Math.min(10, n), distinctBy: 'gameId' },
    { id: 'g.complete', name: 'TOUR COMPLET', desc: `Termine une partie sur les ${n} jeux`, icon: '🌐', points: 50, event: 'game:over', count: Math.max(1, n), distinctBy: 'gameId' },
    { id: 'g.marathon-10', name: 'RÉGULIER', desc: 'Termine 10 parties', icon: '🎮', points: 10, event: 'game:over', count: 10 },
    { id: 'g.marathon-50', name: 'ACHARNÉ', desc: 'Termine 50 parties', icon: '🔥', points: 25, event: 'game:over', count: 50 },
    { id: 'g.record-1', name: 'RECORD !', desc: 'Établis un nouveau record', icon: '🏆', points: 10, event: 'game:record' },
    { id: 'g.record-5', name: 'COLLECTIONNEUR', desc: 'Établis 5 records', icon: '💎', points: 20, event: 'game:record', count: 5 },
    { id: 'g.rank-s', name: 'ÉTOILE', desc: 'Atteins un rang S', icon: '⭐', points: 20, event: 'game:rank', when: (e) => e.rank === 'S' },
    { id: 'g.rank-s5', name: 'ÉLITE', desc: 'Rang S sur 5 jeux différents', icon: '💫', points: 30, event: 'game:rank', count: Math.min(5, n), distinctBy: 'gameId', when: (e) => e.rank === 'S' },
    { id: 'g.winner', name: 'VAINQUEUR', desc: 'Remporte une partie', icon: '👑', points: 10, event: 'game:win' },
  );
  return defs;
}
