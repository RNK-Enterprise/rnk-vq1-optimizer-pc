/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
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
 * Optimizer Core - host-neutral optimization engine.
 *
 * This module contains NO Foundry VTT references. All environment access
 * is injected through the DocumentSource and PerformanceProvider
 * interfaces, so the same core can be driven by a Foundry adapter, a CLI,
 * a test harness, or any other host.
 */

/**
 * Document source interface (implemented by the host adapter).
 * All collections may be null/absent - the core treats them as empty.
 * @typedef {object} DocumentSource
 * @property {() => Array<{id?: string, timestamp?: number}>} [getMessages]
 * @property {(ids: string[]) => Promise<void>} [deleteMessages]
 * @property {() => Array<{id?: string, started?: boolean, turns?: Array}>} [getCombats]
 * @property {(ids: string[]) => Promise<void>} [deleteCombats]
 * @property {() => Array<{collection?: string, getIndex: () => Promise<Array>}>} [getPacks]
 * @property {() => boolean} [isGM]
 */

/**
 * Performance provider interface (implemented by the host adapter).
 * @typedef {object} PerformanceProvider
 * @property {() => Array<{setting: string, from: any, to: any}>} previewChanges
 * @property {(report: object) => Promise<void>} apply
 */

const BATCH_SIZE_MESSAGES = 100;
const BATCH_SIZE_COMBATS = 50;

export class OptimizerCore {
  /**
   * @param {{ logFn?: Function, documentSource?: DocumentSource,
   *           performanceProvider?: PerformanceProvider }} [deps]
   */
  constructor({ logFn, documentSource, performanceProvider } = {}) {
    this._logFn = typeof logFn === 'function' ? logFn : null;
    this._documents = documentSource ?? null;
    this._performance = performanceProvider ?? null;
  }

  log(message) {
    const line = `[${this._nowISO()}] ${message}`;
    if (this._logFn) this._logFn(line);
    console.log(`rnk-vortex-system-optimizer | ${message}`);
  }

  _nowISO() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }

  async dryRun(options) {
    const report = {
      cleanup: {
        chat: { enabled: !!options.doCleanupChat, wouldDelete: 0, olderThan: null },
        combats: { enabled: !!options.doCleanupInactiveCombats, wouldDelete: 0 }
      },
      compendiums: { enabled: !!options.doRebuildCompendiumIndexes, packs: 0 },
      performance: { enabled: !!options.doCorePerformanceTweaks, changes: [] },
      notes: []
    };

    if (options.doCleanupChat) {
      const days = Number(options.chatRetentionDays) || 30;
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
      report.cleanup.chat.olderThan = new Date(cutoff).toISOString();

      try {
        const docs = this._documents?.getMessages?.() ?? [];
        report.cleanup.chat.wouldDelete = docs.reduce((acc, msg) => {
          const ts = msg?.timestamp ?? 0;
          return acc + (ts > 0 && ts < cutoff ? 1 : 0);
        }, 0);
      } catch (e) {
        report.notes.push('Could not count old chat messages (permissions or collection unavailable).');
      }
    }

    if (options.doCleanupInactiveCombats) {
      try {
        const combats = this._documents?.getCombats?.() ?? [];
        report.cleanup.combats.wouldDelete = combats.reduce((acc, c) => {
          const isActive = !!c?.started;
          const hasTurns = Array.isArray(c?.turns) ? c.turns.length > 0 : false;
          return acc + (!isActive && !hasTurns ? 1 : 0);
        }, 0);
      } catch (e) {
        report.notes.push('Could not count inactive combats.');
      }
    }

    if (options.doRebuildCompendiumIndexes) {
      try {
        report.compendiums.packs = (this._documents?.getPacks?.() ?? []).length;
      } catch (e) {
        report.notes.push('Could not enumerate compendium packs.');
      }
    }

    if (options.doCorePerformanceTweaks) {
      report.performance.changes = this._performance?.previewChanges?.() ?? [];
    }

    return report;
  }

  async optimize(options, { dryRun = false } = {}) {
    if (this._documents && typeof this._documents.isGM === 'function' && !this._documents.isGM()) {
      throw new Error('Optimizer requires GM permissions.');
    }

    const report = await this.dryRun(options);
    if (dryRun) return report;

    const t0 = performance.now();
    this.log('Optimization started');

    if (options.doCleanupChat) {
      await this._cleanupChat(options, report);
    }

    if (options.doCleanupInactiveCombats) {
      await this._cleanupCombats(report);
    }

    if (options.doRebuildCompendiumIndexes) {
      await this._rebuildCompendiumIndexes(report);
    }

    if (options.doCorePerformanceTweaks) {
      await this._applyPerformanceTweaks(report);
    }

    try {
      report.performance ??= {};
      report.performance.rafFPS = await this._measureRAFFPS(1000);
      this.log(`Performance: Observed RAF FPS ~ ${report.performance.rafFPS}`);
    } catch (_e) {
      // ignore
    }

    const dt = performance.now() - t0;
    this.log(`Optimization finished in ${Math.round(dt)}ms`);
    return report;
  }

  async _measureRAFFPS(durationMs = 1000) {
    if (typeof requestAnimationFrame !== 'function') return null;
    const dur = Math.max(250, Number(durationMs) || 1000);
    return await new Promise((resolve) => {
      let frames = 0;
      const t0 = performance.now();
      const tick = (t) => {
        frames++;
        if (t - t0 >= dur) {
          const fps = frames / ((t - t0) / 1000);
          resolve(Math.round(fps * 10) / 10);
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  async _cleanupChat(options, report) {
    const days = Number(options.chatRetentionDays) || 30;
    const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
    const all = this._documents?.getMessages?.() ?? [];
    const ids = all
      .filter(m => (m?.timestamp ?? 0) > 0 && (m.timestamp < cutoff))
      .map(m => m.id)
      .filter(Boolean);

    if (!ids.length) {
      this.log('Cleanup: No old chat messages to delete');
      return;
    }

    this.log(`Cleanup: Deleting ${ids.length} chat messages older than ${days} days`);
    try {
      for (let i = 0; i < ids.length; i += BATCH_SIZE_MESSAGES) {
        const batch = ids.slice(i, i + BATCH_SIZE_MESSAGES);
        await this._documents.deleteMessages(batch);
      }
      report.cleanup.chat.deleted = ids.length;
    } catch (e) {
      this.log(`Cleanup: Failed to delete chat messages - ${e.message}`);
      report.cleanup.chat.error = e.message;
    }
  }

  async _cleanupCombats(report) {
    const combats = this._documents?.getCombats?.() ?? [];
    const ids = combats
      .filter(c => {
        const isActive = !!c?.started;
        const hasTurns = Array.isArray(c?.turns) ? c.turns.length > 0 : false;
        return !isActive && !hasTurns;
      })
      .map(c => c.id)
      .filter(Boolean);

    if (!ids.length) {
      this.log('Cleanup: No inactive combats to delete');
      return;
    }

    this.log(`Cleanup: Deleting ${ids.length} inactive combats`);
    try {
      for (let i = 0; i < ids.length; i += BATCH_SIZE_COMBATS) {
        const batch = ids.slice(i, i + BATCH_SIZE_COMBATS);
        await this._documents.deleteCombats(batch);
      }
      report.cleanup.combats.deleted = ids.length;
    } catch (e) {
      this.log(`Cleanup: Failed to delete combats - ${e.message}`);
      report.cleanup.combats.error = e.message;
    }
  }

  async _rebuildCompendiumIndexes(report) {
    const packs = this._documents?.getPacks?.() ?? [];
    this.log(`Compendiums: Rebuilding indexes for ${packs.length} packs`);

    let totalDocs = 0;
    for (const pack of packs) {
      try {
        const index = await pack.getIndex();
        totalDocs += Array.isArray(index) ? index.length : 0;
      } catch (e) {
        this.log(`Compendiums: Failed index for ${pack.collection}: ${e?.message ?? e}`);
      }
    }

    report.compendiums.indexedPacks = packs.length;
    report.compendiums.indexedDocs = totalDocs;
    this.log(`Compendiums: Indexed ~${totalDocs} documents`);
  }

  async _applyPerformanceTweaks(report) {
    if (!this._performance || typeof this._performance.apply !== 'function') return;
    await this._performance.apply(report);
  }
}
