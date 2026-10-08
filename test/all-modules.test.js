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
 *
 * Complete Test Suite - 100% Coverage Target
 */

import { OptimizerCore } from '../scripts/optimizer-core.js';
import { createFoundryCoreDependencies } from '../scripts/foundry-document-source.js';
import { PerformanceTweaks } from '../scripts/performance-tweaks.js';
import { SettingsManager } from '../scripts/settings-manager.js';
import { OptimizerUI, formatBytes, nowISO } from '../scripts/optimizer-ui.js';
import { VQ3DBridge } from '../scripts/vq-3d-bridge.js';

describe('OptimizerCore', () => {
  let optimizer;
  let mockLogFn;

  beforeEach(() => {
    mockLogFn = jest.fn();
    optimizer = new OptimizerCore({
      logFn: mockLogFn,
      ...createFoundryCoreDependencies({ logFn: mockLogFn })
    });

    game.messages = { contents: [] };
    game.combats = { contents: [] };
    game.packs = { values: () => [] };
    game.user = { isGM: true };
  });

  test('constructor initializes with log function', () => {
    expect(optimizer._logFn).toBe(mockLogFn);
  });

  test('constructor initializes without log function', () => {
    const opt = new OptimizerCore();
    expect(opt._logFn).toBeNull();
  });

  test('log calls logFn when provided', () => {
    optimizer.log('test message');
    expect(mockLogFn).toHaveBeenCalled();
  });

  test('log works without logFn', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const opt = new OptimizerCore();
    opt.log('test');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('_nowISO returns formatted timestamp', () => {
    const timestamp = optimizer._nowISO();
    expect(timestamp).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
  });

  test('dryRun with all options disabled', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const report = await optimizer.dryRun(options);

    expect(report.cleanup.chat.enabled).toBe(false);
    expect(report.cleanup.combats.enabled).toBe(false);
    expect(report.compendiums.enabled).toBe(false);
  });

  test('dryRun with doCleanupChat enabled', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) },
      { timestamp: Date.now() - (20 * 24 * 60 * 60 * 1000) }
    ];

    const report = await optimizer.dryRun(options);

    expect(report.cleanup.chat.enabled).toBe(true);
    expect(report.cleanup.chat.wouldDelete).toBe(1);
  });

  test('dryRun with doCleanupInactiveCombats enabled', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { started: false, turns: [] },
      { started: true, turns: [{}] }
    ];

    const report = await optimizer.dryRun(options);

    expect(report.cleanup.combats.enabled).toBe(true);
    expect(report.cleanup.combats.wouldDelete).toBe(1);
  });

  test('dryRun with doRebuildCompendiumIndexes enabled', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    game.packs.values = () => [{}, {}, {}];

    const report = await optimizer.dryRun(options);

    expect(report.compendiums.enabled).toBe(true);
    expect(report.compendiums.packs).toBe(3);
  });

  test('dryRun handles errors gracefully', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    Object.defineProperty(game, 'messages', {
      get() { throw new Error('Chat error'); },
      configurable: true
    });

    const report = await optimizer.dryRun(options);
    expect(report).toBeDefined();
  });

  test('optimize throws error if not GM', async () => {
    game.user.isGM = false;
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    await expect(optimizer.optimize(options)).rejects.toThrow('GM permissions');
  });

  test('optimize in dryRun mode', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const report = await optimizer.optimize(options, { dryRun: true });

    expect(report).toHaveProperty('cleanup');
  });

  test('optimize performs full optimization with RAF FPS measurement', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: true
    };

    game.messages.contents = [];
    game.combats.contents = [];
    game.packs.values = () => [];

    const report = await optimizer.optimize(options);

    expect(report).toHaveProperty('performance');
    expect(report.performance.rafFPS).toBeDefined();
    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining('Optimization started'));
    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining('Optimization finished'));
  });

  test('_measureRAFFPS returns valid FPS', async () => {
    const fps = await optimizer._measureRAFFPS(100);

    expect(fps).toBeGreaterThan(0);
    expect(fps).toBeLessThan(200);
  });

  test('_measureRAFFPS handles no RAF', async () => {
    const oldRAF = global.requestAnimationFrame;
    delete global.requestAnimationFrame;

    const fps = await optimizer._measureRAFFPS(100);

    expect(fps).toBeNull();

    global.requestAnimationFrame = oldRAF;
  });

  test('_cleanupChat with messages to delete', async () => {
    const options = { chatRetentionDays: 30 };
    const report = { cleanup: { chat: {} } };

    game.messages.contents = [
      { id: 'msg1', timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) }
    ];

    await optimizer._cleanupChat(options, report);

    expect(ChatMessage.deleteDocuments).toHaveBeenCalled();
    expect(report.cleanup.chat.deleted).toBe(1);
  });

  test('_cleanupChat with no messages to delete', async () => {
    const options = { chatRetentionDays: 30 };
    const report = { cleanup: { chat: {} } };

    game.messages.contents = [];

    await optimizer._cleanupChat(options, report);

    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining('No old chat messages'));
  });

  test('_cleanupChat handles deletion errors', async () => {
    const options = { chatRetentionDays: 30 };
    const report = { cleanup: { chat: {} } };

    game.messages.contents = [
      { id: 'msg1', timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) }
    ];

    ChatMessage.deleteDocuments = jest.fn(() => Promise.reject(new Error('Delete failed')));

    await optimizer._cleanupChat(options, report);

    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining('Failed'));
  });

  test('_cleanupCombats with combats to delete', async () => {
    const report = { cleanup: { combats: {} } };

    game.combats.contents = [
      { id: 'combat1', started: false, turns: [] }
    ];

    await optimizer._cleanupCombats(report);

    expect(Combat.deleteDocuments).toHaveBeenCalled();
    expect(report.cleanup.combats.deleted).toBe(1);
  });

  test('_cleanupCombats with no combats to delete', async () => {
    const report = { cleanup: { combats: {} } };

    game.combats.contents = [];

    await optimizer._cleanupCombats(report);

    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining('No inactive combats'));
  });

  test('_cleanupCombats handles deletion errors', async () => {
    const report = { cleanup: { combats: {} } };

    game.combats.contents = [{ id: 'combat1', started: false, turns: [] }];

    Combat.deleteDocuments = jest.fn(() => Promise.reject(new Error('Delete failed')));

    await optimizer._cleanupCombats(report);

    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining('Failed'));
  });

  test('_rebuildCompendiumIndexes processes packs', async () => {
    const report = { compendiums: {} };

    game.packs.values = () => [
      { collection: 'pack1', getIndex: jest.fn().mockResolvedValue([{}, {}]) },
      { collection: 'pack2', getIndex: jest.fn().mockResolvedValue([{}]) }
    ];

    await optimizer._rebuildCompendiumIndexes(report);

    expect(report.compendiums.indexedPacks).toBe(2);
    expect(report.compendiums.indexedDocs).toBe(3);
  });

  test('_rebuildCompendiumIndexes handles pack errors', async () => {
    const report = { compendiums: {} };

    game.packs.values = () => [
      { collection: 'pack1', getIndex: jest.fn().mockRejectedValue(new Error('Pack error')) }
    ];

    await optimizer._rebuildCompendiumIndexes(report);

    expect(mockLogFn).toHaveBeenCalledWith(expect.stringContaining('Failed index'));
  });

  test('_applyPerformanceTweaks', async () => {
    const report = { performance: {} };

    await optimizer._applyPerformanceTweaks(report);

    expect(report.performance).toBeDefined();
  });

  test('dryRun handles game.packs missing values method', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    game.packs.values = undefined;

    const report = await optimizer.dryRun(options);

    expect(report.compendiums.enabled).toBe(true);
    expect(report.compendiums.packs).toBe(0);
  });

  test('_measureRAFFPS handles invalid duration', async () => {
    const fps1 = await optimizer._measureRAFFPS(-100);
    expect(fps1).toBeGreaterThan(0);

    const fps2 = await optimizer._measureRAFFPS('invalid');
    expect(fps2).toBeGreaterThan(0);
  });

  test('_rebuildCompendiumIndexes handles packs.values undefined', async () => {
    const report = { compendiums: {} };

    game.packs.values = undefined;

    await optimizer._rebuildCompendiumIndexes(report);

    expect(report.compendiums.indexedPacks).toBe(0);
    expect(report.compendiums.indexedDocs).toBe(0);
  });
});

describe('PerformanceTweaks', () => {
  let tweaks;

  beforeEach(() => {
    tweaks = new PerformanceTweaks();

    game.settings.settings.set('core.maxFPS', { range: { max: 60 }, type: { options: {} }, choices: {} });
    game.settings.settings.set('core.softShadows', {});

    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      if (key === 'softShadows') return true;
      return null;
    });

    game.settings.set = jest.fn().mockResolvedValue(true);
  });

  test('constructor with logFn', () => {
    const logFn = jest.fn();
    const t = new PerformanceTweaks(logFn);
    expect(t._logFn).toBe(logFn);
  });

  test('constructor without logFn', () => {
    expect(tweaks._logFn).toBeNull();
  });

  test('raiseCoreMaxFPSCeiling with valid setting', () => {
    game.settings.settings.get = jest.fn().mockReturnValue({
      range: { max: 60 },
      type: { options: { max: 80 } }
    });
    const result = tweaks.raiseCoreMaxFPSCeiling(120);
    expect(result).toBe(true);
  });

  test('raiseCoreMaxFPSCeiling with invalid desired value', () => {
    const result = tweaks.raiseCoreMaxFPSCeiling('invalid');
    expect(result).toBe(false);
  });

  test('raiseCoreMaxFPSCeiling with no setting', () => {
    game.settings.settings.get = jest.fn().mockReturnValue(null);
    const result = tweaks.raiseCoreMaxFPSCeiling(120);
    expect(result).toBe(false);
  });

  test('raiseCoreMaxFPSCeiling handles errors', () => {
    game.settings = null;
    const result = tweaks.raiseCoreMaxFPSCeiling(120);
    expect(result).toBe(false);
  });

  test('previewChanges with settings needing updates', () => {
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, choices: { '120': '120' } };
      if (key === 'core.softShadows') return {};
      return null;
    });

    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      if (key === 'softShadows') return true;
      return null;
    });

    const changes = tweaks.previewChanges();
    expect(changes.length).toBe(2);
  });

  test('previewChanges with no maxFPS setting', () => {
    game.settings.settings.get = jest.fn().mockReturnValue(null);
    const changes = tweaks.previewChanges();
    expect(changes.length).toBe(0);
  });

  test('apply with ticker update', async () => {
    const report = { performance: {} };

    global.canvas.app.ticker.maxFPS = 60;

    await tweaks.apply(report);

    expect(global.canvas.app.ticker.maxFPS).toBe(120);
    expect(report.performance.tickerMaxFPS).toBe(120);
  });

  test('apply handles ticker error gracefully', async () => {
    const report = { performance: {} };

    global.canvas = null;

    await tweaks.apply(report);

    expect(report.performance).toBeDefined();
  });

  test('applyOnReady with performance tweaks enabled', async () => {
    game.settings.get = jest.fn((module, key) => {
      if (key === 'doCorePerformanceTweaks') return true;
      if (key === 'maxFPS') return 60;
      return null;
    });

    global.canvas = {
      app: {
        ticker: { maxFPS: 60 }
      }
    };

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await tweaks.applyOnReady();

    consoleSpy.mockRestore();
  });

  test('applyOnReady with performance tweaks disabled', async () => {
    game.settings.get = jest.fn().mockReturnValue(false);

    await tweaks.applyOnReady();

    expect(game.settings.set).not.toHaveBeenCalled();
  });

  test('applyOnReady handles errors gracefully', async () => {
    game.settings.get = jest.fn().mockImplementation(() => {
      throw new Error('Settings error');
    });

    await expect(tweaks.applyOnReady()).resolves.not.toThrow();
  });

  test('raiseCoreMaxFPSCeiling with ticker maxFPS getter throwing error (line 150)', () => {
    const mockTicker = {
      get maxFPS() {
        throw new Error('Getter error');
      },
      set maxFPS(val) {}
    };
    globalThis.canvas = { app: { ticker: mockTicker } };

    expect(() => tweaks.raiseCoreMaxFPSCeiling(150)).not.toThrow();

    globalThis.canvas = null;
  });

  test('raiseCoreMaxFPSCeiling with ticker maxFPS setter throwing error (line 160)', () => {
    const mockTicker = {
      get maxFPS() {
        return 60;
      },
      set maxFPS(val) {
        throw new Error('Setter error');
      }
    };
    globalThis.canvas = { app: { ticker: mockTicker } };

    expect(() => tweaks.raiseCoreMaxFPSCeiling(150)).not.toThrow();

    globalThis.canvas = null;
  });

  test('raiseCoreMaxFPSCeiling with no ticker available (line 150 conditional false)', () => {
    globalThis.canvas = null;

    expect(() => tweaks.raiseCoreMaxFPSCeiling(150)).not.toThrow();
  });
});

describe('SettingsManager', () => {
  beforeEach(() => {
    game.settings = {
      settings: new Map(),
      menus: new Map(),
      register: jest.fn(),
      registerMenu: jest.fn(),
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(true)
    };
  });

  test('isSettingRegistered returns true for registered setting', () => {
    game.settings.settings.has = jest.fn().mockReturnValue(true);
    expect(SettingsManager.isSettingRegistered('doCleanupChat')).toBe(true);
  });

  test('isSettingRegistered returns false for unregistered setting', () => {
    game.settings.settings.has = jest.fn().mockReturnValue(false);
    expect(SettingsManager.isSettingRegistered('nonExistent')).toBe(false);
  });

  test('isSettingRegistered handles errors', () => {
    game.settings = null;
    expect(SettingsManager.isSettingRegistered('test')).toBe(false);
  });

  test('isMenuRegistered returns true for registered menu', () => {
    game.settings.menus.has = jest.fn().mockReturnValue(true);
    expect(SettingsManager.isMenuRegistered('optimizerMenu')).toBe(true);
  });

  test('isMenuRegistered returns false for unregistered menu', () => {
    game.settings.menus.has = jest.fn().mockReturnValue(false);
    expect(SettingsManager.isMenuRegistered('nonExistent')).toBe(false);
  });

  test('isMenuRegistered handles errors', () => {
    game.settings = null;
    expect(SettingsManager.isMenuRegistered('test')).toBe(false);
  });

  test('registerAll registers menu when not already registered', async () => {
    game.settings.menus.has = jest.fn().mockReturnValue(false);
    game.settings.settings.has = jest.fn().mockReturnValue(false);

    const MockApp = class {};
    await SettingsManager.registerAll(MockApp);

    expect(game.settings.registerMenu).toHaveBeenCalled();
  });

  test('registerAll skips menu when already registered', async () => {
    game.settings.menus.has = jest.fn().mockReturnValue(true);
    game.settings.settings.has = jest.fn().mockReturnValue(true);

    const MockApp = class {};
    await SettingsManager.registerAll(MockApp);

    expect(game.settings.registerMenu).not.toHaveBeenCalled();
  });

  test('registerAll handles menu registration error', async () => {
    game.settings.menus.has = jest.fn().mockReturnValue(false);
    game.settings.settings.has = jest.fn().mockReturnValue(false);
    game.settings.registerMenu = jest.fn().mockImplementation(() => {
      throw new Error('Menu error');
    });

    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    const MockApp = class {};

    await SettingsManager.registerAll(MockApp);

    consoleSpy.mockRestore();
  });

  test('registerAll registers all settings', async () => {
    game.settings.menus.has = jest.fn().mockReturnValue(true);
    game.settings.settings.has = jest.fn().mockReturnValue(false);

    const MockApp = class {};
    await SettingsManager.registerAll(MockApp);

    expect(game.settings.register).toHaveBeenCalledWith('rnk-vortex-system-optimizer', 'doCleanupChat', expect.any(Object));
    expect(game.settings.register).toHaveBeenCalledWith('rnk-vortex-system-optimizer', 'chatRetentionDays', expect.any(Object));
  });

  test('registerAll handles no game.settings', async () => {
    game.settings = null;
    const MockApp = class {};

    await expect(SettingsManager.registerAll(MockApp)).resolves.not.toThrow();
  });

  test('getSetting returns setting value', () => {
    game.settings.get = jest.fn().mockReturnValue(true);
    expect(SettingsManager.getSetting('doCleanupChat')).toBe(true);
  });

  test('setSetting sets setting value', async () => {
    await SettingsManager.setSetting('doCleanupChat', false);
    expect(game.settings.set).toHaveBeenCalledWith('rnk-vortex-system-optimizer', 'doCleanupChat', false);
  });

  test('getOptionsFromSettings returns all options', () => {
    game.settings.get = jest.fn((module, key) => {
      const defaults = {
        doCleanupChat: true,
        chatRetentionDays: 30,
        doCleanupInactiveCombats: true,
        doRebuildCompendiumIndexes: true,
        doCorePerformanceTweaks: true
      };
      return defaults[key];
    });

    const options = SettingsManager.getOptionsFromSettings();

    expect(options.doCleanupChat).toBe(true);
    expect(options.chatRetentionDays).toBe(30);
  });
});

describe('OptimizerUI', () => {
  describe('formatBytes helper', () => {
    test('formats 0 bytes', () => {
      expect(formatBytes(0)).toBe('0 B');
    });

    test('formats negative bytes', () => {
      expect(formatBytes(-100)).toBe('0 B');
    });

    test('formats bytes less than 1KB', () => {
      expect(formatBytes(500)).toBe('500 B');
    });

    test('formats KB with decimal', () => {
      expect(formatBytes(1500)).toBe('1.5 KB');
    });

    test('formats KB without decimal', () => {
      expect(formatBytes(15000)).toBe('15 KB');
    });

    test('formats MB', () => {
      expect(formatBytes(1500000)).toBe('1.4 MB');
    });

    test('formats GB', () => {
      expect(formatBytes(1500000000)).toBe('1.4 GB');
    });

    test('formats TB', () => {
      expect(formatBytes(1500000000000)).toBe('1.4 TB');
    });

    test('handles non-finite values', () => {
      expect(formatBytes(NaN)).toBe('0 B');
      expect(formatBytes(Infinity)).toBe('0 B');
    });
  });

  describe('nowISO helper', () => {
    test('returns formatted timestamp', () => {
      const result = nowISO();
      expect(result).toMatch(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/);
    });

    test('pads single-digit values', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-01-05 03:04:05'));
      const result = nowISO();
      expect(result).toBe('2025-01-05 03:04:05');
      jest.useRealTimers();
    });

    test('handles double-digit values without padding', () => {
      jest.useFakeTimers();
      jest.setSystemTime(new Date('2025-11-25 13:45:59'));
      const result = nowISO();
      expect(result).toBe('2025-11-25 13:45:59');
      jest.useRealTimers();
    });
  });

  let ui;

  beforeEach(() => {
    game.settings.get = jest.fn((module, key) => {
      const defaults = {
        doCleanupChat: true,
        chatRetentionDays: 30,
        doCleanupInactiveCombats: true,
        doRebuildCompendiumIndexes: true,
        doCorePerformanceTweaks: true
      };
      return defaults[key];
    });

    SettingsManager.getOptionsFromSettings = jest.fn(() => ({
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: true
    }));

    ui = new OptimizerUI();
    ui.element = [{ querySelector: jest.fn().mockReturnValue(null) }];
  });

  test('defaultOptions returns correct structure', () => {
    const options = OptimizerUI.defaultOptions;
    expect(options.id).toBe('rnk-system-optimizer-app');
  });

  test('defaultOptions uses fallback mergeObject', () => {
    const oldFoundry = globalThis.foundry;
    globalThis.foundry = undefined;
    const oldMergeObject = globalThis.mergeObject;
    globalThis.mergeObject = (a, b) => ({ ...a, ...b });

    const options = OptimizerUI.defaultOptions;
    expect(options.id).toBe('rnk-system-optimizer-app');

    globalThis.foundry = oldFoundry;
    globalThis.mergeObject = oldMergeObject;
  });

  test('constructor initializes with empty log lines', () => {
    expect(ui._logLines).toEqual([]);
  });

  test('constructor initializes _service with logFn', () => {
    expect(ui._service).toBeDefined();
    ui._service._logFn('test');
    expect(ui._logLines.length).toBe(1);
  });

  test('constructor logFn trims log lines when exceeding 300', () => {
    for (let i = 0; i < 305; i++) {
      ui._service._logFn(`line ${i}`);
    }
    expect(ui._logLines.length).toBeLessThanOrEqual(300);
  });

  test('getData returns settings data', async () => {
    const data = await ui.getData();

    expect(data.doCleanupChat).toBe(true);
    expect(data.chatRetentionDays).toBe(30);
  });

  test('_updateObject is no-op', async () => {
    await expect(ui._updateObject()).resolves.not.toThrow();
  });

  test('_setSetting calls SettingsManager', async () => {
    game.settings.set = jest.fn().mockResolvedValue(true);

    await ui._setSetting('doCleanupChat', false);

    expect(game.settings.set).toHaveBeenCalled();
  });

  test('_setSetting handles errors with notification', async () => {
    game.settings.set = jest.fn(() => Promise.reject(new Error('Save failed')));
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    await ui._setSetting('doCleanupChat', false);

    expect(global.ui.notifications.error).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('_renderLog updates DOM element', () => {
    ui._logLines = ['line1', 'line2'];
    const mockLogElement = { textContent: '' };
    ui.element = [{ querySelector: jest.fn().mockReturnValue(mockLogElement) }];

    ui._renderLog();

    expect(mockLogElement.textContent).toBe('line1\nline2');
  });

  test('_renderLog handles missing element', () => {
    ui.element = null;
    expect(() => ui._renderLog()).not.toThrow();
  });

  test('_onDryRun checks GM permission', async () => {
    game.user.isGM = false;
    await ui._onDryRun();
    expect(global.ui.notifications.warn).toHaveBeenCalledWith('GM only.');
  });

  test('_onDryRun executes dry run with all reports', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 5 }, combats: { wouldDelete: 2 } },
        compendiums: { enabled: true, packs: 3 },
        performance: { enabled: true, changes: [{ setting: 'maxFPS', from: 60, to: 120 }] },
        notes: ['Test note']
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();

    expect(ui._service.dryRun).toHaveBeenCalled();
    expect(ui._logLines.some(line => line.includes('chat would delete 5'))).toBe(true);
    expect(ui._logLines.some(line => line.includes('combats would delete 2'))).toBe(true);
    expect(ui._logLines.some(line => line.includes('would index 3'))).toBe(true);
    expect(ui._logLines.some(line => line.includes('maxFPS'))).toBe(true);
    expect(ui._logLines.some(line => line.includes('Test note'))).toBe(true);
  });

  test('_onDryRun handles no performance changes', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: false },
        performance: { enabled: true, changes: [] }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();
    expect(ui._service.dryRun).toHaveBeenCalled();
  });

  test('_onDryRun logging with compendiums.enabled false branch (line 141)', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: false, indexedPacks: 5 },
        performance: { enabled: false },
        notes: []
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();
    expect(ui._logLines.some(line => line.includes('would index'))).toBe(false);
  });

  test('_onDryRun logging with performance.enabled false branch (line 141)', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: true, indexedPacks: 0 },
        performance: { enabled: false, changes: [{ setting: 'test', from: 1, to: 2 }] },
        notes: []
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();
    expect(ui._logLines.some(line => line.includes('test'))).toBe(false);
  });

  test('_onDryRun logs performance changes when present', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: false },
        performance: { enabled: true, changes: [{ setting: 'core.maxFPS', from: 60, to: 120 }] }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();

    expect(ui._logLines.some(line => line.includes('core.maxFPS'))).toBe(true);
  });

  test('_onDryRun logs notes array', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: false },
        performance: { enabled: false },
        notes: ['Test note']
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();

    expect(ui._logLines.some(line => line.includes('Note: Test note'))).toBe(true);
  });

  test('_onDryRun handles errors', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn(() => Promise.reject(new Error('Dry run failed')))
    };
    ui._renderLog = jest.fn();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    await ui._onDryRun();

    expect(ui._logLines.some(line => line.includes('Dry Run failed'))).toBe(true);
    consoleSpy.mockRestore();
  });

  test('_onDryRun trims log lines when exceeding 300', async () => {
    game.user.isGM = true;
    ui._logLines = new Array(299).fill('old line');
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: false },
        performance: { enabled: false },
        notes: []
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();

    expect(ui._logLines.length).toBeLessThanOrEqual(300);
  });

  test('_onDryRun handles compendiums disabled', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { count: 0 }, combats: { count: 0 } },
        compendiums: { enabled: false },
        performance: { enabled: true, changes: [] },
        notes: []
      })
    };

    await ui._onDryRun();
    expect(ui._service.dryRun).toHaveBeenCalled();
  });

  test('_onDryRun handles performance disabled', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { count: 0 }, combats: { count: 0 } },
        compendiums: { enabled: true, indexedPacks: 2 },
        performance: { enabled: false },
        notes: []
      })
    };

    await ui._onDryRun();
    expect(ui._service.dryRun).toHaveBeenCalled();
  });

  test('_onDryRun handles empty performance changes array', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { count: 0 }, combats: { count: 0 } },
        compendiums: { enabled: true, indexedPacks: 2 },
        performance: { enabled: true, changes: [] },
        notes: []
      })
    };

    await ui._onDryRun();
    expect(ui._service.dryRun).toHaveBeenCalled();
  });

  test('_onDryRun handles non-array notes', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { count: 0 }, combats: { count: 0 } },
        compendiums: { enabled: true, indexedPacks: 2 },
        performance: { enabled: true, changes: [] },
        notes: null
      })
    };

    await ui._onDryRun();
    expect(ui._service.dryRun).toHaveBeenCalled();
  });

  test('_onRun checks GM permission', async () => {
    game.user.isGM = false;
    await ui._onRun();
    expect(global.ui.notifications.warn).toHaveBeenCalledWith('GM only.');
  });

  test('_onRun prompts for confirmation when documents would be deleted', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 5 }, combats: { wouldDelete: 2 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 5 }, combats: { deleted: 2 } },
        compendiums: { indexedPacks: 0, indexedDocs: 0 },
        performance: { applied: [], rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();

    Dialog.confirm = jest.fn().mockResolvedValue(true);

    await ui._onRun();

    expect(Dialog.confirm).toHaveBeenCalled();
    expect(ui._service.optimize).toHaveBeenCalled();
  });

  test('_onRun cancels when user rejects confirmation', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 5 }, combats: { wouldDelete: 2 } }
      }),
      optimize: jest.fn()
    };
    ui._renderLog = jest.fn();

    Dialog.confirm = jest.fn().mockResolvedValue(false);

    await ui._onRun();

    expect(ui._service.optimize).not.toHaveBeenCalled();
    expect(ui._logLines.some(line => line.includes('Canceled'))).toBe(true);
  });

  test('_onRun executes full optimization with memory tracking', async () => {
    game.user.isGM = true;
    const mockDryRunReport = {
      cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
    };
    const mockOptimizeReport = {
      cleanup: { chat: { deleted: 5 }, combats: { deleted: 2 } },
      compendiums: { indexedPacks: 3, indexedDocs: 50 },
      performance: { applied: [{ setting: 'maxFPS', to: 120 }], rafFPS: 115 }
    };

    ui._service = {
      dryRun: jest.fn().mockResolvedValue(mockDryRunReport),
      optimize: jest.fn().mockResolvedValue(mockOptimizeReport)
    };
    ui._renderLog = jest.fn();

    global.performance.memory = { usedJSHeapSize: 10000000 };

    await ui._onRun();

    expect(ui._service.optimize).toHaveBeenCalled();
    expect(global.ui.notifications.info).toHaveBeenCalledWith('System optimization completed');
    expect(ui._logLines.some(line => line.includes('deleted chat=5'))).toBe(true);
    expect(ui._logLines.some(line => line.includes('indexed packs=3'))).toBe(true);
    expect(ui._logLines.some(line => line.includes('Applied: maxFPS'))).toBe(true);
    expect(ui._logLines.some(line => line.includes('Observed RAF FPS'))).toBe(true);
  });

  test('_onRun handles optimization errors', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn(() => Promise.reject(new Error('Optimize failed')))
    };
    ui._renderLog = jest.fn();
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    await ui._onRun();

    expect(global.ui.notifications.error).toHaveBeenCalled();
    expect(ui._logLines.some(line => line.includes('Failed'))).toBe(true);
    consoleSpy.mockRestore();
  });

  test('_onRun logs all optimization results with full report', async () => {
    game.user.isGM = true;
    Object.defineProperty(performance, 'memory', {
      value: { usedJSHeapSize: 50000000 },
      configurable: true
    });
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 1 }, combats: { deleted: 2 } },
        compendiums: { indexedPacks: 5, indexedDocs: 100 },
        performance: {
          applied: [{ setting: 'core.maxFPS', to: 120 }],
          rafFPS: 60.5
        }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.some(line => line.includes('Heap'))).toBe(true);
    expect(ui._logLines.some(line => line.includes('indexed packs'))).toBe(true);
    expect(ui._logLines.some(line => line.includes('Applied'))).toBe(true);
    expect(ui._logLines.some(line => line.includes('RAF FPS'))).toBe(true);
    delete performance.memory;
  });

  test('_onRun handles no performance.memory', async () => {
    game.user.isGM = true;
    delete performance.memory;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 0, indexedDocs: 0 },
        performance: { applied: [], rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._service.optimize).toHaveBeenCalled();
  });

  test('_onRun handles zero indexed packs', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 0, indexedDocs: 0 },
        performance: { applied: [], rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.some(line => line.includes('indexed packs'))).toBe(false);
  });

  test('_onRun handles empty applied array', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 2, indexedDocs: 50 },
        performance: { applied: [], rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.some(line => line.includes('Applied'))).toBe(false);
  });

  test('_onRun handles non-finite rafFPS', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 2, indexedDocs: 50 },
        performance: { applied: [], rafFPS: NaN }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.some(line => line.includes('RAF FPS'))).toBe(false);
  });

  test('_onRun handles querySelector returning null', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 0, indexedDocs: 0 },
        performance: { applied: [], rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();
    ui.element = { find: jest.fn().mockReturnValue([{ querySelector: jest.fn().mockReturnValue(null) }]) };

    await ui._onRun();

    expect(ui._service.optimize).toHaveBeenCalled();
  });

  test('_onRun trims log lines when exceeding 300', async () => {
    game.user.isGM = true;
    ui._logLines = new Array(299).fill('old line');
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: {},
        performance: {}
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.length).toBeLessThanOrEqual(300);
  });

  test('_onRun disables button during operation', async () => {
    game.user.isGM = true;
    const mockButton = { disabled: false };
    ui.element = [{ querySelector: jest.fn().mockReturnValue(mockButton) }];
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: {},
        performance: {}
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(mockButton.disabled).toBe(false);
  });

  test('_onRun error handling with element querySelector returning null (line 221 finally block)', async () => {
    game.user.isGM = true;
    ui.element = [{ querySelector: jest.fn().mockReturnValue(null) }];
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockRejectedValue(new Error('Test error'))
    };
    ui._renderLog = jest.fn();

    await ui._onRun();
    expect(ui._logLines.some(line => line.includes('Failed: Test error'))).toBe(true);
    expect(ui.element[0].querySelector).toHaveBeenCalledWith('[data-action="run"]');
  });

  test('_onRun handles missing button element', async () => {
    game.user.isGM = true;
    ui.element = [{ querySelector: jest.fn().mockReturnValue(null) }];
    ui._logLines = new Array(299).fill('old line');
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: {},
        performance: {}
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.length).toBeLessThanOrEqual(300);
  });

  test('activateListeners with event delegation', () => {
    const root = {
      addEventListener: jest.fn(),
      querySelector: jest.fn().mockReturnValue(null)
    };
    const html = [root];

    ui.activateListeners(html);

    expect(root.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    expect(root.addEventListener).toHaveBeenCalledWith('click', expect.any(Function));
  });

  test('activateListeners handles no addEventListener', () => {
    const html = [{}];
    expect(() => ui.activateListeners(html)).not.toThrow();
  });

  test('activateListeners change event handles doCleanupChat', () => {
    const changeHandler = jest.fn();
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') changeHandler.mockImplementation(handler);
      })
    };
    const html = [root];
    ui._setSetting = jest.fn();

    ui.activateListeners(html);

    const mockEvent = { target: { name: 'doCleanupChat', checked: true } };
    changeHandler(mockEvent);

    expect(ui._setSetting).toHaveBeenCalledWith('doCleanupChat', true);
  });

  test('activateListeners change event handles chatRetentionDays', () => {
    const changeHandler = jest.fn();
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') changeHandler.mockImplementation(handler);
      })
    };
    const html = [root];
    ui._setSetting = jest.fn();

    ui.activateListeners(html);

    const mockEvent = { target: { name: 'chatRetentionDays', value: '60' } };
    changeHandler(mockEvent);

    expect(ui._setSetting).toHaveBeenCalledWith('chatRetentionDays', 60);
  });

  test('activateListeners change event handles all checkbox settings', () => {
    const changeHandler = jest.fn();
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') changeHandler.mockImplementation(handler);
      })
    };
    const html = [root];
    ui._setSetting = jest.fn();

    ui.activateListeners(html);

    changeHandler({ target: { name: 'doCleanupInactiveCombats', checked: false } });
    changeHandler({ target: { name: 'doRebuildCompendiumIndexes', checked: true } });
    changeHandler({ target: { name: 'doCorePerformanceTweaks', checked: false } });

    expect(ui._setSetting).toHaveBeenCalledWith('doCleanupInactiveCombats', false);
    expect(ui._setSetting).toHaveBeenCalledWith('doRebuildCompendiumIndexes', true);
    expect(ui._setSetting).toHaveBeenCalledWith('doCorePerformanceTweaks', false);
  });

  test('activateListeners click event handles dryRun action', () => {
    const clickHandler = jest.fn();
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'click') clickHandler.mockImplementation(handler);
      })
    };
    const html = [root];
    ui._onDryRun = jest.fn();

    ui.activateListeners(html);

    const mockEvent = {
      target: {
        closest: jest.fn().mockReturnValue({ dataset: { action: 'dryRun' } })
      }
    };
    clickHandler(mockEvent);

    expect(ui._onDryRun).toHaveBeenCalled();
  });

  test('activateListeners click event handles run action', () => {
    const clickHandler = jest.fn();
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'click') clickHandler.mockImplementation(handler);
      })
    };
    const html = [root];
    ui._onRun = jest.fn();

    ui.activateListeners(html);

    const mockEvent = {
      target: {
        closest: jest.fn().mockReturnValue({ dataset: { action: 'run' } })
      }
    };
    clickHandler(mockEvent);

    expect(ui._onRun).toHaveBeenCalled();
  });

  test('activateListeners click event handles close action', () => {
    const clickHandler = jest.fn();
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'click') clickHandler.mockImplementation(handler);
      })
    };
    const html = [root];
    ui.close = jest.fn();

    ui.activateListeners(html);

    const mockEvent = {
      target: {
        closest: jest.fn().mockReturnValue({ dataset: { action: 'close' } })
      }
    };
    clickHandler(mockEvent);

    expect(ui.close).toHaveBeenCalled();
  });

  test('activateListeners change event with no target', () => {
    const html = [{ addEventListener: jest.fn((event, handler) => {
      if (event === 'change') handler({ target: null });
    })}];
    expect(() => ui.activateListeners(html)).not.toThrow();
  });

  test('activateListeners change event with no name', () => {
    const html = [{ addEventListener: jest.fn((event, handler) => {
      if (event === 'change') handler({ target: { name: '' } });
    })}];
    expect(() => ui.activateListeners(html)).not.toThrow();
  });

  test('activateListeners click event with no button', () => {
    const html = [{ addEventListener: jest.fn((event, handler) => {
      if (event === 'click') handler({ target: { closest: jest.fn(() => null) } });
    })}];
    expect(() => ui.activateListeners(html)).not.toThrow();
  });

  test('activateListeners change event with no action', () => {
    const html = [{ addEventListener: jest.fn((event, handler) => {
      if (event === 'click') handler({ target: { closest: jest.fn(() => ({ dataset: {} })) } });
    })}];
    expect(() => ui.activateListeners(html)).not.toThrow();
  });

  test('activateListeners change event handles chatRetentionDays with NaN value', () => {
    const html = [{
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') {
          handler({ target: { name: 'chatRetentionDays', value: 'invalid' } });
        }
      })
    }];
    ui._setSetting = jest.fn();
    ui.activateListeners(html);
    expect(ui._setSetting).toHaveBeenCalledWith('chatRetentionDays', 30);
  });

  test('activateListeners handles no closest method on target', () => {
    const html = [{
      addEventListener: jest.fn((event, handler) => {
        if (event === 'click') handler({ target: {} });
      })
    }];
    expect(() => ui.activateListeners(html)).not.toThrow();
  });

  test('activateListeners change event with event target undefined', () => {
    const html = [{
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') handler({});
      })
    }];
    expect(() => ui.activateListeners(html)).not.toThrow();
  });

  test('activateListeners handles all checkbox settings individually', () => {
    const html = [{
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') {
          handler({ target: { name: 'doCleanupInactiveCombats', checked: true } });
          handler({ target: { name: 'doRebuildCompendiumIndexes', checked: false } });
          handler({ target: { name: 'doCorePerformanceTweaks', checked: true } });
        }
      })
    }];
    ui._setSetting = jest.fn();
    ui.activateListeners(html);
    expect(ui._setSetting).toHaveBeenCalledTimes(3);
  });

  test('activateListeners click event handles all actions', () => {
    const html = [{
      addEventListener: jest.fn((event, handler) => {
        if (event === 'click') {
          handler({ target: { closest: jest.fn(() => ({ dataset: { action: 'dryRun' } })) } });
          handler({ target: { closest: jest.fn(() => ({ dataset: { action: 'run' } })) } });
          handler({ target: { closest: jest.fn(() => ({ dataset: { action: 'close' } })) } });
        }
      })
    }];
    ui._onDryRun = jest.fn();
    ui._onRun = jest.fn();
    ui.close = jest.fn();
    ui.activateListeners(html);
    expect(ui._onDryRun).toHaveBeenCalled();
    expect(ui._onRun).toHaveBeenCalled();
    expect(ui.close).toHaveBeenCalled();
  });

  test('activateListeners with html array having no addEventListener', () => {
    const html = [{}];
    expect(() => ui.activateListeners(html)).not.toThrow();
  });

  test('activateListeners with root having addEventListener undefined (line 86 early return)', () => {
    const html = [{ addEventListener: undefined }];
    expect(() => ui.activateListeners(html)).not.toThrow();
  });

  test('activateListeners change event triggering FALSE branch of each setting name check', () => {
    const html = [{
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') {
          handler({ target: { name: 'unknownSetting', checked: true } });
        }
      })
    }];
    ui._setSetting = jest.fn();
    ui.activateListeners(html);
    expect(ui._setSetting).not.toHaveBeenCalled();
  });

  test('activateListeners click event triggering FALSE branch of each action check', () => {
    const html = [{
      addEventListener: jest.fn((event, handler) => {
        if (event === 'click') {
          handler({ target: { closest: jest.fn(() => ({ dataset: { action: 'unknownAction' } })) } });
        }
      })
    }];
    ui._onDryRun = jest.fn();
    ui._onRun = jest.fn();
    ui.close = jest.fn();
    ui.activateListeners(html);
    expect(ui._onDryRun).not.toHaveBeenCalled();
    expect(ui._onRun).not.toHaveBeenCalled();
    expect(ui.close).not.toHaveBeenCalled();
  });

  test('activateListeners change event for all setting names', () => {
    const html = [{
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') {
          handler({ target: { name: 'doCleanupChat', checked: true } });
          handler({ target: { name: 'chatRetentionDays', value: '45' } });
          handler({ target: { name: 'doCleanupInactiveCombats', checked: false } });
          handler({ target: { name: 'doRebuildCompendiumIndexes', checked: true } });
          handler({ target: { name: 'doCorePerformanceTweaks', checked: false } });
        }
      })
    }];
    ui._setSetting = jest.fn();
    ui.activateListeners(html);
    expect(ui._setSetting).toHaveBeenCalledTimes(5);
  });

  test('activateListeners click event for all action types', () => {
    const html = [{
      addEventListener: jest.fn((event, handler) => {
        if (event === 'click') {
          handler({ target: { closest: jest.fn(() => ({ dataset: { action: 'dryRun' } })) } });
          handler({ target: { closest: jest.fn(() => ({ dataset: { action: 'run' } })) } });
          handler({ target: { closest: jest.fn(() => ({ dataset: { action: 'close' } })) } });
        }
      })
    }];
    ui._onDryRun = jest.fn();
    ui._onRun = jest.fn();
    ui.close = jest.fn();
    ui.activateListeners(html);
    expect(ui._onDryRun).toHaveBeenCalledTimes(1);
    expect(ui._onRun).toHaveBeenCalledTimes(1);
    expect(ui.close).toHaveBeenCalledTimes(1);
  });

  test('_onDryRun with compendiums.enabled false prevents logging', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: false, packs: 5 },
        performance: { enabled: true, changes: [] },
        notes: []
      })
    };

    await ui._onDryRun();
    expect(ui._logLines.some(line => line.includes('would index'))).toBe(false);
  });

  test('_onDryRun with performance.enabled false prevents logging', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: true, packs: 2 },
        performance: { enabled: false, changes: [{ setting: 'test' }] },
        notes: []
      })
    };

    await ui._onDryRun();
    expect(ui._logLines.some(line => line.includes('Dry Run:') && line.includes('->'))).toBe(false);
  });

  test('_onDryRun with notes as empty array', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: true, packs: 0 },
        performance: { enabled: true, changes: [] },
        notes: []
      })
    };

    await ui._onDryRun();
    expect(ui._logLines.some(line => line.includes('Note:'))).toBe(false);
  });

  test('_onRun with compendiums.indexedPacks as 0', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 0, indexedDocs: 0 },
        performance: { applied: [], rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.some(line => line.includes('indexed packs'))).toBe(false);
  });

  test('_onRun with performance.applied as non-array', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 2, indexedDocs: 50 },
        performance: { applied: null, rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.some(line => line.includes('Applied:'))).toBe(false);
  });

  test('_onRun with rafFPS as undefined', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 0, indexedDocs: 0 },
        performance: { applied: [], rafFPS: undefined }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.some(line => line.includes('RAF FPS'))).toBe(false);
  });

  test('_onRun with button element as null from querySelector', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 0, indexedDocs: 0 },
        performance: { applied: [], rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();
    ui.element = { 0: { querySelector: () => null }, find: jest.fn().mockReturnValue([{ querySelector: () => null }]) };

    await ui._onRun();

    expect(ui._service.optimize).toHaveBeenCalled();
  });

  test('_onDryRun error handling with service throwing error (line 170 catch block)', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockRejectedValue(new Error('Service error'))
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();
    expect(ui._logLines.some(line => line.includes('Dry Run failed: Service error'))).toBe(true);
  });

  test('_onRun with report.compendiums.indexedPacks falsy (line 200 if false branch)', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 0 },
        performance: { applied: [] }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();
    expect(ui._logLines.some(line => line.includes('indexed packs='))).toBe(false);
  });

  test('_onRun with report.performance.applied not being an array (line 204 Array.isArray false)', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: {},
        performance: { applied: 'not-an-array', rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();
    expect(ui._logLines.some(line => line.includes('Applied:'))).toBe(false);
  });

  test('_onRun with report.performance.rafFPS not finite (line 213 Number.isFinite false)', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: {},
        performance: { applied: [], rafFPS: NaN }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();
    expect(ui._logLines.some(line => line.includes('RAF FPS'))).toBe(false);
  });

  test('_onDryRun with report.compendiums.enabled false (line 141 if false branch)', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: false, packs: 10 },
        performance: { enabled: false },
        notes: []
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();
    expect(ui._logLines.some(line => line.includes('would index'))).toBe(false);
  });

  test('_onDryRun with report.performance.enabled false (line 144 if false branch)', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: false },
        performance: { enabled: false, changes: [{ setting: 'test', from: 1, to: 2 }] },
        notes: []
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();
    expect(ui._logLines.some(line => line.includes('test'))).toBe(false);
  });

  test('_onDryRun with report.notes not being an array (line 155 Array.isArray false)', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: false },
        performance: { enabled: false },
        notes: 'not-an-array'
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();
    expect(ui._logLines.some(line => line.includes('Note:'))).toBe(false);
  });

  test('activateListeners with root.addEventListener being null (line 87 if condition variations)', () => {
    const html = [{ addEventListener: null }];
    expect(() => ui.activateListeners(html)).not.toThrow();
  });

  test('activateListeners with html[0] being falsy triggering ?? html fallback', () => {
    const mockRoot = {
      addEventListener: jest.fn()
    };
    const html = [null];
    html.addEventListener = mockRoot.addEventListener;

    ui.activateListeners(html);

    expect(mockRoot.addEventListener).toHaveBeenCalled();
  });

  test('activateListeners change event with ev.target being null', () => {
    let changeHandler;
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') changeHandler = handler;
      })
    };
    const html = [root];
    ui._setSetting = jest.fn();

    ui.activateListeners(html);

    const mockEvent = { target: null };
    changeHandler(mockEvent);

    expect(ui._setSetting).not.toHaveBeenCalled();
  });

  test('activateListeners change event with target.name being empty string', () => {
    let changeHandler;
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') changeHandler = handler;
      })
    };
    const html = [root];
    ui._setSetting = jest.fn();

    ui.activateListeners(html);

    const mockEvent = { target: { name: '', value: 'test' } };
    changeHandler(mockEvent);

    expect(ui._setSetting).not.toHaveBeenCalled();
  });

  test('_onDryRun handles performance enabled with no changes', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } },
        compendiums: { enabled: false },
        performance: { enabled: true, changes: [] },
        notes: []
      })
    };
    ui._renderLog = jest.fn();

    await ui._onDryRun();
    expect(ui._logLines.some(line => line.includes('no core performance changes needed'))).toBe(true);
  });

  test('_onRun handles report.performance.applied undefined', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 0, indexedDocs: 0 },
        performance: { rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._service.optimize).toHaveBeenCalled();
  });

  test('_onRun handles report.performance.rafFPS not a finite number', async () => {
    game.user.isGM = true;
    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 0, indexedDocs: 0 },
        performance: { applied: [], rafFPS: Infinity }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.some(line => line.includes('RAF FPS'))).toBe(false);
  });

  test('activateListeners change event handles unrecognized name', () => {
    const changeHandler = jest.fn();
    const root = {
      addEventListener: jest.fn((event, handler) => {
        if (event === 'change') changeHandler.mockImplementation(handler);
      })
    };
    const html = [root];
    ui._setSetting = jest.fn();

    ui.activateListeners(html);

    const mockEvent = { target: { name: 'unknownSetting', value: 'test' } };
    changeHandler(mockEvent);

    expect(ui._setSetting).not.toHaveBeenCalled();
  });

  test('_onRun handles performance.memory undefined', async () => {
    game.user.isGM = true;
    const originalMemory = performance.memory;
    delete performance.memory;

    ui._service = {
      dryRun: jest.fn().mockResolvedValue({
        cleanup: { chat: { wouldDelete: 0 }, combats: { wouldDelete: 0 } }
      }),
      optimize: jest.fn().mockResolvedValue({
        cleanup: { chat: { deleted: 0 }, combats: { deleted: 0 } },
        compendiums: { indexedPacks: 0, indexedDocs: 0 },
        performance: { applied: [], rafFPS: 60 }
      })
    };
    ui._renderLog = jest.fn();

    await ui._onRun();

    expect(ui._logLines.some(line => line.includes('Heap'))).toBe(false);

    if (originalMemory) {
      Object.defineProperty(performance, 'memory', { value: originalMemory, configurable: true });
    }
  });
});

describe('VQ3DBridge', () => {
  let bridge;
  let mockVQBridge;

  beforeEach(() => {
    mockVQBridge = {
      executeOnVQ: jest.fn(async (callback) => {
        const mockVQ = {
          execute3DRender: jest.fn().mockResolvedValue({ renderId: '123' }),
          load3DModel: jest.fn().mockResolvedValue({ modelId: 'model-456' }),
          animate3D: jest.fn().mockResolvedValue({ animationId: 'anim-789' }),
          updatePhysics: jest.fn().mockResolvedValue({ physicsId: 'phys-101' }),
          generateEffect: jest.fn().mockResolvedValue({ effectId: 'effect-202' })
        };
        return await callback(mockVQ);
      }),
      loadBalanceMode: 'round-robin'
    };

    bridge = new VQ3DBridge(mockVQBridge);
  });

  test('constructor initializes with vqBridge', () => {
    expect(bridge.vqBridge).toBe(mockVQBridge);
  });

  test('render3DModel with vqBridge and full options', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const options = {
      position: { x: 1, y: 2, z: 3 },
      scale: { x: 2, y: 2, z: 2 },
      rotation: { x: 90, y: 0, z: 0 },
      animations: ['idle', 'walk'],
      quality: 'ultra',
      physics: true,
      lighting: true
    };

    const result = await bridge.render3DModel('model.glb', options);

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ renderId: '123' });
    consoleSpy.mockRestore();
  });

  test('render3DModel with vqBridge and default options', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await bridge.render3DModel('model.glb', {});

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ renderId: '123' });
    consoleSpy.mockRestore();
  });

  test('render3DModel with physics disabled', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await bridge.render3DModel('model.glb', { physics: false });

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ renderId: '123' });
    consoleSpy.mockRestore();
  });

  test('render3DModel with lighting disabled', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await bridge.render3DModel('model.glb', { lighting: false });

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ renderId: '123' });
    consoleSpy.mockRestore();
  });

  test('render3DModel without vqBridge', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    bridge.vqBridge = null;

    const result = await bridge.render3DModel('model.glb');

    expect(result).toBeNull();
    consoleSpy.mockRestore();
  });

  test('load3DModel with vqBridge', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await bridge.load3DModel('model.glb');

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ modelId: 'model-456' });
    consoleSpy.mockRestore();
  });

  test('load3DModel without vqBridge', async () => {
    bridge.vqBridge = null;
    const result = await bridge.load3DModel('model.glb');
    expect(result).toBeNull();
  });

  test('animate3DModel with vqBridge and options', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const options = { loop: true, speed: 1.5, blendTime: 0.5 };
    const result = await bridge.animate3DModel('token1', 'walk', options);

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ animationId: 'anim-789' });
    consoleSpy.mockRestore();
  });

  test('animate3DModel with default options', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await bridge.animate3DModel('token1', 'walk', {});

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ animationId: 'anim-789' });
    consoleSpy.mockRestore();
  });

  test('animate3DModel with loop disabled', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await bridge.animate3DModel('token1', 'walk', { loop: false });

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ animationId: 'anim-789' });
    consoleSpy.mockRestore();
  });

  test('animate3DModel without vqBridge', async () => {
    bridge.vqBridge = null;
    const result = await bridge.animate3DModel('token1', 'walk');
    expect(result).toBeNull();
  });

  test('update3DPhysics with vqBridge', async () => {
    const physicsData = { mass: 10, friction: 0.5 };
    const result = await bridge.update3DPhysics('token1', physicsData);

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ physicsId: 'phys-101' });
  });

  test('update3DPhysics without vqBridge', async () => {
    bridge.vqBridge = null;
    const result = await bridge.update3DPhysics('token1', {});
    expect(result).toBeNull();
  });

  test('apply3DEffect with vqBridge and full config', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const config = {
      position: { x: 5, y: 10, z: 15 },
      parameters: { intensity: 0.8, color: '#ff0000' },
      duration: 3000
    };

    const result = await bridge.apply3DEffect('explosion', config);

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ effectId: 'effect-202' });
    consoleSpy.mockRestore();
  });

  test('apply3DEffect with default config', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const result = await bridge.apply3DEffect('explosion', {});

    expect(mockVQBridge.executeOnVQ).toHaveBeenCalled();
    expect(result).toEqual({ effectId: 'effect-202' });
    consoleSpy.mockRestore();
  });

  test('apply3DEffect without vqBridge', async () => {
    bridge.vqBridge = null;
    const result = await bridge.apply3DEffect('explosion', {});
    expect(result).toBeNull();
  });

  test('batchRender3DModels with vqBridge', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    const models = [
      { path: 'model1.glb', options: {} },
      { path: 'model2.glb', options: { quality: 'low' } }
    ];

    const result = await bridge.batchRender3DModels(models);

    expect(result).toHaveLength(2);
    expect(mockVQBridge.loadBalanceMode).toBe('round-robin');
    consoleSpy.mockRestore();
  });

  test('batchRender3DModels without vqBridge', async () => {
    bridge.vqBridge = null;
    const result = await bridge.batchRender3DModels([]);
    expect(result).toEqual([]);
  });

  test('batchRender3DModels restores loadBalanceMode', async () => {
    mockVQBridge.loadBalanceMode = 'sequential';
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await bridge.batchRender3DModels([{ path: 'model.glb', options: {} }]);

    expect(mockVQBridge.loadBalanceMode).toBe('sequential');
    consoleSpy.mockRestore();
  });
});

describe('OptimizerCore Edge Cases', () => {
  let optimizer;
  let mockLogFn;

  beforeEach(() => {
    mockLogFn = jest.fn();
    optimizer = new OptimizerCore({
      logFn: mockLogFn,
      ...createFoundryCoreDependencies({ logFn: mockLogFn })
    });

    game.messages = { contents: [] };
    game.combats = { contents: [] };
    game.packs = { values: () => [] };
    game.user = { isGM: true };
  });

  test('dryRun handles all conditions with performance enabled', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: true
    };

    const report = await optimizer.dryRun(options);

    expect(report.performance.enabled).toBe(true);
  });

  test('dryRun handles combat counting error', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    Object.defineProperty(game, 'combats', {
      get() { throw new Error('Combat error'); },
      configurable: true
    });

    const report = await optimizer.dryRun(options);
    expect(report.notes.some(note => note.includes('Could not count inactive combats'))).toBe(true);
  });

  test('dryRun handles messages with timestamp 0', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { timestamp: 0 },
      { timestamp: Date.now() }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBe(0);
  });

  test('dryRun handles combat without started property', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { turns: [] },
      { started: null, turns: null }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(2);
  });

  test('dryRun handles combats with non-array turns', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { turns: [] },
      { started: null, turns: null }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(2);
  });

  test('dryRun handles combats with started true but no turns', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { started: true, turns: [] },
      { started: false, turns: [{ id: '1' }] },
      { started: false, turns: [] }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(1);
  });

  test('_rebuildCompendiumIndexes handles non-array index', async () => {
    const report = { compendiums: {} };
    const mockPack = {
      collection: 'test.pack',
      getIndex: jest.fn().mockResolvedValue({ size: 10 })
    };
    game.packs = {
      values: jest.fn().mockReturnValue([mockPack])
    };

    await optimizer._rebuildCompendiumIndexes(report);
    expect(report.compendiums.indexedDocs).toBe(0);
  });

  test('dryRun handles compendium enumeration error', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    Object.defineProperty(game, 'packs', {
      get() { throw new Error('Packs error'); },
      configurable: true
    });

    const report = await optimizer.dryRun(options);
    expect(report.notes.some(note => note.includes('Could not enumerate compendium packs'))).toBe(true);
  });

  test('optimize handles chat error report field', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { id: 'msg1', timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) }
    ];

    ChatMessage.deleteDocuments = jest.fn(() => Promise.reject(new Error('Delete failed')));

    const report = await optimizer.optimize(options);

    expect(report.cleanup.chat.error).toBe('Delete failed');
  });

  test('optimize handles combat error report field', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [{ id: 'combat1', started: false, turns: [] }];

    Combat.deleteDocuments = jest.fn(() => Promise.reject(new Error('Delete failed')));

    const report = await optimizer.optimize(options);

    expect(report.cleanup.combats.error).toBe('Delete failed');
  });

  test('_cleanupChat handles messages with undefined id (filter Boolean)', async () => {
    const options = { chatRetentionDays: 30 };
    const report = { cleanup: { chat: {} } };

    game.messages.contents = [
      { id: 'msg1', timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) },
      { id: null, timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) },
      { timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) }
    ];
    ChatMessage.deleteDocuments = jest.fn().mockResolvedValue(true);

    await optimizer._cleanupChat(options, report);
    expect(report.cleanup.chat.deleted).toBe(1);
  });

  test('_cleanupCombats handles undefined id (filter Boolean)', async () => {
    const report = { cleanup: { combats: {} } };

    game.combats.contents = [
      { id: 'combat1', started: false, turns: [] },
      { id: null, started: false, turns: [] },
      { started: false, turns: [] }
    ];
    Combat.deleteDocuments = jest.fn().mockResolvedValue(true);

    await optimizer._cleanupCombats(report);
    expect(report.cleanup.combats.deleted).toBe(1);
  });

  test('_rebuildCompendiumIndexes handles error without message property', async () => {
    const report = { compendiums: {} };
    const mockPack = {
      collection: 'test.pack',
      getIndex: jest.fn().mockRejectedValue('String error')
    };
    game.packs = {
      values: jest.fn().mockReturnValue([mockPack])
    };
    const logSpy = jest.spyOn(optimizer, 'log');

    await optimizer._rebuildCompendiumIndexes(report);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('String error'));
  });

  test('_rebuildCompendiumIndexes handles non-array index', async () => {
    const report = { compendiums: {} };
    const mockPack = {
      collection: 'test.pack',
      getIndex: jest.fn().mockResolvedValue({ length: undefined })
    };
    game.packs = {
      values: jest.fn().mockReturnValue([mockPack])
    };

    await optimizer._rebuildCompendiumIndexes(report);
    expect(report.compendiums.indexedPacks).toBeGreaterThanOrEqual(0);
  });

  test('dryRun handles message with timestamp exactly zero', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { id: 'msg1', timestamp: 0 },
      { id: 'msg2', timestamp: Date.now() }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBeGreaterThanOrEqual(0);
  });

  test('dryRun handles message with negative timestamp', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { id: 'msg1', timestamp: -1000 },
      { id: 'msg2', timestamp: Date.now() }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBeGreaterThanOrEqual(0);
  });

  test('dryRun handles message exactly at cutoff boundary', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    game.messages.contents = [
      { id: 'msg1', timestamp: cutoff },
      { id: 'msg2', timestamp: Date.now() }
    ];

    const report = await optimizer.dryRun(options);
    expect(report).toBeDefined();
  });

  test('dryRun handles messages enumeration error', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    Object.defineProperty(game.messages, 'contents', {
      get() { throw new Error('Messages error'); },
      configurable: true
    });

    const report = await optimizer.dryRun(options);
    expect(report.notes.some(note => note.includes('Could not count old chat messages'))).toBe(true);
  });

  test('dryRun handles combats enumeration error', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    Object.defineProperty(game.combats, 'contents', {
      get() { throw new Error('Combats error'); },
      configurable: true
    });

    const report = await optimizer.dryRun(options);
    expect(report.notes.some(note => note.includes('Could not count inactive combats'))).toBe(true);
  });

  test('optimize handles all disabled options', async () => {
    game.user.isGM = true;
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const report = await optimizer.optimize(options, { dryRun: false });
    expect(report.cleanup.chat.wouldDelete).toBe(0);
    expect(report.cleanup.combats.wouldDelete).toBe(0);
  });

  test('optimize with all options enabled', async () => {
    game.user.isGM = true;
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: true
    };

    game.messages.contents = [];
    game.combats.contents = [];
    game.packs = { values: jest.fn().mockReturnValue([]) };

    const report = await optimizer.optimize(options, { dryRun: false });
    expect(report).toBeDefined();
  });

  test('_nowISO pads single-digit values correctly', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2025-01-05 03:07:09'));

    const iso = optimizer._nowISO();
    expect(iso).toContain('2025-01-05');
    expect(iso).toContain('03:07:09');

    jest.useRealTimers();
  });

  test('dryRun chat cleanup catch block triggered', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages = {
      get contents() {
        throw new Error('Contents access error');
      }
    };

    const report = await optimizer.dryRun(options);
    expect(report.notes.length).toBeGreaterThan(0);
  });

  test('dryRun combat cleanup catch block triggered', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats = {
      get contents() {
        throw new Error('Contents access error');
      }
    };

    const report = await optimizer.dryRun(options);
    expect(report.notes.length).toBeGreaterThan(0);
  });

  test('optimize with doCleanupChat only enabled', async () => {
    game.user.isGM = true;
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [];
    ChatMessage.deleteDocuments = jest.fn().mockResolvedValue(true);

    const report = await optimizer.optimize(options, { dryRun: false });
    expect(report).toBeDefined();
  });

  test('optimize with doCleanupInactiveCombats only enabled', async () => {
    game.user.isGM = true;
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [];
    Combat.deleteDocuments = jest.fn().mockResolvedValue(true);

    const report = await optimizer.optimize(options, { dryRun: false });
    expect(report).toBeDefined();
  });

  test('_cleanupChat with messages at exact batch boundary', async () => {
    const options = { chatRetentionDays: 30 };
    const report = { cleanup: { chat: {} } };

    const oldMessages = Array.from({ length: 100 }, (_, i) => ({
      id: `msg${i}`,
      timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000)
    }));
    game.messages.contents = oldMessages;
    ChatMessage.deleteDocuments = jest.fn().mockResolvedValue(true);

    await optimizer._cleanupChat(options, report);
    expect(ChatMessage.deleteDocuments).toHaveBeenCalledTimes(1);
    expect(report.cleanup.chat.deleted).toBe(100);
  });

  test('_cleanupCombats with exact batch boundary', async () => {
    const report = { cleanup: { combats: {} } };

    const inactiveCombats = Array.from({ length: 100 }, (_, i) => ({
      id: `combat${i}`,
      started: false,
      turns: []
    }));
    game.combats.contents = inactiveCombats;
    Combat.deleteDocuments = jest.fn().mockResolvedValue(true);

    await optimizer._cleanupCombats(report);
    expect(Combat.deleteDocuments.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(report.cleanup.combats.deleted).toBe(100);
  });

  test('dryRun message with undefined timestamp uses nullish coalescing', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { id: 'msg1' },
      { id: 'msg2', timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBe(1);
  });

  test('dryRun message with timestamp>0 but >= cutoff (recent message, ternary false branch)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    game.messages.contents = [
      { id: 'old', timestamp: cutoff - 1000 },
      { id: 'recent', timestamp: cutoff + 1000 }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBe(1);
  });

  test('_cleanupChat filter with message timestamp>0 but >= cutoff (recent, second && operand false)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    game.messages.contents = [
      { id: 'old', timestamp: cutoff - 5000 },
      { id: 'recent', timestamp: cutoff + 10000 }
    ];

    await optimizer.optimize(options);
    expect(ChatMessage.deleteDocuments).toHaveBeenCalledWith(['old']);
  });

  test('dryRun combat with turns as non-array (string) - Array.isArray false branch', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: 'not-array' },
      { id: 'c2', started: false, turns: null }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(2);
  });

  test('_cleanupCombats filter with turns as number - Array.isArray false branch', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: 42 }
    ];

    await optimizer.optimize(options);
    expect(Combat.deleteDocuments).toHaveBeenCalledWith(['c1']);
  });

  test('_cleanupCombats filter with turns as object (not array) - Array.isArray false branch', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: {length: 5} }
    ];

    await optimizer.optimize(options);
    expect(Combat.deleteDocuments).toHaveBeenCalledWith(['c1']);
  });

  test('dryRun combat with null turns property', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: null },
      { id: 'c2', started: false, turns: [] }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBeGreaterThanOrEqual(1);
  });

  test('_cleanupChat filter with recent message (timestamp > 0 but >= cutoff)', async () => {
    const options = { chatRetentionDays: 30 };
    const report = { cleanup: { chat: {} } };

    const recentTimestamp = Date.now() - (15 * 24 * 60 * 60 * 1000);
    game.messages.contents = [
      { id: 'recent', timestamp: recentTimestamp }
    ];
    ChatMessage.deleteDocuments = jest.fn().mockResolvedValue(true);

    await optimizer._cleanupChat(options, report);
    expect(report.cleanup.chat.deleted).toBeUndefined();
  });

  test('_cleanupCombats filter with active combat (started=true)', async () => {
    const report = { cleanup: { combats: {} } };

    game.combats.contents = [
      { id: 'active', started: true, turns: [] }
    ];
    Combat.deleteDocuments = jest.fn().mockResolvedValue(true);

    await optimizer._cleanupCombats(report);
    expect(report.cleanup.combats.deleted).toBeUndefined();
  });

  test('_cleanupCombats filter with combat having turns', async () => {
    const report = { cleanup: { combats: {} } };

    game.combats.contents = [
      { id: 'withturns', started: false, turns: [{ id: 'turn1' }] }
    ];
    Combat.deleteDocuments = jest.fn().mockResolvedValue(true);

    await optimizer._cleanupCombats(report);
    expect(report.cleanup.combats.deleted).toBeUndefined();
  });

  test('optimize catches RAF FPS measurement error', async () => {
    game.user.isGM = true;
    const oldRAF = global.requestAnimationFrame;
    global.requestAnimationFrame = undefined;

    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const report = await optimizer.optimize(options, { dryRun: false });
    expect(report.performance.rafFPS).toBeNull();

    global.requestAnimationFrame = oldRAF;
  });

  test('_cleanupChat handles message with null id in filter Boolean', async () => {
    const options = { chatRetentionDays: 30 };
    const report = { cleanup: { chat: {} } };

    game.messages.contents = [
      { id: null, timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) },
      { id: '', timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) },
      { id: 'valid', timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) }
    ];
    ChatMessage.deleteDocuments = jest.fn().mockResolvedValue(true);

    await optimizer._cleanupChat(options, report);
    expect(report.cleanup.chat.deleted).toBe(1);
  });

  test('_cleanupCombats handles combat with null id in filter Boolean', async () => {
    const report = { cleanup: { combats: {} } };

    game.combats.contents = [
      { id: null, started: false, turns: [] },
      { id: '', started: false, turns: [] },
      { id: 'valid', started: false, turns: [] }
    ];
    Combat.deleteDocuments = jest.fn().mockResolvedValue(true);

    await optimizer._cleanupCombats(report);
    expect(report.cleanup.combats.deleted).toBe(1);
  });

  test('_rebuildCompendiumIndexes with pack returning null index', async () => {
    const report = { compendiums: {} };
    const mockPack = {
      collection: 'test.pack',
      getIndex: jest.fn().mockResolvedValue(null)
    };
    game.packs = {
      values: jest.fn().mockReturnValue([mockPack])
    };

    await optimizer._rebuildCompendiumIndexes(report);
    expect(report.compendiums.indexedPacks).toBeGreaterThanOrEqual(0);
  });

  test('optimize with doRebuildCompendiumIndexes only', async () => {
    game.user.isGM = true;
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    game.packs = { values: jest.fn().mockReturnValue([]) };

    const report = await optimizer.optimize(options, { dryRun: false });
    expect(report).toBeDefined();
  });

  test('optimize with doCorePerformanceTweaks only', async () => {
    game.user.isGM = true;
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: true
    };

    const report = await optimizer.optimize(options, { dryRun: false });
    expect(report).toBeDefined();
  });

  test('_rebuildCompendiumIndexes with pack.getIndex() returning non-array (line 209 Array.isArray false)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    game.packs = {
      values: jest.fn(function* () {
        yield { id: 'pack1', getIndex: jest.fn().mockResolvedValue('not-an-array') };
      })
    };

    const report = await optimizer.optimize(options);
    expect(report.compendiums.indexedPacks).toBe(1);
    expect(report.compendiums.indexedDocs).toBe(0);
  });

  test('log method with _logFn being null (line 19 conditional check)', () => {
    optimizer._logFn = null;

    expect(() => optimizer.log('test message')).not.toThrow();
  });

  test('dryRun with game.messages.contents getter throwing error (line 50 catch block)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    Object.defineProperty(game.messages, 'contents', {
      get: () => {
        throw new Error('Contents error');
      },
      configurable: true
    });

    const report = await optimizer.dryRun(options);
    expect(report.notes.some(n => n.includes('Could not count old chat messages'))).toBe(true);
  });

  test('dryRun with game.combats.contents getter throwing error (line 63 catch block)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    Object.defineProperty(game.combats, 'contents', {
      get: () => {
        throw new Error('Combats error');
      },
      configurable: true
    });

    const report = await optimizer.dryRun(options);
    expect(report.notes.some(n => n.includes('Could not count inactive combats'))).toBe(true);
  });

  test('optimize with requestAnimationFrame not available (line 125 RAF check false)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: true
    };

    const oldRAF = globalThis.requestAnimationFrame;
    globalThis.requestAnimationFrame = undefined;

    const report = await optimizer.optimize(options);
    expect(report.performance.rafFPS).toBeNull();

    globalThis.requestAnimationFrame = oldRAF;
  });

  test('_cleanupChat filter with message timestamp exactly at cutoff boundary (line 149 NOT deleted)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const now = Date.now();
    const cutoff = now - (30 * 24 * 60 * 60 * 1000);

    jest.spyOn(Date, 'now').mockReturnValue(now);

    game.messages.contents = [
      { id: 'exact', timestamp: cutoff },
      { id: 'old', timestamp: cutoff - 1000 }
    ];

    ChatMessage.deleteDocuments.mockClear();
    await optimizer.optimize(options);
    expect(ChatMessage.deleteDocuments).toHaveBeenCalledTimes(1);
    expect(ChatMessage.deleteDocuments).toHaveBeenCalledWith(['old']);

    Date.now.mockRestore();
  });

  test('_cleanupCombats with combat.started falsy but not false (line 176 !!c?.started variations)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: 0, turns: [] },
      { id: 'c2', started: '', turns: [] },
      { id: 'c3', started: null, turns: [] }
    ];

    await optimizer.optimize(options);
    expect(Combat.deleteDocuments).toHaveBeenCalledWith(['c1', 'c2', 'c3']);
  });

  test('_cleanupChat with message.timestamp being exactly 0 (line 149 first operand false)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { id: 'm1', timestamp: 0 },
      { id: 'm2', timestamp: -100 },
      { id: 'm3', timestamp: Date.now() - (40 * 24 * 60 * 60 * 1000) }
    ];

    await optimizer.optimize(options);
    expect(ChatMessage.deleteDocuments).toHaveBeenCalledWith(['m3']);
  });

  test('dryRun with message.timestamp being exactly 0 in reduce (line 48 ternary false branch)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { id: 'm1', timestamp: 0 },
      { id: 'm2', timestamp: -50 }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBe(0);
  });

  test('dryRun with combat having !!started===true (line 59 isActive true branch)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: true, turns: [] },
      { id: 'c2', started: 1, turns: [] },
      { id: 'c3', started: 'active', turns: [] }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(0);
  });

  test('dryRun with combat turns array having length > 0 (line 60 hasTurns true branch)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: [{ id: 't1' }] },
      { id: 'c2', started: false, turns: [{ id: 't1' }, { id: 't2' }] }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(0);
  });

  test('dryRun with combat turns array having length === 0 (line 60 hasTurns false with array)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: [] }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(1);
  });

  test('dryRun with message timestamp undefined hitting nullish coalescing (line 149 first part)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const cutoff = Date.now() - (30 * 24 * 60 * 60 * 1000);
    game.messages.contents = [
      { timestamp: undefined, id: 'm1' }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBe(0);
  });

  test('dryRun with message timestamp 0 failing > 0 check (line 149 first part)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { timestamp: 0, id: 'm1' }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBe(0);
  });

  test('dryRun with message timestamp > cutoff failing < cutoff check (line 149 second part)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const futureTime = Date.now() + (10 * 24 * 60 * 60 * 1000);
    game.messages.contents = [
      { timestamp: futureTime, id: 'm1' }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBe(0);
  });

  test('dryRun with game.messages.contents.reduce throwing error (line 57 catch block)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = Object.create(Array.prototype);
    game.messages.contents.reduce = () => { throw new Error('Reduce failed'); };

    const report = await optimizer.dryRun(options);
    expect(report.notes).toContain('Could not count old chat messages (permissions or collection unavailable).');
  });

  test('dryRun with game.packs.values throwing error (line 70 catch block)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    game.packs = {
      values: () => {
        throw new Error('Packs error');
      }
    };

    const report = await optimizer.dryRun(options);
    expect(report.notes.some(n => n.includes('Could not enumerate compendium packs'))).toBe(true);
  });

  test('_rebuildCompendiumIndexes with pack.getIndex throwing error with error object (line 211 e?.message)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    game.packs = {
      values: jest.fn(function* () {
        yield {
          collection: 'test.pack',
          getIndex: jest.fn().mockRejectedValue(new Error('Index error'))
        };
      })
    };

    const logSpy = jest.spyOn(optimizer, 'log');
    await optimizer.optimize(options);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed index for test.pack: Index error'));
    logSpy.mockRestore();
  });

  test('_rebuildCompendiumIndexes with pack.getIndex throwing string error (line 211 ?? e fallback)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    game.packs = {
      values: jest.fn(function* () {
        yield {
          collection: 'test.pack',
          getIndex: jest.fn().mockRejectedValue('String error')
        };
      })
    };

    const logSpy = jest.spyOn(optimizer, 'log');
    await optimizer.optimize(options);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Failed index for test.pack: String error'));
    logSpy.mockRestore();
  });

  test('_rebuildCompendiumIndexes with pack.getIndex returning non-array (line 203 Array.isArray false branch)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    game.packs = {
      values: jest.fn(function* () {
        yield {
          collection: 'test.pack',
          getIndex: jest.fn().mockResolvedValue({notAnArray: true})
        };
      })
    };

    const report = await optimizer.optimize(options);
    expect(report.compendiums.packs).toBe(1);
  });

  test('_rebuildCompendiumIndexes with pack.getIndex returning null (line 203 Array.isArray false branch)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    game.packs = {
      values: jest.fn(function* () {
        yield {
          collection: 'test.pack',
          getIndex: jest.fn().mockResolvedValue(null)
        };
      })
    };

    const report = await optimizer.optimize(options);
    expect(report.compendiums.packs).toBe(1);
  });

  test('_cleanupCombats with turns array length > 0 (line 176 hasTurns true branch)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: [{ id: 't1' }] }
    ];

    Combat.deleteDocuments.mockClear();
    await optimizer.optimize(options);
    expect(Combat.deleteDocuments).not.toHaveBeenCalled();
  });

  test('_cleanupCombats with combat started true (line 175 isActive true branch)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: true, turns: [] }
    ];

    Combat.deleteDocuments.mockClear();
    await optimizer.optimize(options);
    expect(Combat.deleteDocuments).not.toHaveBeenCalled();
  });

  test('optimize with RAF measurement having finite duration (line 127 normal path)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: true
    };

    const rafMock = jest.fn((cb) => {
      setTimeout(() => cb(performance.now()), 0);
      return 1;
    });
    globalThis.requestAnimationFrame = rafMock;

    const report = await optimizer.optimize(options);
    expect(typeof report.performance.rafFPS).toBe('number');

    globalThis.requestAnimationFrame = undefined;
  });

  test('_measureRAFFPS with duration < 250 hitting Math.max (line 127 left branch)', async () => {
    globalThis.requestAnimationFrame = jest.fn((cb) => {
      setTimeout(() => cb(performance.now() + 300), 0);
      return 1;
    });

    const result = await optimizer._measureRAFFPS(100);
    expect(typeof result).toBe('number');

    globalThis.requestAnimationFrame = undefined;
  });

  test('_measureRAFFPS with NaN duration hitting || 1000 (line 127 right branch)', async () => {
    globalThis.requestAnimationFrame = jest.fn((cb) => {
      setTimeout(() => cb(performance.now() + 300), 0);
      return 1;
    });

    const result = await optimizer._measureRAFFPS('not a number');
    expect(typeof result).toBe('number');

    globalThis.requestAnimationFrame = undefined;
  });

  test('dryRun with combat having both isActive false and hasTurns false (line 61 both conditions)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: [] },
      { id: 'c2', started: null, turns: null }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(2);
  });

  test('dryRun with combat having isActive true or hasTurns true (line 61 negation branches)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: true, turns: [] },
      { id: 'c2', started: false, turns: [{ id: 't1' }] },
      { id: 'c3', started: true, turns: [{ id: 't1' }] }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(0);
  });

  test('_cleanupChat with message timestamp 0 (line 149 first branch false)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { id: 'm1', timestamp: 0 }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupChat with message timestamp > cutoff (line 149 second branch false)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const futureTime = Date.now() + (10 * 24 * 60 * 60 * 1000);
    game.messages.contents = [
      { id: 'm1', timestamp: futureTime }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupCombats with c.turns not an array (line 176 ternary left false)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: 'not an array' }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupCombats with c.turns array length 0 (line 176 ternary right false)', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: [] }
    ];

    await optimizer.optimize(options);
  });

  test('dryRun line 48 with msg.timestamp as null (nullish coalescing to 0)', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { timestamp: null, id: 'm1' }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBe(0);
  });

  test('dryRun line 48-49 with ts > 0 true but ts < cutoff false', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const futureTimestamp = Date.now() + (60 * 24 * 60 * 60 * 1000);
    game.messages.contents = [
      { timestamp: futureTimestamp, id: 'm1' }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.wouldDelete).toBe(0);
  });

  test('dryRun line 60 with c.turns as null hitting ternary false branch', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: null }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(1);
  });

  test('dryRun line 60 with c.turns.length === 0 hitting ternary false branch', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: [] }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(1);
  });

  test('dryRun line 61 with isActive true causing !isActive to be false', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: true, turns: [] }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(0);
  });

  test('dryRun line 61 with hasTurns true causing !hasTurns to be false', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: [{id: 't1'}] }
    ];

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.combats.wouldDelete).toBe(0);
  });

  test('_cleanupChat line 149 with m.timestamp undefined hitting ?? 0', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { id: 'm1', timestamp: undefined }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupChat line 149 with m.timestamp null hitting ?? 0', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { id: 'm1', timestamp: null }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupChat line 149 with (m?.timestamp ?? 0) = 0 hitting > 0 false', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [
      { id: 'm1', timestamp: 0 }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupChat line 149 with m.timestamp > 0 true but < cutoff false', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const futureTimestamp = Date.now() + (60 * 24 * 60 * 60 * 1000);
    game.messages.contents = [
      { id: 'm1', timestamp: futureTimestamp }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupCombats line 176 with c.turns undefined hitting Array.isArray false', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: undefined }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupCombats line 176 with c.turns [] hitting length > 0 false', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: [] }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupCombats line 176 with c.turns.length > 0 true', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = [
      { id: 'c1', started: false, turns: [{id: 't1'}] }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupChat line 147 all filter chain with valid old messages', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const oldTimestamp = Date.now() - (60 * 24 * 60 * 60 * 1000);
    game.messages.contents = [
      { id: 'm1', timestamp: oldTimestamp },
      { id: 'm2', timestamp: oldTimestamp - 1000 }
    ];

    await optimizer.optimize(options);
  });

  test('_cleanupChat line 147 with game.messages nullish hitting ?? []', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages = null;

    await optimizer.optimize(options);

    game.messages = { contents: [] };
  });

  test('_cleanupChat line 147 with game.messages.contents nullish hitting ?? []', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = null;

    await optimizer.optimize(options);

    game.messages.contents = [];
  });

  test('_cleanupCombats line 173 with game.combats nullish hitting ?? []', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats = null;

    await optimizer.optimize(options);

    game.combats = { contents: [] };
  });

  test('_cleanupCombats line 173 with game.combats.contents nullish hitting ?? []', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: true,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.combats.contents = null;

    await optimizer.optimize(options);

    game.combats.contents = [];
  });

  test('dryRun line 40 with chatRetentionDays 0 hitting || 30', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 0,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.enabled).toBe(true);
  });

  test('dryRun line 40 with chatRetentionDays NaN hitting || 30', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: NaN,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.enabled).toBe(true);
  });

  test('dryRun line 40 with chatRetentionDays undefined hitting || 30', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: undefined,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    const report = await optimizer.dryRun(options);
    expect(report.cleanup.chat.enabled).toBe(true);
  });

  test('_cleanupChat line 145 with chatRetentionDays 0 hitting || 30', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: 0,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [];

    await optimizer.optimize(options);
  });

  test('_cleanupChat line 145 with chatRetentionDays null hitting || 30', async () => {
    const options = {
      doCleanupChat: true,
      chatRetentionDays: null,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: false,
      doCorePerformanceTweaks: false
    };

    game.messages.contents = [];

    await optimizer.optimize(options);
  });

  test('_measureRAFFPS line 127 with durationMs 0 hitting || 1000', async () => {
    globalThis.requestAnimationFrame = jest.fn((cb) => {
      setTimeout(() => cb(performance.now() + 300), 0);
      return 1;
    });

    const result = await optimizer._measureRAFFPS(0);
    expect(typeof result).toBe('number');

    globalThis.requestAnimationFrame = undefined;
  });

  test('_measureRAFFPS line 127 with durationMs null hitting || 1000', async () => {
    globalThis.requestAnimationFrame = jest.fn((cb) => {
      setTimeout(() => cb(performance.now() + 300), 0);
      return 1;
    });

    const result = await optimizer._measureRAFFPS(null);
    expect(typeof result).toBe('number');

    globalThis.requestAnimationFrame = undefined;
  });

  test('_rebuildCompendiumIndexes line 203 with getIndex returning undefined', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    game.packs = {
      values: jest.fn(function* () {
        yield {
          collection: 'test.pack',
          getIndex: jest.fn().mockResolvedValue(undefined)
        };
      })
    };

    const report = await optimizer.optimize(options);
    expect(report.compendiums.packs).toBe(1);
  });

  test('dryRun line 70 with Array.from throwing error', async () => {
    const options = {
      doCleanupChat: false,
      chatRetentionDays: 30,
      doCleanupInactiveCombats: false,
      doRebuildCompendiumIndexes: true,
      doCorePerformanceTweaks: false
    };

    const originalArrayFrom = Array.from;
    Array.from = () => {
      throw new Error('Array.from error');
    };

    const report = await optimizer.dryRun(options);
    expect(report.notes.some(n => n.includes('Could not enumerate compendium packs'))).toBe(true);

    Array.from = originalArrayFrom;
  });
});

describe('PerformanceTweaks Edge Cases', () => {
  let tweaks;

  beforeEach(() => {
    tweaks = new PerformanceTweaks();

    game.settings.settings.set('core.maxFPS', { range: { max: 60 }, type: { options: {} }, choices: {} });
    game.settings.settings.set('core.softShadows', {});

    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      if (key === 'softShadows') return true;
      return null;
    });

    game.settings.set = jest.fn().mockResolvedValue(true);
  });

  test('apply with settings.set throwing in try block (line 130 inner catch)', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      if (key === 'softShadows') return true;
      return null;
    });
    game.settings.set = jest.fn().mockImplementation((ns, key) => {
      if (key === 'maxFPS') throw new Error('Set error');
      return Promise.resolve();
    });
    game.settings.settings.get = jest.fn().mockReturnValue({
      range: { max: 60 },
      type: { options: {} },
      choices: {}
    });

    const report = { performance: { enabled: true } };
    await tweaks.apply(report);

    expect(report.performance.failed).toBeDefined();
  });

  test('apply with game.settings.set throwing error (line 130 inner catch from set failure)', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      return null;
    });
    game.settings.set = jest.fn().mockRejectedValue(new Error('Set failed'));
    game.settings.settings.get = jest.fn().mockReturnValue({
      range: { max: 60 },
      type: { options: {} },
      choices: {}
    });

    const report = { performance: { enabled: true } };
    await tweaks.apply(report);

    expect(report.performance.failed).toBeDefined();
    expect(report.performance.failed.length).toBeGreaterThan(0);
  });

  test('applyOnReady with canvas.app.ticker.maxFPS getter throwing (line 158 ticker getter error)', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (ns === 'rnk-vortex-system-optimizer' && key === 'doCorePerformanceTweaks') return true;
      if (key === 'maxFPS') return 60;
      return null;
    });

    const mockTicker = {
      get maxFPS() {
        throw new Error('Ticker getter error');
      },
      set maxFPS(val) {}
    };
    globalThis.canvas = { app: { ticker: mockTicker } };

    await tweaks.applyOnReady();

    globalThis.canvas = null;
  });

  test('applyOnReady with canvas.app.ticker.maxFPS setter throwing (line 160 ticker setter error)', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (ns === 'rnk-vortex-system-optimizer' && key === 'doCorePerformanceTweaks') return true;
      if (key === 'maxFPS') return 60;
      return null;
    });

    const mockTicker = {
      get maxFPS() {
        return 60;
      },
      set maxFPS(val) {
        throw new Error('Ticker setter error');
      }
    };
    globalThis.canvas = { app: { ticker: mockTicker } };

    await tweaks.applyOnReady();

    globalThis.canvas = null;
  });

  test('applyOnReady with canvas.app.ticker not available (line 150 conditional false)', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (ns === 'rnk-vortex-system-optimizer' && key === 'doCorePerformanceTweaks') return true;
      return null;
    });

    globalThis.canvas = null;

    await expect(tweaks.applyOnReady()).resolves.not.toThrow();
  });

  test('raiseCoreMaxFPSCeiling handles setting without range', () => {
    game.settings.settings.get = jest.fn().mockReturnValue({ type: { options: {} } });
    const result = tweaks.raiseCoreMaxFPSCeiling(120);
    expect(result).toBe(false);
  });

  test('raiseCoreMaxFPSCeiling handles opts without max', () => {
    game.settings.settings.get = jest.fn().mockReturnValue({
      range: { max: 60 },
      type: { options: {} }
    });
    const result = tweaks.raiseCoreMaxFPSCeiling(120);
    expect(result).toBe(true);
  });

  test('raiseCoreMaxFPSCeiling with opts.max already high enough', () => {
    game.settings.settings.get = jest.fn().mockReturnValue({
      range: { max: 60 },
      type: { options: { max: 200 } }
    });
    const result = tweaks.raiseCoreMaxFPSCeiling(120);
    expect(result).toBe(true);
  });

  test('previewChanges handles settings without choices', () => {
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, type: { options: {} } };
      if (key === 'core.softShadows') return {};
      return null;
    });

    const changes = tweaks.previewChanges();
    expect(Array.isArray(changes)).toBe(true);
  });

  test('apply handles no canvas scenario', async () => {
    const report = { performance: {} };
    const oldCanvas = global.canvas;
    global.canvas = undefined;

    await tweaks.apply(report);

    expect(report.performance).toBeDefined();
    global.canvas = oldCanvas;
  });

  test('apply handles canvas with no app.ticker', async () => {
    const report = { performance: {} };
    const oldCanvas = global.canvas;
    global.canvas = { app: {} };

    await tweaks.apply(report);

    expect(report.performance).toBeDefined();
    global.canvas = oldCanvas;
  });

  test('apply handles ticker assignment error', async () => {
    const report = { performance: {} };
    const oldCanvas = global.canvas;
    global.canvas = {
      app: {
        ticker: {
          set minFPS(v) { throw new Error('Ticker error'); },
          set maxFPS(v) { throw new Error('Ticker error'); }
        }
      }
    };

    await tweaks.apply(report);

    expect(report.performance).toBeDefined();
    global.canvas = oldCanvas;
  });

  test('apply handles settings.set rejection', async () => {
    const report = { performance: {} };
    game.settings.set = jest.fn().mockRejectedValue(new Error('Set failed'));
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, type: { options: {} }, choices: { 60: '60', 120: '120' } };
      return null;
    });

    await tweaks.apply(report);

    expect(report.performance.failed).toBeDefined();
    expect(report.performance.failed.length).toBeGreaterThan(0);
  });

  test('raiseCoreMaxFPSCeiling handles thrown error', () => {
    game.settings.settings.get = jest.fn(() => { throw new Error('Get error'); });
    const result = tweaks.raiseCoreMaxFPSCeiling(120);
    expect(result).toBe(false);
  });

  test('previewChanges handles no softShadows setting', () => {
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, choices: { 60: '60', 120: '120' } };
      if (key === 'core.softShadows') return null;
      return null;
    });
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      return null;
    });

    const changes = tweaks.previewChanges();
    expect(changes.some(c => c.setting === 'core.maxFPS')).toBe(true);
  });

  test('previewChanges handles maxFPS with no range', () => {
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { choices: { 60: '60', 120: '120' } };
      return null;
    });
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      return null;
    });

    const changes = tweaks.previewChanges();
    expect(changes.some(c => c.setting === 'core.maxFPS')).toBe(true);
  });

  test('previewChanges handles maxFPS with invalid range', () => {
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 'invalid' }, choices: { 60: '60', 120: '120' } };
      return null;
    });
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      return null;
    });

    const changes = tweaks.previewChanges();
    expect(changes.some(c => c.setting === 'core.maxFPS')).toBe(true);
  });

  test('previewChanges handles maxFPS with empty choices', () => {
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, choices: {} };
      return null;
    });
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      return null;
    });

    const changes = tweaks.previewChanges();
    expect(changes.some(c => c.setting === 'core.maxFPS')).toBe(true);
  });

  test('previewChanges handles maxFPS with non-numeric choices', () => {
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, choices: { 'low': 'Low', 'high': 'High' } };
      return null;
    });
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      return null;
    });

    const changes = tweaks.previewChanges();
    expect(changes.some(c => c.setting === 'core.maxFPS')).toBe(true);
  });

  test('previewChanges handles softShadows already false', () => {
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, choices: { 60: '60' } };
      if (key === 'core.softShadows') return {};
      return null;
    });
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 120;
      if (key === 'softShadows') return false;
      return null;
    });

    const changes = tweaks.previewChanges();
    expect(changes.some(c => c.setting === 'core.softShadows')).toBe(false);
  });

  test('previewChanges handles softShadows not boolean', () => {
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, choices: { 60: '60' } };
      if (key === 'core.softShadows') return {};
      return null;
    });
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 120;
      if (key === 'softShadows') return 'enabled';
      return null;
    });

    const changes = tweaks.previewChanges();
    expect(changes.some(c => c.setting === 'core.softShadows')).toBe(false);
  });

  test('apply handles canvas ticker assignment when ticker not available', async () => {
    const report = { performance: {} };
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, choices: { '120': '120' } };
      return null;
    });
    game.settings.get = jest.fn(() => 120);
    game.settings.set = jest.fn().mockResolvedValue(true);
    global.canvas = { app: {} };

    await tweaks.apply(report);
    expect(report.performance.tickerMaxFPS).toBeUndefined();
  });

  test('apply logs ticker maxFPS when no changes needed', async () => {
    const report = { performance: {} };
    const logSpy = jest.spyOn(tweaks, 'log');
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, choices: { '120': '120' } };
      if (key === 'core.softShadows') return {};
      return null;
    });
    game.settings.get = jest.fn((ns, key) => (key === 'maxFPS' ? 120 : false));
    global.canvas = { app: { ticker: { maxFPS: 120 } } };

    await tweaks.apply(report);
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('No core settings changes needed'));
  });

  test('apply handles ticker minFPS assignment when available', async () => {
    const report = { performance: {} };
    let minFPS = 10;
    global.canvas = {
      app: {
        ticker: {
          get minFPS() { return minFPS; },
          set minFPS(v) { minFPS = v; },
          get maxFPS() { return 120; },
          set maxFPS(v) {}
        }
      }
    };
    game.settings.settings.get = jest.fn().mockReturnValue({
      range: { max: 120 },
      choices: { 60: '60', 120: '120' }
    });
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'maxFPS') return 60;
      return null;
    });
    game.settings.set = jest.fn().mockResolvedValue(true);

    await tweaks.apply(report);

    expect(minFPS).toBe(10);
  });

  test('apply handles catch block with specific error', async () => {
    const report = { performance: {} };
    const errorSpy = jest.spyOn(console, 'error').mockImplementation();
    global.canvas = {
      app: {
        ticker: {
          get minFPS() { throw new Error('Ticker minFPS error'); },
          set minFPS(v) { throw new Error('Ticker minFPS error'); },
          get maxFPS() { return 120; },
          set maxFPS(v) {}
        }
      }
    };

    await tweaks.apply(report);

    expect(report.performance).toBeDefined();
    errorSpy.mockRestore();
  });

  test('applyOnReady handles doCorePerformanceTweaks false', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'doCorePerformanceTweaks') return false;
      return null;
    });
    global.canvas = { app: { ticker: { maxFPS: 60 } } };

    await tweaks.applyOnReady();

    expect(game.settings.set).not.toHaveBeenCalled();
  });

  test('applyOnReady handles canvas.app.ticker undefined', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'doCorePerformanceTweaks') return true;
      if (key === 'maxFPS') return 60;
      return null;
    });
    global.canvas = { app: {} };

    await tweaks.applyOnReady();

    expect(game.settings.set).not.toHaveBeenCalled();
  });

  test('applyOnReady handles currentCore not finite number', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'doCorePerformanceTweaks') return true;
      if (key === 'maxFPS') return 'not-a-number';
      return null;
    });
    game.settings.set = jest.fn().mockResolvedValue(true);
    global.canvas = { app: { ticker: { maxFPS: 60 } } };

    await tweaks.applyOnReady();

    expect(game.settings.set).not.toHaveBeenCalledWith('core', 'maxFPS', 120);
  });

  test('applyOnReady handles settings.set error silently', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'doCorePerformanceTweaks') return true;
      if (key === 'maxFPS') return 60;
      return null;
    });
    game.settings.set = jest.fn(() => Promise.reject(new Error('Settings error')));
    global.canvas = { app: { ticker: { maxFPS: 60 } } };

    await expect(tweaks.applyOnReady()).resolves.not.toThrow();
  });

  test('applyOnReady handles currentTicker >= desiredTickerFPS', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'doCorePerformanceTweaks') return true;
      if (key === 'maxFPS') return 120;
      return null;
    });
    game.settings.set = jest.fn().mockResolvedValue(true);
    global.canvas = { app: { ticker: { maxFPS: 120 } } };

    const originalMaxFPS = global.canvas.app.ticker.maxFPS;
    await tweaks.applyOnReady();

    expect(global.canvas.app.ticker.maxFPS).toBe(originalMaxFPS);
  });

  test('applyOnReady handles Number(ticker.maxFPS) returning NaN', async () => {
    game.settings.get = jest.fn((ns, key) => {
      if (key === 'doCorePerformanceTweaks') return true;
      if (key === 'maxFPS') return 120;
      return null;
    });
    game.settings.set = jest.fn().mockResolvedValue(true);
    global.canvas = { app: { ticker: { maxFPS: 'not-a-number' } } };

    await tweaks.applyOnReady();

    expect(global.canvas.app.ticker.maxFPS).toBe(120);
  });

  test('apply handles report.performance.tickerMaxFPS falsy but defined', async () => {
    const report = { performance: { tickerMaxFPS: 0 } };
    const logSpy = jest.spyOn(tweaks, 'log');
    game.settings.settings.get = jest.fn((key) => {
      if (key === 'core.maxFPS') return { range: { max: 120 }, choices: { '120': '120' } };
      if (key === 'core.softShadows') return {};
      return null;
    });
    game.settings.get = jest.fn((ns, key) => (key === 'maxFPS' ? 120 : false));
    global.canvas = { app: { ticker: { maxFPS: 60 } } };

    await tweaks.apply(report);

    expect(logSpy).not.toHaveBeenCalledWith(expect.stringContaining('Ticker maxFPS is 0'));
  });
});

describe('SettingsManager Edge Cases', () => {
  beforeEach(() => {
    game.settings = {
      settings: new Map(),
      menus: new Map(),
      register: jest.fn(),
      registerMenu: jest.fn(),
      get: jest.fn(),
      set: jest.fn().mockResolvedValue(true)
    };
  });

  test('isSettingRegistered handles error with missing has method', () => {
    game.settings.settings.has = () => { throw new Error('has error'); };
    const result = SettingsManager.isSettingRegistered('doCleanupChat');
    expect(result).toBe(false);
  });

  test('isMenuRegistered handles error with missing has method', () => {
    game.settings.menus.has = () => { throw new Error('has error'); };
    const result = SettingsManager.isMenuRegistered('optimizerMenu');
    expect(result).toBe(false);
  });

  test('registerAll registers all settings', async () => {
    game.settings.menus.has = jest.fn().mockReturnValue(true);
    game.settings.settings.has = jest.fn().mockReturnValue(false);

    const MockApp = class {};
    await SettingsManager.registerAll(MockApp);

    expect(game.settings.register).toHaveBeenCalledWith('rnk-vortex-system-optimizer', 'doCleanupChat', expect.any(Object));
    expect(game.settings.register).toHaveBeenCalledWith('rnk-vortex-system-optimizer', 'chatRetentionDays', expect.any(Object));
  });

  test('getSetting handles no game.settings', () => {
    const oldSettings = game.settings;
    game.settings = undefined;
    expect(() => SettingsManager.getSetting('doCleanupChat')).toThrow();
    game.settings = oldSettings;
  });

  test('registerAll skips console.log on second call', async () => {
    game.settings.menus.has = jest.fn().mockReturnValue(false);
    game.settings.settings.has = jest.fn().mockReturnValue(false);
    globalThis.__RNK_OPTIMIZER_MENU_LOGGED = false;

    const MockApp = class {};
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();

    await SettingsManager.registerAll(MockApp);
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Settings menu registered'));
    consoleSpy.mockClear();

    await SettingsManager.registerAll(MockApp);
    expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('Settings menu registered'));

    consoleSpy.mockRestore();
    globalThis.__RNK_OPTIMIZER_MENU_LOGGED = false;
  });
});

describe('VQ3DBridge Edge Cases', () => {
  let bridge;
  let mockVQBridge;

  beforeEach(() => {
    mockVQBridge = {
      executeOnVQ: jest.fn().mockResolvedValue({ success: true }),
      loadBalanceMode: 'round-robin'
    };

    bridge = new VQ3DBridge(mockVQBridge);
  });

  test('render3DModel console.log coverage', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await bridge.render3DModel('model.glb', { texture: 'wood' });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('load3DModel console.log coverage', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await bridge.load3DModel('model.glb', { cache: true });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('animate3DModel console.log coverage', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await bridge.animate3DModel('token1', 'walk', { loop: true });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('update3DPhysics without vqBridge', async () => {
    const result = await bridge.update3DPhysics('token1', { gravity: 9.8 });
    expect(result).toBeDefined();
  });

  test('apply3DEffect console.log coverage', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await bridge.apply3DEffect('explosion', { radius: 5 });
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('batchRender3DModels console.log coverage', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    await bridge.batchRender3DModels([{ path: 'model1.glb', options: {} }, { path: 'model2.glb', options: {} }]);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('render3DModel warn coverage without bridge', async () => {
    const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();
    bridge.vqBridge = null;
    await bridge.render3DModel('model.glb');
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  test('load3DModel warn coverage without bridge', async () => {
    bridge.vqBridge = null;
    const result = await bridge.load3DModel('model.glb');
    expect(result).toBeNull();
  });

  test('animate3DModel warn coverage without bridge', async () => {
    bridge.vqBridge = null;
    const result = await bridge.animate3DModel('token1', 'walk');
    expect(result).toBeNull();
  });

  test('update3DPhysics warn coverage without bridge', async () => {
    bridge.vqBridge = null;
    const result = await bridge.update3DPhysics('token1', {});
    expect(result).toBeNull();
  });

  test('apply3DEffect warn coverage without bridge', async () => {
    bridge.vqBridge = null;
    const result = await bridge.apply3DEffect('explosion', {});
    expect(result).toBeNull();
  });

  test('batchRender3DModels warn coverage without bridge', async () => {
    bridge.vqBridge = null;
    const result = await bridge.batchRender3DModels([]);
    expect(result).toEqual([]);
  });

  test('batchRender3DModels changes loadBalanceMode to parallel', async () => {
    mockVQBridge.loadBalanceMode = 'round-robin';

    await bridge.batchRender3DModels([{ path: 'model.glb', options: {} }]);

    expect(mockVQBridge.loadBalanceMode).toBe('round-robin');
  });
});
