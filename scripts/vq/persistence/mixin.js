/**
 * Vortex Quantum - Persistence Mixin for Host Adapters
 *
 * Wraps a host adapter class so its optimizer-managed state survives reloads:
 *
 *   - on construction, a hydration pass restores `settings` + `disabled`
 *     from the host's storage backend (restored state wins over defaults);
 *   - after every applied action, the current state is written back;
 *   - `getEnvironment()` and `applyAction()` await hydration first, so an
 *     early optimizer cycle can never act on un-restored state.
 *
 * The base class must own `this.settings` (plain object) and `this.disabled`
 * (Set). Storage comes from `getPersistenceStorage()` - override it in the
 * host, or pass a backend via the `storage` option.
 *
 * @module optimizer/persistence/mixin
 */

import {
  PERSISTED_STATE_VERSION,
  MAX_DISABLED_ENTRIES,
  filterPersistableSettings,
  validatePersistedState
} from './storage.js';

/**
 * @param {Function} BaseClass - Host adapter class to wrap
 * @param {Object} [options]
 * @param {Object} [options.storage] - Default storage backend (instance
 *   override wins via getPersistenceStorage())
 * @param {Function[]} [options.migrations] - `(record) => record` transforms
 *   applied before validation; use to rescue older schema versions
 * @returns {Function} New class with persistence behavior
 */
export function withPersistence(BaseClass, { storage = null, migrations = [] } = {}) {
  // Capture the base's own storage resolution (hosts define
  // getPersistenceStorage to expose their default backend); the subclass
  // method below would otherwise shadow it entirely.
  const parentGetStorage = BaseClass.prototype.getPersistenceStorage;

  return class PersistentHost extends BaseClass {
    constructor(...args) {
      super(...args);
      if (!(this.settings && typeof this.settings === 'object')) this.settings = {};
      if (!(this.disabled instanceof Set)) this.disabled = new Set();
      this._persistence = {
        storage,
        migrations,
        hydrated: false,
        lastError: null,
        storageType: null
      };
      this._hydrationPromise = this._hydrateFromStorage();
    }

    /**
     * Storage backend for this instance. Resolution order: an instance
     * override injected through the mixin options, then the host's own
     * implementation (its host-appropriate default), then none.
     */
    getPersistenceStorage() {
      if (this._persistence.storage) return this._persistence.storage;
      if (parentGetStorage) return parentGetStorage.call(this);
      return null;
    }

    async _hydrateFromStorage() {
      const storageImpl = this.getPersistenceStorage();
      if (!storageImpl) return false;
      this._persistence.storageType = storageImpl.type ?? 'unknown';
      try {
        let record = await storageImpl.hydrate();
        if (!record) return false;
        for (const migrate of this._persistence.migrations) {
          record = migrate(record) ?? record;
        }
        const validated = validatePersistedState(record);
        if (!validated) return false; // corrupt/unknown version: start fresh
        // Restored state wins over constructor defaults.
        Object.assign(this.settings, validated.settings);
        for (const key of validated.disabled) this.disabled.add(key);
        this._persistence.hydrated = true;
        return true;
      } catch (error) {
        this._persistence.lastError = error;
        return false;
      }
    }

    /** Resolves once the hydration attempt finished; true when state was restored. */
    async whenPersistedReady() {
      await this._hydrationPromise;
      return this._persistence.hydrated;
    }

    /** Force a save (e.g. on app close); true when the backend accepted it. */
    async saveNow() {
      return this._persistToStorage();
    }

    async _persistToStorage() {
      const storageImpl = this.getPersistenceStorage();
      if (!storageImpl) return false;
      try {
        await this._hydrationPromise; // never persist un-hydrated state
        const record = {
          version: PERSISTED_STATE_VERSION,
          savedAt: Date.now(),
          settings: filterPersistableSettings(this.settings),
          disabled: this._persistableDisabled()
        };
        const ok = await storageImpl.persist(record);
        if (!ok) {
          this._persistence.lastError = new Error('Storage backend rejected persist');
        }
        return ok;
      } catch (error) {
        this._persistence.lastError = error;
        return false;
      }
    }

    _persistableDisabled() {
      return [...this.disabled]
        .filter((key) => typeof key === 'string' && key.length > 0)
        .slice(0, MAX_DISABLED_ENTRIES);
    }

    /** Diagnostics for host UIs: persistence on/off, backend, last error. */
    getPersistenceInfo() {
      return {
        enabled: this.getPersistenceStorage() != null,
        storageType: this._persistence.storageType,
        hydrated: this._persistence.hydrated,
        lastError: this._persistence.lastError
          ? this._persistence.lastError.message
          : null
      };
    }

    async applyAction(action, environment) {
      await this._hydrationPromise; // restored state always wins the race
      const result = await super.applyAction(action, environment);
      await this._persistToStorage();
      return result;
    }

    async getEnvironment() {
      await this._hydrationPromise;
      return super.getEnvironment();
    }
  };
}
