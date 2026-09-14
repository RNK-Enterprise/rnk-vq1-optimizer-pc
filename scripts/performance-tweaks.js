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
 * Performance Tweaks Module
 * Handles FPS optimization and core performance settings
 */

export class PerformanceTweaks {
  constructor(logFn = null) {
    this._logFn = logFn;
  }

  log(message) {
    if (this._logFn) this._logFn(message);
    else console.log(`rnk-vortex-system-optimizer | ${message}`);
  }

  raiseCoreMaxFPSCeiling(desired) {
    try {
      const d = Number(desired);
      if (!Number.isFinite(d) || d <= 0) return false;

      const setting = game?.settings?.settings?.get?.('core.maxFPS');
      if (!setting) return false;

      let changed = false;

      if (setting?.range && Number.isFinite(setting.range.max) && setting.range.max < d) {
        setting.range.max = d;
        changed = true;
      }

      const field = setting?.type;
      const opts = field?.options;
      if (opts && Number.isFinite(opts.max) && opts.max < d) {
        opts.max = d;
        changed = true;
      }

      return changed;
    } catch (_e) {
      return false;
    }
  }

  previewChanges() {
    const changes = [];

    const maxFPSKey = game.settings.settings?.get('core.maxFPS') ? 'core.maxFPS' : null;
    if (maxFPSKey) {
      const current = game.settings.get('core', 'maxFPS');
      const desired = 120;
      const s = game.settings.settings.get('core.maxFPS');
      let maxAllowed = desired;
      if (s?.range && Number.isFinite(s.range.max)) {
        maxAllowed = Math.min(maxAllowed, Number(s.range.max));
      }
      const choiceNums = Object.keys(s?.choices ?? {}).map(k => Number(k)).filter(n => Number.isFinite(n));
      if (choiceNums.length) {
        maxAllowed = Math.min(maxAllowed, Math.max(...choiceNums));
      }
      const next = maxAllowed;
      if (typeof current === 'number' && current < next) {
        changes.push({ setting: 'core.maxFPS', from: current, to: next });
      }
    }

    const softShadowsKey = game.settings.settings?.get('core.softShadows') ? 'core.softShadows' : null;
    if (softShadowsKey) {
      const current = game.settings.get('core', 'softShadows');
      const next = false;
      if (typeof current === 'boolean' && current !== next) {
        changes.push({ setting: 'core.softShadows', from: current, to: next });
      }
    }

    return changes;
  }

  async apply(report) {
    const desiredCoreFPS = 120;
    this.raiseCoreMaxFPSCeiling(desiredCoreFPS);

    const planned = this.previewChanges();

    const desiredTickerFPS = 120;
    try {
      if (globalThis.canvas?.app?.ticker) {
        const currentTicker = Number(globalThis.canvas.app.ticker.maxFPS) || 0;
        if (currentTicker < desiredTickerFPS) {
          globalThis.canvas.app.ticker.maxFPS = desiredTickerFPS;
        }
        report.performance.tickerMaxFPS = globalThis.canvas.app.ticker.maxFPS;
      }
    } catch (_e) {
      // ignore
    }

    if (!planned.length) {
      this.log('Performance: No core settings changes needed');
      if (report.performance.tickerMaxFPS) {
        this.log(`Performance: Ticker maxFPS is ${report.performance.tickerMaxFPS}`);
      }
      return;
    }

    this.log(`Performance: Applying ${planned.length} core settings changes`);
    const applied = [];
    const failed = [];
    for (const change of planned) {
      const [ns, key] = change.setting.split('.');
      try {
        await game.settings.set(ns, key, change.to);
        applied.push(change);

        if (change.setting === 'core.maxFPS') {
          try {
            const v = Number(change.to);
            if (Number.isFinite(v) && globalThis.canvas?.app?.ticker) {
              globalThis.canvas.app.ticker.maxFPS = v;
            }
          } catch (_e) {
            // ignore
          }
        }
      } catch (e) {
        const msg = e?.message ?? String(e);
        failed.push({ ...change, error: msg });
        this.log(`Performance: Failed to apply ${change.setting}: ${msg}`);
      }
    }
    if (applied.length) report.performance.applied = applied;
    if (failed.length) report.performance.failed = failed;
    if (report.performance.tickerMaxFPS) {
      this.log(`Performance: Ticker maxFPS is ${report.performance.tickerMaxFPS}`);
    }
  }

  async applyOnReady() {
    try {
      const doPerf = !!game.settings.get('rnk-vortex-system-optimizer', 'doCorePerformanceTweaks');
      if (doPerf && globalThis.canvas?.app?.ticker) {
        const desiredCoreFPS = 120;
        this.raiseCoreMaxFPSCeiling(desiredCoreFPS);
        try {
          const currentCore = Number(game.settings.get('core', 'maxFPS'));
          if (Number.isFinite(currentCore) && currentCore < desiredCoreFPS) {
            await game.settings.set('core', 'maxFPS', desiredCoreFPS);
          }
          console.log(`rnk-vortex-system-optimizer | core.maxFPS=${game.settings.get('core', 'maxFPS')}`);
        } catch (_e) {
          // ignore
        }

        const desiredTickerFPS = 120;
        const currentTicker = Number(globalThis.canvas.app.ticker.maxFPS) || 0;
        if (currentTicker < desiredTickerFPS) {
          globalThis.canvas.app.ticker.maxFPS = desiredTickerFPS;
        }
        console.log(`rnk-vortex-system-optimizer | Ticker maxFPS=${globalThis.canvas.app.ticker.maxFPS}`);
      }
    } catch (_e) {
      // ignore
    }
  }
}
