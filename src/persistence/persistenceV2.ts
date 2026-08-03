/**
 * Persistence v2: versioned, checksummed, revisioned storage with an honest failure story.
 *
 * Layout:
 *  - IndexedDB is the primary store, holding the last N revisions of the save envelope.
 *  - localStorage keeps ONE compact emergency copy (the v1 key, same shape) so a browser
 *    without IndexedDB — or a mid-write crash — still restores something recent.
 *  - Every envelope carries schema/build/rules versions, a revision counter, a timestamp,
 *    and a checksum. A corrupt newest revision falls back to the last known good one.
 *  - v1 saves (bare SaveFile in localStorage) migrate transparently on first load.
 *
 * The debounced-write discipline from Wave 1 stays: memory immediately, storage soon,
 * flush on lifecycle. This module is deliberately dependency-free of the UI layer.
 */
import { RULES_VERSION } from '../core/constants.ts';
import { SAVE_KEY, type SaveFile } from './save.ts';

export const SCHEMA_VERSION = 2;
const DB_NAME = 'go-save';
const STORE = 'revisions';
const KEEP_REVISIONS = 5;

export interface SaveEnvelope {
  schemaVersion: number;
  buildVersion: string;
  rulesVersion: number;
  revision: number;
  timestampMs: number;
  checksum: string;
  payload: SaveFile;
}

/** FNV-1a over the payload JSON — cheap, stable, and good enough to catch truncation. */
export function checksumOf(payload: unknown): string {
  const s = JSON.stringify(payload);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export function makeEnvelope(payload: SaveFile, revision: number, buildVersion = '1.0.0'): SaveEnvelope {
  return {
    schemaVersion: SCHEMA_VERSION,
    buildVersion,
    rulesVersion: RULES_VERSION,
    revision,
    timestampMs: Date.now(),
    checksum: checksumOf(payload),
    payload,
  };
}

export function envelopeValid(e: unknown): e is SaveEnvelope {
  if (!e || typeof e !== 'object') return false;
  const env = e as Partial<SaveEnvelope>;
  if (typeof env.revision !== 'number' || !env.payload || typeof env.checksum !== 'string') return false;
  return checksumOf(env.payload) === env.checksum;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === 'undefined') { resolve(null); return; }
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'revision' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
}

export type BackendKind = 'INDEXEDDB' | 'LOCAL' | 'MEMORY';

export interface LoadResult {
  payload: SaveFile | null;
  revision: number;
  backend: BackendKind;
  /** True when the newest revision was corrupt and an older one was restored. */
  recovered: boolean;
  /** True when a bare v1 save was migrated into an envelope. */
  migratedFromV1: boolean;
}

export class PersistenceV2 {
  private db: IDBDatabase | null = null;
  private revision = 0;
  backend: BackendKind = 'MEMORY';

  async init(): Promise<void> {
    this.db = await openDb();
    this.backend = this.db ? 'INDEXEDDB' : this.localWorks() ? 'LOCAL' : 'MEMORY';
  }

  private localWorks(): boolean {
    try {
      localStorage.setItem(`${SAVE_KEY}.p2probe`, '1');
      localStorage.removeItem(`${SAVE_KEY}.p2probe`);
      return true;
    } catch { return false; }
  }

  /** Load the newest valid revision; fall back through history; migrate v1 when found. */
  async load(): Promise<LoadResult> {
    const out: LoadResult = { payload: null, revision: 0, backend: this.backend, recovered: false, migratedFromV1: false };
    const envs = await this.allRevisions();
    envs.sort((a, b) => (b as SaveEnvelope).revision - (a as SaveEnvelope).revision);
    for (let i = 0; i < envs.length; i++) {
      if (envelopeValid(envs[i])) {
        const e = envs[i] as SaveEnvelope;
        out.payload = e.payload;
        out.revision = e.revision;
        out.recovered = i > 0;             // a newer revision existed and failed its checksum
        this.revision = e.revision;
        return out;
      }
    }
    // No valid IDB revision: try the emergency copy, then bare v1.
    try {
      const raw = localStorage.getItem(`${SAVE_KEY}.v2`);
      if (raw) {
        const e = JSON.parse(raw) as unknown;
        if (envelopeValid(e)) {
          out.payload = (e as SaveEnvelope).payload;
          out.revision = (e as SaveEnvelope).revision;
          this.revision = out.revision;
          out.recovered = envs.length > 0;
          return out;
        }
      }
      const v1raw = localStorage.getItem(SAVE_KEY);
      if (v1raw) {
        const v1 = JSON.parse(v1raw) as SaveFile;
        if (v1 && typeof v1 === 'object' && v1.version === 1) {
          out.payload = v1;
          out.migratedFromV1 = true;
          this.revision = 0;
          return out;
        }
      }
    } catch { /* fall through to null payload */ }
    return out;
  }

  private allRevisions(): Promise<unknown[]> {
    return new Promise((resolve) => {
      if (!this.db) { resolve([]); return; }
      try {
        const tx = this.db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result ?? []);
        req.onerror = () => resolve([]);
      } catch { resolve([]); }
    });
  }

  /** Write a new revision everywhere it fits; prune old ones. Never throws. */
  async write(payload: SaveFile, buildVersion = '1.0.0'): Promise<number> {
    this.revision++;
    const env = makeEnvelope(payload, this.revision, buildVersion);
    // Emergency copy first — it is the one that survives a mid-write crash.
    try { localStorage.setItem(`${SAVE_KEY}.v2`, JSON.stringify(env)); } catch { /* quota */ }
    if (this.db) {
      await new Promise<void>((resolve) => {
        try {
          const tx = this.db!.transaction(STORE, 'readwrite');
          const store = tx.objectStore(STORE);
          store.put(env);
          // Prune: keep the newest KEEP_REVISIONS.
          const cutoff = this.revision - KEEP_REVISIONS;
          if (cutoff > 0) {
            try { store.delete(IDBKeyRange.upperBound(cutoff)); } catch { /* best effort */ }
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
          tx.onabort = () => resolve();
        } catch { resolve(); }
      });
    }
    return this.revision;
  }
}
