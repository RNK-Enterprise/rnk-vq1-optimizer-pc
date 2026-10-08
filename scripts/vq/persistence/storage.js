/**
 * Vortex Quantum - Optimizer Persistence Storage Backends
 *
 * Storage is PC-host-owned: browser localStorage or in-memory fallback. All
 * backends share one tiny contract:
 *
 *   hydrate(): Promise<record|null>    read the persisted record (or null)
 *   persist(record): Promise<boolean>  write the record; false on failure
 *
 * The record shape is versioned and validated here so a corrupt, hostile, or
 * future-version record can never inject unsafe settings into a host. Only
 * optimizer-managed keys inside protocol bounds are ever restored.
 *
 * @module optimizer/persistence/storage
 */

import { DEFAULT_LIMITS, RUNTIME_VARIANTS } from '../protocol.js';

/** Schema version of the persisted optimizer state record. */
export const PERSISTED_STATE_VERSION = 1;

/** Default browser storage key. */
export const DEFAULT_STORAGE_KEY = 'vortex-quantum.optimizer.state';

/** Upper bound on persisted disabled-component entries. */
export const MAX_DISABLED_ENTRIES = 64;

/** Max length of one disabled-component key. */
export const MAX_DISABLED_KEY_LENGTH = 128;

/**
 * True when a settings entry is optimizer-managed and inside protocol bounds.
 * Unknown keys and out-of-bounds values are never persisted or restored, so a
 * stale/bad stored value cannot poison a host; the next plan simply re-applies
 * a valid value.
 *
 * @param {string} key - Settings key
 * @param {*} value - Settings value
 * @returns {boolean}
 */
export function isPersistableSetting(key, value) {
  if (key === 'runtime.variant') return RUNTIME_VARIANTS.includes(value);
  const limit = DEFAULT_LIMITS[key];
  if (!limit) return false;
  return (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    value >= limit.min &&
    value <= limit.max
  );
}

/**
 * Filter a settings object down to persistable, optimizer-managed entries.
 * Non-optimizer keys the host app keeps in the same settings object are
 * deliberately excluded: this record is optimizer-owned state only.
 *
 * @param {Object} settings
 * @returns {Object}
 */
export function filterPersistableSettings(settings) {
  const out = {};
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    return out;
  }
  for (const [key, value] of Object.entries(settings)) {
    if (isPersistableSetting(key, value)) out[key] = value;
  }
  return out;
}

/**
 * Validate + normalize a hydrated record. Returns `{ settings, disabled }`
 * with only safe entries, or null when the record is unusable (wrong/missing
 * version, type-corrupted fields). Field-type corruption rejects the record
 * wholesale; individually bad *entries* inside a well-typed settings object
 * are filtered out instead. Never throws.
 *
 * @param {*} record - Candidate persisted record
 * @returns {{ settings: Object, disabled: string[] }|null}
 */
export function validatePersistedState(record) {
  try {
    if (!record || typeof record !== 'object' || Array.isArray(record)) return null;
    if (record.version !== PERSISTED_STATE_VERSION) return null; // unknown/future: refuse

    // Field-type integrity: a record whose settings/disabled fields exist but
    // have the wrong type is corrupt - refuse it rather than half-accept it.
    if (
      record.settings !== undefined &&
      (record.settings === null || typeof record.settings !== 'object' || Array.isArray(record.settings))
    ) {
      return null;
    }
    if (record.disabled !== undefined && !Array.isArray(record.disabled)) {
      return null;
    }

    const settings = filterPersistableSettings(record.settings);

    const disabled = [];
    const rawDisabled = record.disabled;
    if (Array.isArray(rawDisabled)) {
      for (const key of rawDisabled) {
        if (
          typeof key === 'string' &&
          key.length > 0 &&
          key.length <= MAX_DISABLED_KEY_LENGTH &&
          !disabled.includes(key)
        ) {
          disabled.push(key);
          if (disabled.length >= MAX_DISABLED_ENTRIES) break;
        }
      }
    }
    return { settings, disabled };
  } catch {
    return null;
  }
}

/**
 * Duck-type an injected `storage` option into a backend. Accepts either an
 * already-built backend (hydrate/persist) or a raw localStorage-like object
 * (getItem/setItem), which is wrapped as browser storage. Returns null for
 * anything else so the host can fall back to its default backend.
 *
 * @param {*} storage - Candidate storage or backend
 * @returns {Object|null} Backend, or null when unrecognized
 */
export function asBackend(storage) {
  if (!storage || typeof storage !== 'object') return null;
  if (typeof storage.hydrate === 'function' && typeof storage.persist === 'function') {
    return storage;
  }
  if (
    typeof storage.getItem === 'function' &&
    typeof storage.setItem === 'function'
  ) {
    return createBrowserStorage({ storage });
  }
  return null;
}

/**
 * In-memory backend. Used for tests, SSR/Node contexts, and as the automatic
 * fallback when a real backend is unavailable - persistence silently degrades
 * to per-session memory instead of throwing.
 *
 * @returns {Object} Storage backend
 */
export function createMemoryStorage() {
  let current = null;
  return {
    type: 'memory',
    async hydrate() {
      return current;
    },
    async persist(record) {
      current = record;
      return true;
    }
  };
}

/**
 * Browser localStorage backend. Falls back to memory when localStorage is
 * unavailable; individual failures (private mode, quota exceeded) are
 * non-fatal and reported as a false return from persist().
 *
 * @param {Object} [options]
 * @param {string} [options.key] - Storage key
 * @param {Object} [options.storage] - Storage-like override for tests (getItem/setItem)
 * @returns {Object} Storage backend
 */
export function createBrowserStorage({ key = DEFAULT_STORAGE_KEY, storage } = {}) {
  const ls =
    storage !== undefined
      ? storage
      : globalThis.localStorage;

  if (!ls || typeof ls.getItem !== 'function' || typeof ls.setItem !== 'function') {
    return createMemoryStorage();
  }

  return {
    type: 'browser',
    async hydrate() {
      try {
        const raw = ls.getItem(key);
        if (typeof raw !== 'string' || raw.length === 0) return null;
        return JSON.parse(raw);
      } catch {
        return null; // corrupt or unreadable: start fresh
      }
    },
    async persist(record) {
      try {
        ls.setItem(key, JSON.stringify(record));
        return true;
      } catch {
        return false; // private mode / quota exceeded: best-effort
      }
    }
  };
}
