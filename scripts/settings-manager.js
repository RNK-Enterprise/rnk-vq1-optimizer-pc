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
 * Settings Manager Module
 * Handles Foundry settings registration and management
 */

const MODULE_ID = 'rnk-vortex-system-optimizer';

export class SettingsManager {
  static isSettingRegistered(key) {
    try {
      return !!game?.settings?.settings?.has?.(`${MODULE_ID}.${key}`);
    } catch (_e) {
      return false;
    }
  }

  static isMenuRegistered(menuKey) {
    try {
      return !!game?.settings?.menus?.has?.(`${MODULE_ID}.${menuKey}`);
    } catch (_e) {
      return false;
    }
  }

  static async registerAll(OptimizerApp) {
    if (!game?.settings?.register) return;

    if (!this.isMenuRegistered('optimizerMenu')) {
      try {
        game.settings.registerMenu(MODULE_ID, 'optimizerMenu', {
          name: 'Open System Optimizer',
          label: 'Open Optimizer',
          hint: 'Opens the RNK Vortex System Optimizer window.',
          icon: 'fas fa-tachometer-alt',
          type: OptimizerApp,
          restricted: true
        });

        if (!globalThis.__RNK_OPTIMIZER_MENU_LOGGED) {
          globalThis.__RNK_OPTIMIZER_MENU_LOGGED = true;
          console.log(`${MODULE_ID} | Settings menu registered`);
        }
      } catch (e) {
        console.warn(`${MODULE_ID} | registerMenu failed`, e);
      }
    }

    if (!this.isSettingRegistered('doCleanupChat')) {
      game.settings.register(MODULE_ID, 'doCleanupChat', {
        name: 'Cleanup: Prune old chat messages',
        hint: 'Deletes chat messages older than the retention window.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
      });
    }

    if (!this.isSettingRegistered('chatRetentionDays')) {
      game.settings.register(MODULE_ID, 'chatRetentionDays', {
        name: 'Cleanup: Chat retention (days)',
        hint: 'Messages older than this will be deleted when optimization runs.',
        scope: 'world',
        config: true,
        type: Number,
        default: 30
      });
    }

    if (!this.isSettingRegistered('doCleanupInactiveCombats')) {
      game.settings.register(MODULE_ID, 'doCleanupInactiveCombats', {
        name: 'Cleanup: Delete inactive combats',
        hint: 'Deletes combats that are not started and have no turns.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
      });
    }

    if (!this.isSettingRegistered('doRebuildCompendiumIndexes')) {
      game.settings.register(MODULE_ID, 'doRebuildCompendiumIndexes', {
        name: 'Compendiums: Rebuild indexes',
        hint: 'Warms/rebuilds all compendium indexes.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
      });
    }

    if (!this.isSettingRegistered('doCorePerformanceTweaks')) {
      game.settings.register(MODULE_ID, 'doCorePerformanceTweaks', {
        name: 'Performance: Apply core tweaks',
        hint: 'Applies a small set of core performance tweaks (max FPS, performance mode, soft shadows if available).',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
      });
    }

    if (!this.isSettingRegistered('optimizeOnStartup')) {
      game.settings.register(MODULE_ID, 'optimizeOnStartup', {
        name: 'Auto-run on startup',
        hint: 'Run the optimizer automatically when the world loads (GM only).',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false
      });
    }

    if (!this.isSettingRegistered('openHubOnStartup')) {
      game.settings.register(MODULE_ID, 'openHubOnStartup', {
        name: 'GM Hub: Open on startup',
        hint: 'Open the dedicated GM Performance Hub when the world is ready.',
        scope: 'client',
        config: true,
        type: Boolean,
        default: false
      });
    }

    if (!this.isSettingRegistered('vqGatewayUrl')) {
      game.settings.register(MODULE_ID, 'vqGatewayUrl', {
        name: 'VQ: Foundry gateway URL',
        hint: 'Same-origin gateway endpoint used by the GM Performance Hub. VQ addresses and credentials stay server-side.',
        scope: 'world',
        config: true,
        type: String,
        default: '/optimizer/v1'
      });
    }

    if (!this.isSettingRegistered('vqServerUrl')) {
      game.settings.register(MODULE_ID, 'vqServerUrl', {
        name: 'VQ: Server plan URL',
        hint: 'Optimizer plan endpoint of the VQ server. Empty uses this site (same-origin /optimizer/plan).',
        scope: 'world',
        config: true,
        type: String,
        default: ''
      });
    }

    if (!this.isSettingRegistered('vqConsent')) {
      game.settings.register(MODULE_ID, 'vqConsent', {
        name: 'VQ: Share performance metrics',
        hint: 'Allow the optimizer to send bounded, consent-gated metrics when requesting plans.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: true
      });
    }

    if (!this.isSettingRegistered('vqApplyActions')) {
      game.settings.register(MODULE_ID, 'vqApplyActions', {
        name: 'VQ: Apply optimizer actions',
        hint: 'Let the optimizer apply allow-listed tuning actions locally (cache, batch, runtime variant).',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
      });
    }

    if (!this.isSettingRegistered('vqMobileGuardrails')) {
      game.settings.register(MODULE_ID, 'vqMobileGuardrails', {
        name: 'VQ: Mobile guardrails',
        hint: 'On mobile devices, refuse render-distance changes and large caches on metered connections.',
        scope: 'client',
        config: true,
        type: Boolean,
        default: true
      });
    }
  }

  static getSetting(key) {
    return game.settings.get(MODULE_ID, key);
  }

  static async setSetting(key, value) {
    return await game.settings.set(MODULE_ID, key, value);
  }

  static getOptionsFromSettings() {
    return {
      doCleanupChat: this.getSetting('doCleanupChat'),
      chatRetentionDays: this.getSetting('chatRetentionDays'),
      doCleanupInactiveCombats: this.getSetting('doCleanupInactiveCombats'),
      doRebuildCompendiumIndexes: this.getSetting('doRebuildCompendiumIndexes'),
      doCorePerformanceTweaks: this.getSetting('doCorePerformanceTweaks'),
      vqGatewayUrl: this.getSetting('vqGatewayUrl')
    };
  }
}
