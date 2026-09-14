/**
 * RNK Vortex System Optimizer
 * Database optimization utility - NO CLEANUP of external files
 */

(() => {
  'use strict';

  const MODULE_ID = 'rnk-vortex-system-optimizer';

  function _raiseCoreMaxFPSCeiling(desired) {
    try {
      const d = Number(desired);
      if (!Number.isFinite(d) || d <= 0) return false;

      const setting = game?.settings?.settings?.get?.('core.maxFPS');
      if (!setting) return false;

      let changed = false;

      // Foundry versions vary: sometimes the setting uses range, sometimes the
      // underlying NumberField has min/max in its options.
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

  function _isSettingRegistered(key) {
    try {
      return !!game?.settings?.settings?.has?.(`${MODULE_ID}.${key}`);
    } catch (_e) {
      return false;
    }
  }

  function _isMenuRegistered(menuKey) {
    try {
      return !!game?.settings?.menus?.has?.(`${MODULE_ID}.${menuKey}`);
    } catch (_e) {
      return false;
    }
  }

  function registerOptimizerSettings() {
    if (!game?.settings?.register) return;

    // Menu entry (idempotent)
    if (!_isMenuRegistered('optimizerMenu')) {
      try {
        game.settings.registerMenu(MODULE_ID, 'optimizerMenu', {
          name: 'Open System Optimizer',
          label: 'Open Optimizer',
          hint: 'Opens the RNK Vortex System Optimizer window.',
          icon: 'fas fa-tachometer-alt',
          type: RNKSystemOptimizerApp,
          restricted: true
        });

        if (!globalThis.__RNK_OPTIMIZER_MENU_LOGGED) {
          globalThis.__RNK_OPTIMIZER_MENU_LOGGED = true;
          console.log(`${MODULE_ID} | Settings menu registered`);
        }
      } catch (e) {
        // Non-fatal; settings can still register.
        console.warn(`${MODULE_ID} | registerMenu failed`, e);
      }
    }

    if (!_isSettingRegistered('doCleanupChat')) {
      game.settings.register(MODULE_ID, 'doCleanupChat', {
        name: 'Cleanup: Prune old chat messages',
        hint: 'Deletes chat messages older than the retention window.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
      });
    }

    if (!_isSettingRegistered('chatRetentionDays')) {
      game.settings.register(MODULE_ID, 'chatRetentionDays', {
        name: 'Cleanup: Chat retention (days)',
        hint: 'Messages older than this will be deleted when optimization runs.',
        scope: 'world',
        config: true,
        type: Number,
        default: 30
      });
    }

    if (!_isSettingRegistered('doCleanupInactiveCombats')) {
      game.settings.register(MODULE_ID, 'doCleanupInactiveCombats', {
        name: 'Cleanup: Delete inactive combats',
        hint: 'Deletes combats that are not started and have no turns.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
      });
    }

    if (!_isSettingRegistered('doRebuildCompendiumIndexes')) {
      game.settings.register(MODULE_ID, 'doRebuildCompendiumIndexes', {
        name: 'Compendiums: Rebuild indexes',
        hint: 'Warms/rebuilds all compendium indexes.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
      });
    }

    if (!_isSettingRegistered('doCorePerformanceTweaks')) {
      game.settings.register(MODULE_ID, 'doCorePerformanceTweaks', {
        name: 'Performance: Apply core tweaks',
        hint: 'Applies a small set of core performance tweaks (max FPS, performance mode, soft shadows if available).',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
      });
    }

    // Back-compat: if you previously used/expect optimizeOnStartup, keep it.
    if (!_isSettingRegistered('optimizeOnStartup')) {
      game.settings.register(MODULE_ID, 'optimizeOnStartup', {
        name: 'Auto-run on startup',
        hint: 'Run the optimizer automatically when the world loads (GM only).',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
      });
    }
  }

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const idx = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / Math.pow(1024, idx);
  return `${value.toFixed(value >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function nowISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

class RNKSystemOptimizerService {
  constructor({ logFn } = {}) {
    this._logFn = typeof logFn === 'function' ? logFn : null;
  }

  log(message) {
    const line = `[${nowISO()}] ${message}`;
    if (this._logFn) this._logFn(line);
    console.log(`${MODULE_ID} | ${message}`);
  }

  async dryRun(options) {
    const report = {
      cleanup: { chat: { enabled: !!options.doCleanupChat, wouldDelete: 0, olderThan: null }, combats: { enabled: !!options.doCleanupInactiveCombats, wouldDelete: 0 } },
      compendiums: { enabled: !!options.doRebuildCompendiumIndexes, packs: 0 },
      performance: { enabled: !!options.doCorePerformanceTweaks, changes: [] },
      notes: []
    };

    if (options.doCleanupChat) {
      const days = Number(options.chatRetentionDays) || 30;
      const cutoff = Date.now() - (days * 24 * 60 * 60 * 1000);
      report.cleanup.chat.olderThan = new Date(cutoff).toISOString();

      try {
        // Foundry chat collection can be huge; filter on in-memory docs but avoid iterating message content.
        const docs = game.messages?.contents ?? [];
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
        const combats = game.combats?.contents ?? [];
        report.cleanup.combats.wouldDelete = combats.reduce((acc, c) => {
          const isActive = !!c?.started;
          const hasTurns = Array.isArray(c?.turns) ? c.turns.length > 0 : false;
          // Conservative: delete only combats that are not started and have no turns.
          return acc + (!isActive && !hasTurns ? 1 : 0);
        }, 0);
      } catch (e) {
        report.notes.push('Could not count inactive combats.');
      }
    }

    if (options.doRebuildCompendiumIndexes) {
      try {
        report.compendiums.packs = Array.from(game.packs?.values?.() ?? []).length;
      } catch (e) {
        report.notes.push('Could not enumerate compendium packs.');
      }
    }

    if (options.doCorePerformanceTweaks) {
      report.performance.changes = this._previewCorePerformanceChanges();
    }

    return report;
  }

  _previewCorePerformanceChanges() {
    const changes = [];

    const maxFPSKey = game.settings.settings?.get('core.maxFPS') ? 'core.maxFPS' : null;
    if (maxFPSKey) {
      const current = game.settings.get('core', 'maxFPS');
      // Do not cap FPS. Raise the ceiling if the core setting allows it.
      // Note: Some Foundry builds cap core.maxFPS at 60 via setting range/choices.
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
      if (typeof current === 'number' && current < next) changes.push({ setting: 'core.maxFPS', from: current, to: next });
    }

    const softShadowsKey = game.settings.settings?.get('core.softShadows') ? 'core.softShadows' : null;
    if (softShadowsKey) {
      const current = game.settings.get('core', 'softShadows');
      const next = false;
      if (typeof current === 'boolean' && current !== next) changes.push({ setting: 'core.softShadows', from: current, to: next });
    }

    return changes;
  }

  async optimize(options, { dryRun = false } = {}) {
    if (!game.user?.isGM) {
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
      await this._applyCorePerformanceTweaks(report);
    }

    // Record an observed RAF FPS on the client to help diagnose "stuck at 60" complaints.
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
    const all = game.messages?.contents ?? [];
    const ids = all
      .filter(m => (m?.timestamp ?? 0) > 0 && (m.timestamp < cutoff))
      .map(m => m.id)
      .filter(Boolean);

    if (!ids.length) {
      this.log('Cleanup: No old chat messages to delete');
      return;
    }

    this.log(`Cleanup: Deleting ${ids.length} chat messages older than ${days} days`);
    const batchSize = 100;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      // Static deletion is more efficient than doc.delete() per message
      await ChatMessage.deleteDocuments(batch);
    }
    report.cleanup.chat.deleted = ids.length;
  }

  async _cleanupCombats(report) {
    const combats = game.combats?.contents ?? [];
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
    const batchSize = 50;
    for (let i = 0; i < ids.length; i += batchSize) {
      const batch = ids.slice(i, i + batchSize);
      await Combat.deleteDocuments(batch);
    }
    report.cleanup.combats.deleted = ids.length;
  }

  async _rebuildCompendiumIndexes(report) {
    const packs = Array.from(game.packs?.values?.() ?? []);
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

  async _applyCorePerformanceTweaks(report) {
    // Best-effort: some Foundry builds clamp core.maxFPS (often to 60) at the
    // settings schema level. If so, try to lift the ceiling before previewing.
    const desiredCoreFPS = 120;
    _raiseCoreMaxFPSCeiling(desiredCoreFPS);

    const planned = this._previewCorePerformanceChanges();

    // Even if Foundry's core.maxFPS setting is capped (often 60), we can still
    // raise the PIXI ticker maxFPS ceiling so the client can render up to the
    // monitor refresh rate (e.g. 100Hz) when the environment allows it.
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
      if (report.performance.tickerMaxFPS) this.log(`Performance: Ticker maxFPS is ${report.performance.tickerMaxFPS}`);
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

        // Best-effort: apply FPS cap immediately to the PIXI ticker.
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
        // Some worlds/modules can throw during settings application due to render hooks.
        // Treat this as non-fatal so the optimizer can complete other work.
        const msg = e?.message ?? String(e);
        failed.push({ ...change, error: msg });
        this.log(`Performance: Failed to apply ${change.setting}: ${msg}`);
      }
    }
    if (applied.length) report.performance.applied = applied;
    if (failed.length) report.performance.failed = failed;
    if (report.performance.tickerMaxFPS) this.log(`Performance: Ticker maxFPS is ${report.performance.tickerMaxFPS}`);
  }
}

class RNKSystemOptimizerApp extends FormApplication {
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
    this._service = new RNKSystemOptimizerService({
      logFn: (line) => {
        this._logLines.push(line);
        if (this._logLines.length > 300) this._logLines.shift();
        this._renderLog();
      }
    });
  }

  async getData(options) {
    const world = (k) => game.settings.get(MODULE_ID, k);
    return {
      doCleanupChat: world('doCleanupChat'),
      chatRetentionDays: world('chatRetentionDays'),
      doCleanupInactiveCombats: world('doCleanupInactiveCombats'),
      doRebuildCompendiumIndexes: world('doRebuildCompendiumIndexes'),
      doCorePerformanceTweaks: world('doCorePerformanceTweaks'),
      log: this._logLines.join('\n')
    };
  }

  // FormApplication requirement
  async _updateObject(_event, _formData) {
    // No-op: we persist changes immediately on input change.
  }

  activateListeners(html) {
    super.activateListeners(html);

    // Foundry versions vary: sometimes `html` is a jQuery object, sometimes it's
    // a plain HTMLElement. Use event delegation on the root element.
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
    });

    root.addEventListener('click', (ev) => {
      const btn = ev?.target?.closest?.('[data-action]');
      const action = btn?.dataset?.action;
      if (!action) return;

      if (action === 'dryRun') return this._onDryRun();
      if (action === 'run') return this._onRun();
      if (action === 'close') return this.close();
    });
  }

  async _setSetting(key, value) {
    try {
      await game.settings.set(MODULE_ID, key, value);
    } catch (e) {
      ui.notifications.error(`Failed to save setting: ${key}`);
      console.error(`${MODULE_ID} | setting error`, e);
    }
  }

  _getOptionsFromSettings() {
    const world = (k) => game.settings.get(MODULE_ID, k);
    return {
      doCleanupChat: world('doCleanupChat'),
      chatRetentionDays: world('chatRetentionDays'),
      doCleanupInactiveCombats: world('doCleanupInactiveCombats'),
      doRebuildCompendiumIndexes: world('doRebuildCompendiumIndexes'),
      doCorePerformanceTweaks: world('doCorePerformanceTweaks')
    };
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
      const report = await this._service.dryRun(this._getOptionsFromSettings());
      this._logLines.push(`[${nowISO()}] Dry Run: chat would delete ${report.cleanup.chat.wouldDelete ?? 0}`);
      this._logLines.push(`[${nowISO()}] Dry Run: combats would delete ${report.cleanup.combats.wouldDelete ?? 0}`);
      if (report.compendiums.enabled) this._logLines.push(`[${nowISO()}] Dry Run: would index ${report.compendiums.packs} compendium packs`);
      if (report.performance.enabled) {
        const changes = report.performance.changes ?? [];
        if (!changes.length) this._logLines.push(`[${nowISO()}] Dry Run: no core performance changes needed`);
        else for (const c of changes) this._logLines.push(`[${nowISO()}] Dry Run: ${c.setting} ${c.from} -> ${c.to}`);
      }
      if (Array.isArray(report.notes) && report.notes.length) {
        for (const note of report.notes) this._logLines.push(`[${nowISO()}] Note: ${note}`);
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

    const options = this._getOptionsFromSettings();
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
}

Hooks.once('init', () => {
  console.log(`${MODULE_ID} | Initializing`);

  registerOptimizerSettings();

  // Always emit a one-time status line so logs are conclusive even if the menu was registered previously.
  if (!globalThis.__RNK_OPTIMIZER_INIT_STATUS_LOGGED) {
    globalThis.__RNK_OPTIMIZER_INIT_STATUS_LOGGED = true;
    const menuKey = `${MODULE_ID}.optimizerMenu`;
    const hasMenu = !!game?.settings?.menus?.has?.(menuKey);
    const keys = ['doCleanupChat', 'chatRetentionDays', 'doCleanupInactiveCombats', 'doRebuildCompendiumIndexes', 'doCorePerformanceTweaks', 'optimizeOnStartup'];
    const missing = keys.filter(k => !_isSettingRegistered(k));
    console.log(`${MODULE_ID} | Init status: menu=${hasMenu ? 'ok' : 'missing'} settingsMissing=${missing.length ? missing.join(',') : 'none'}`);
  }

  // Expose app for macros / debugging
  globalThis.RNKSystemOptimizerApp = RNKSystemOptimizerApp;
});

Hooks.once('ready', async () => {
  if (!game.user?.isGM) return;

  // Safety: legacy module scripts can load after init; ensure settings exist before reading.
  registerOptimizerSettings();

  if (!globalThis.__RNK_OPTIMIZER_READY_STATUS_LOGGED) {
    globalThis.__RNK_OPTIMIZER_READY_STATUS_LOGGED = true;
    const menuKey = `${MODULE_ID}.optimizerMenu`;
    const hasMenu = !!game?.settings?.menus?.has?.(menuKey);
    console.log(`${MODULE_ID} | Ready status: menu=${hasMenu ? 'ok' : 'missing'} GM=${game.user?.isGM ? 'yes' : 'no'}`);
  }

  let runOnStartup = false;
  try {
    runOnStartup = !!game.settings.get(MODULE_ID, 'optimizeOnStartup');
  } catch (e) {
    console.warn(`${MODULE_ID} | optimizeOnStartup setting missing; skipping autorun`, e);
  }

  if (runOnStartup) {
    const service = new RNKSystemOptimizerService();
    service.optimize({
      doCleanupChat: game.settings.get(MODULE_ID, 'doCleanupChat'),
      chatRetentionDays: game.settings.get(MODULE_ID, 'chatRetentionDays'),
      doCleanupInactiveCombats: game.settings.get(MODULE_ID, 'doCleanupInactiveCombats'),
      doRebuildCompendiumIndexes: game.settings.get(MODULE_ID, 'doRebuildCompendiumIndexes'),
      doCorePerformanceTweaks: game.settings.get(MODULE_ID, 'doCorePerformanceTweaks')
    }).catch((e) => {
      console.error(`${MODULE_ID} | startup optimize failed`, e);
    });
  }

  // Apply a best-effort ticker FPS ceiling on every load when performance tweaks are enabled.
  try {
    const doPerf = !!game.settings.get(MODULE_ID, 'doCorePerformanceTweaks');
    if (doPerf && globalThis.canvas?.app?.ticker) {
      // Try to lift Foundry's core FPS ceiling if it's clamped.
      const desiredCoreFPS = 120;
      _raiseCoreMaxFPSCeiling(desiredCoreFPS);
      try {
        const currentCore = Number(game.settings.get('core', 'maxFPS'));
        if (Number.isFinite(currentCore) && currentCore < desiredCoreFPS) {
          await game.settings.set('core', 'maxFPS', desiredCoreFPS);
        }
        console.log(`${MODULE_ID} | core.maxFPS=${game.settings.get('core', 'maxFPS')}`);
      } catch (_e) {
        // ignore
      }

      const desiredTickerFPS = 120;
      const currentTicker = Number(globalThis.canvas.app.ticker.maxFPS) || 0;
      if (currentTicker < desiredTickerFPS) {
        globalThis.canvas.app.ticker.maxFPS = desiredTickerFPS;
      }
      console.log(`${MODULE_ID} | Ticker maxFPS=${globalThis.canvas.app.ticker.maxFPS}`);
    }
  } catch (_e) {
    // ignore
  }
});

// Add a convenient tool in the existing Token controls.
Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user?.isGM) return;

  // Foundry v13+ may pass a non-array object; support common shapes.
  const controlsArr = Array.isArray(controls)
    ? controls
    : (Array.isArray(controls?.controls)
      ? controls.controls
      : (Array.isArray(controls?.sceneControls)
        ? controls.sceneControls
        : (typeof controls?.find === 'function' ? controls : null)));
  if (!controlsArr) return;

  const tokenControls = controlsArr.find(c => c?.name === 'token');
  if (!tokenControls) return;

  if (!Array.isArray(tokenControls.tools)) tokenControls.tools = [];
  const already = tokenControls.tools.some(t => t?.name === 'rnk-system-optimizer');
  if (already) {
    if (!globalThis.__RNK_OPTIMIZER_TOOL_LOGGED) {
      globalThis.__RNK_OPTIMIZER_TOOL_LOGGED = true;
      console.log(`${MODULE_ID} | Scene controls tool present`);
    }
    return;
  }

  tokenControls.tools.push({
    name: 'rnk-system-optimizer',
    title: 'System Optimizer',
    icon: 'fas fa-tachometer-alt',
    onClick: () => {
      try {
        const app = new RNKSystemOptimizerApp();
        const r = app.render(true);
        Promise.resolve(r).catch((e) => {
          console.error(`${MODULE_ID} | render failed`, e);
          ui.notifications.error('Optimizer UI failed to load. Check console for missing template/CSS.');
        });
      } catch (e) {
        console.error(`${MODULE_ID} | open failed`, e);
        ui.notifications.error('Optimizer failed to open. Check console.');
      }
    },
    button: true
  });

  if (!globalThis.__RNK_OPTIMIZER_TOOL_LOGGED) {
    globalThis.__RNK_OPTIMIZER_TOOL_LOGGED = true;
    console.log(`${MODULE_ID} | Scene controls tool injected`);
  }
});

})();

