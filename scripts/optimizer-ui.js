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
 * Optimizer UI Module
 * Handles FormApplication and user interface
 */

import { OptimizerCore } from './optimizer-core.js';
import { createFoundryCoreDependencies } from './foundry-document-source.js';
import {
  getOptimizerClient,
  getOptimizerHost
} from './vq-foundry-host.js';
import { SettingsManager } from './settings-manager.js';

const MODULE_ID = 'rnk-vortex-system-optimizer';

/**
 * Format bytes as human-readable string
 * @param {number} bytes - Byte count
 * @returns {string} Formatted string
 */
export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

/**
 * Get current timestamp in ISO-like format
 * @returns {string} Formatted timestamp
 */
export function nowISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export class OptimizerUI extends FormApplication {
  static get defaultOptions() {
    const merge = (globalThis.foundry?.utils?.mergeObject) ?? globalThis.mergeObject;
    return merge(super.defaultOptions, {
      id: 'rnk-system-optimizer-app',
      title: 'RNK Vortex | System Optimizer',
      template: `modules/${MODULE_ID}/templates/optimizer.html`,
      width: 920,
      height: 640,
      resizable: true,
      classes: ['rnk-system-optimizer-window'],
      closeOnSubmit: false,
      submitOnChange: false,
      editable: true
    });
  }

  constructor(object = {}, options = {}) {
    super(object, options);
    this._logLines = [];
    const captureLog = (line) => {
      this._logLines.push(line);
      if (this._logLines.length > 300) this._logLines.shift();
      this._renderLog();
    };
    this._service = new OptimizerCore({
      logFn: captureLog,
      ...createFoundryCoreDependencies({ logFn: captureLog })
    });
  }

  async getData(options) {
    const host = getOptimizerHost();
    const client = getOptimizerClient();
    let vqConsent = true;
    try {
      vqConsent = game.settings.get(MODULE_ID, 'vqConsent') !== false;
    } catch (_e) {
      // not registered
    }
    return {
      doCleanupChat: SettingsManager.getSetting('doCleanupChat'),
      chatRetentionDays: SettingsManager.getSetting('chatRetentionDays'),
      doCleanupInactiveCombats: SettingsManager.getSetting('doCleanupInactiveCombats'),
      doRebuildCompendiumIndexes: SettingsManager.getSetting('doRebuildCompendiumIndexes'),
      doCorePerformanceTweaks: SettingsManager.getSetting('doCorePerformanceTweaks'),
      vqConsent,
      vqEnv: await this._buildVQEnvSummary(host, client),
      log: this._logLines.join('\n')
    };
  }

  /** Human-readable summary of the detected environment for the VQ card. */
  async _buildVQEnvSummary(host, client) {
    if (!host) {
      return {
        device: 'unknown',
        runtime: 'not initialized',
        network: 'unknown',
        cores: '?',
        webgl: 'none',
        webgpu: 'no',
        wasm: 'no',
        planSource: 'not run',
        appliedCount: 0
      };
    }
    const env = await host.getEnvironment();
    const p = env.platform || {};
    const caps = env.capabilities || {};
    const net = env.network || {};
    const lastReport = client?.getLastReport?.();
    return {
      device: p.mobile ? 'Mobile' : 'Desktop',
      runtime: env.runtime || 'standard',
      network: (net.effectiveType ?? 'unknown') + (net.saveData ? ' (data saver)' : ''),
      cores: env.hardware?.cpu?.cores ?? '?',
      webgl: caps.webgl ?? 'none',
      webgpu: caps.webgpu ? 'yes' : 'no',
      wasm: caps.wasm ? 'yes' : 'no',
      planSource: lastReport?.source ?? 'not run',
      appliedCount: Object.keys(host.settings).length + host.disabled.size
    };
  }

  /** Toggle VQ telemetry consent (setting + live client). */
  async _setVQConsent(enabled) {
    const client = getOptimizerClient();
    if (client) client.setConsent(enabled === true);
    return this._setSetting('vqConsent', enabled === true);
  }

  async _updateObject(_event, _formData) {
    // No-op: we persist changes immediately on input change
  }

  /** Append one line to the report log (used by the VQ cycle too). */
  _appendLog(line) {
    this._logLines.push(line);
    if (this._logLines.length > 300) this._logLines.shift();
    this._renderLog();
  }

  activateListeners(html) {
    super.activateListeners(html);

    const root = html?.[0] ?? html;
    if (!root?.addEventListener) return;

    root.addEventListener('change', (ev) => {
      const t = ev?.target;
      const name = t?.name;
      if (!name) return;

      if (name === 'doCleanupChat') return this._setSetting('doCleanupChat', !!t.checked);
      if (name === 'chatRetentionDays') return this._setSetting('chatRetentionDays', Number(t.value) || 30);
      if (name === 'doCleanupInactiveCombats') return this._setSetting('doCleanupInactiveCombats', !!t.checked);
      if (name === 'doRebuildCompendiumIndexes') return this._setSetting('doRebuildCompendiumIndexes', !!t.checked);
      if (name === 'doCorePerformanceTweaks') return this._setSetting('doCorePerformanceTweaks', !!t.checked);
      if (name === 'vqConsent') return this._setVQConsent(!!t.checked);
    });

    root.addEventListener('click', (ev) => {
      const btn = ev?.target?.closest?.('[data-action]');
      const action = btn?.dataset?.action;
      if (!action) return;

      if (action === 'dryRun') return this._onDryRun();
      if (action === 'run') return this._onRun();
      if (action === 'vqCycle') return this._onVQCycle();
      if (action === 'vqReset') return this._onVQReset();
      if (action === 'close') return this.close();
    });
  }

  async _setSetting(key, value) {
    try {
      await SettingsManager.setSetting(key, value);
    } catch (e) {
      ui.notifications.error(`Failed to save setting: ${key}`);
      console.error(`${MODULE_ID} | setting error`, e);
    }
  }

  _renderLog() {
    const root = this.element?.[0] ?? this.element;
    const el = root?.querySelector?.('#rnk-opt-log');
    if (!el) return;
    el.textContent = this._logLines.join('\n');
  }

  async _onDryRun() {
    if (!game.user?.isGM) return ui.notifications.warn('GM only.');
    this._logLines.push(`[${nowISO()}] Running dry run...`);
    this._renderLog();

    try {
      const report = await this._service.dryRun(SettingsManager.getOptionsFromSettings());
      this._logLines.push(`[${nowISO()}] Dry Run: chat would delete ${report.cleanup.chat.wouldDelete ?? 0}`);
      this._logLines.push(`[${nowISO()}] Dry Run: combats would delete ${report.cleanup.combats.wouldDelete ?? 0}`);
      if (report.compendiums.enabled) {
        this._logLines.push(`[${nowISO()}] Dry Run: would index ${report.compendiums.packs} compendium packs`);
      }
      if (report.performance.enabled) {
        const changes = report.performance.changes ?? [];
        if (!changes.length) {
          this._logLines.push(`[${nowISO()}] Dry Run: no core performance changes needed`);
        } else {
          for (const c of changes) {
            this._logLines.push(`[${nowISO()}] Dry Run: ${c.setting} ${c.from} -> ${c.to}`);
          }
        }
      }
      if (Array.isArray(report.notes) && report.notes.length) {
        for (const note of report.notes) {
          this._logLines.push(`[${nowISO()}] Note: ${note}`);
        }
      }
    } catch (e) {
      console.error(`${MODULE_ID} | dry run failed`, e);
      this._logLines.push(`[${nowISO()}] Dry Run failed: ${e?.message ?? e}`);
    }

    if (this._logLines.length > 300) this._logLines = this._logLines.slice(-300);
    this._renderLog();
  }

  async _onRun() {
    if (!game.user?.isGM) return ui.notifications.warn('GM only.');

    const options = SettingsManager.getOptionsFromSettings();
    const report = await this._service.dryRun(options);

    const wouldDelete = (report.cleanup.chat.wouldDelete ?? 0) + (report.cleanup.combats.wouldDelete ?? 0);
    if (wouldDelete > 0) {
      const ok = await Dialog.confirm({
        title: 'Confirm Optimization',
        content: `<p>This will delete <b>${wouldDelete}</b> documents (chat + combats) based on the current settings.</p><p>Continue?</p>`
      });
      if (!ok) {
        this._logLines.push(`[${nowISO()}] Canceled.`);
        this._renderLog();
        return;
      }
    }

    const root = this.element?.[0] ?? this.element;
    const btn = root?.querySelector?.('[data-action="run"]');
    if (btn) btn.disabled = true;

    try {
      const beforePerf = performance.memory?.usedJSHeapSize;
      const finalReport = await this._service.optimize(options, { dryRun: false });
      const afterPerf = performance.memory?.usedJSHeapSize;

      if (Number.isFinite(beforePerf) && Number.isFinite(afterPerf)) {
        this._logLines.push(`[${nowISO()}] Heap: ${formatBytes(beforePerf)} -> ${formatBytes(afterPerf)}`);
      }

      const deletedChat = finalReport.cleanup.chat.deleted ?? 0;
      const deletedCombats = finalReport.cleanup.combats.deleted ?? 0;
      this._logLines.push(`[${nowISO()}] Done: deleted chat=${deletedChat}, combats=${deletedCombats}`);

      if (finalReport.compendiums.indexedPacks) {
        this._logLines.push(`[${nowISO()}] Done: indexed packs=${finalReport.compendiums.indexedPacks}, docs~=${finalReport.compendiums.indexedDocs ?? 0}`);
      }

      if (Array.isArray(finalReport.performance.applied) && finalReport.performance.applied.length) {
        for (const c of finalReport.performance.applied) {
          this._logLines.push(`[${nowISO()}] Applied: ${c.setting} -> ${c.to}`);
        }
      }

      if (Number.isFinite(finalReport?.performance?.rafFPS)) {
        this._logLines.push(`[${nowISO()}] Observed RAF FPS ~ ${finalReport.performance.rafFPS}`);
      }

      ui.notifications.info('System optimization completed');
    } catch (e) {
      console.error(`${MODULE_ID} | optimize failed`, e);
      ui.notifications.error('System optimization failed. See console.');
      this._logLines.push(`[${nowISO()}] Failed: ${e?.message ?? e}`);
    } finally {
      if (btn) btn.disabled = false;
      if (this._logLines.length > 300) this._logLines = this._logLines.slice(-300);
      this._renderLog();
    }
  }

  /** One VQ optimizer cycle: environment -> metrics -> plan -> apply -> report. */
  async _onVQCycle() {
    const client = getOptimizerClient();
    if (!client) {
      ui.notifications.error('VQ optimizer is not initialized.');
      return;
    }
    if (client.isBusy()) return ui.notifications.warn('VQ optimizer cycle already running.');

    const root = this.element?.[0] ?? this.element;
    const btn = root?.querySelector?.('[data-action="vqCycle"]');
    if (btn) btn.disabled = true;

    const clientAny = /** @type {any} */ (client);
    try {
      // Surface the environment so the GM sees what was detected.
      const env = await clientAny.host.getEnvironment();
      const p = env.platform || {};
      const caps = env.capabilities || {};
      const net = env.network || {};
      this._appendLog(`[${nowISO()}] VQ env: ${p.host}/${p.type} mobile=${!!p.mobile} wasm=${!!caps.wasm} webgl=${caps.webgl ?? 'none'} webgpu=${!!caps.webgpu} net=${net.effectiveType ?? 'unknown'}${net.saveData ? ' (data saver)' : ''}`);

      // Host listeners receive the event payload only (host.on contract).
      clientAny.host.on('server-unavailable', (data) => {
        this._appendLog(`[${nowISO()}] VQ: server unreachable - local safe mode (${data?.reason ?? 'unknown'})`);
      });
      clientAny.host.on('action-applied', (data) => {
        const a = data?.action ?? {};
        this._appendLog(`[${nowISO()}] VQ applied: ${a.type} ${a.key ?? ''} ${a.value ?? ''}`.trimEnd());
      });
      clientAny.host.on('action-failed', (data) => {
        const a = data?.action ?? {};
        this._appendLog(`[${nowISO()}] VQ failed: ${a.type} ${a.key ?? ''} - ${data?.reason ?? 'unknown'}`);
      });
      clientAny.host.on('action-rejected', (data) => {
        const a = data?.action ?? {};
        this._appendLog(`[${nowISO()}] VQ rejected: ${a.type} ${a.key ?? ''} - ${data?.reason ?? 'unknown'}`);
      });

      const report = await client.run();

      this._appendLog(`[${nowISO()}] VQ cycle: source=${report.source} applied=${report.applied.length} skipped=${report.skipped}`);
      if (Number.isFinite(report.at)) this._appendLog(`[${nowISO()}] VQ plan time: ${new Date(report.at).toISOString()}`);
      ui.notifications.info(`VQ optimizer cycle complete (${report.source})`);
    } catch (e) {
      console.error(`${MODULE_ID} | VQ cycle failed`, e);
      ui.notifications.error('VQ optimizer cycle failed. See console.');
      this._appendLog(`[${nowISO()}] VQ cycle failed: ${e?.message ?? e}`);
    } finally {
      if (btn) btn.disabled = false;
      if (this._logLines.length > 300) this._logLines = this._logLines.slice(-300);
      this._renderLog();
    }
  }

  /** Reset all VQ-applied optimizer state (client + persistence + settings). */
  async _onVQReset() {
    const ok = await Dialog.confirm({
      title: 'Reset VQ Optimizer',
      content: '<p>Clear all VQ-applied optimizer settings for this user on this device?</p>'
    });
    if (!ok) return;

    const host = getOptimizerHost();
    if (host) {
      try {
        host.settings = {};
        host.disabled.clear();
        await host.saveNow(); // persists a valid, empty record over the old one
      } catch (e) {
        console.warn(`${MODULE_ID} | VQ reset persist failed`, e);
      }
    }

    this._appendLog(`[${nowISO()}] VQ: applied settings reset`);
    ui.notifications.info('VQ optimizer settings reset');
  }
}
