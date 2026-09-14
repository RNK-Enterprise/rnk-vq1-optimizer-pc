/**
 * RNK Vortex System Optimizer
 * Copyright © 2025 Asgard Innovations / RNK™
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, version 3 of the License.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/gpl-3.0.html>.
 *
 *
 * Foundry action adapter for the API-only GM Hub. This is not an optimizer:
 * it applies already-validated data actions and never computes a plan.
 */

const MODULE_ID = 'rnk-vortex-system-optimizer';
const STATE_KEY = 'gmHubAppliedState';

function foundrySettings() {
  return globalThis.game?.settings;
}

export class FoundryActionHost {
  constructor() {
    this.settings = {};
    this.disabled = new Set();
    this.runtime = {};
    this.ready = this._restore();
  }

  async _restore() {
    try {
      const saved = await foundrySettings()?.get?.(MODULE_ID, STATE_KEY);
      if (saved && typeof saved === 'object') {
        this.settings = { ...(saved.settings || {}) };
        this.disabled = new Set(Array.isArray(saved.disabled) ? saved.disabled : []);
      }
    } catch {
      // A missing setting is normal on first install.
    }
    return true;
  }

  async _save() {
    try {
      const settings = foundrySettings();
      if (typeof settings?.set !== 'function') return false;
      if (typeof settings.register === 'function') {
        settings.register(MODULE_ID, STATE_KEY, { scope: 'client', config: false, type: Object, default: {} });
      }
      await settings.set(MODULE_ID, STATE_KEY, {
        settings: { ...this.settings },
        disabled: [...this.disabled].slice(0, 64),
        savedAt: Date.now()
      });
      return true;
    } catch {
      return false;
    }
  }

  async applyAction(action) {
    await this.ready;
    switch (action.type) {
      case 'set-quality':
      case 'set-cache-size':
      case 'set-batch-size':
        this.settings[action.key] = action.value;
        if (action.key === 'render.resolution' && Number.isFinite(globalThis.canvas?.app?.renderer?.resolution)) {
          globalThis.canvas.app.renderer.resolution = action.value;
        }
        break;
      case 'set-fps-cap':
        this.settings[action.key] = action.value;
        if (globalThis.canvas?.app?.ticker) globalThis.canvas.app.ticker.maxFPS = action.value;
        break;
      case 'set-effect-budget':
        this.settings[action.key] = action.value;
        this.runtime.effectsBudget = action.value;
        globalThis.__RNK_OPTIMIZER_EFFECT_BUDGET = action.value;
        break;
      case 'set-animation-budget':
        this.settings[action.key] = action.value;
        this.runtime.animationBudget = action.value;
        globalThis.__RNK_OPTIMIZER_ANIMATION_BUDGET = action.value;
        break;
      case 'set-network-batch':
        this.settings[action.key] = action.value;
        this.runtime.networkBatch = action.value;
        globalThis.__RNK_OPTIMIZER_NETWORK_BATCH = action.value;
        break;
      case 'set-runtime-variant':
        this.settings['runtime.variant'] = action.key;
        break;
      case 'enable-component':
        this.disabled.delete(action.key);
        break;
      case 'disable-component':
        this.disabled.add(action.key);
        break;
      default:
        throw new Error(`Unsupported action type: ${action.type}`);
    }
    await this._save();
    return { ok: true };
  }

  async saveNow() {
    await this.ready;
    return this._save();
  }
}

export default FoundryActionHost;
