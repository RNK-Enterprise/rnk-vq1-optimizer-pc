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
 * System Optimizer - Main Entry Point
 *
 * The installed module is a thin Foundry control plane. It collects local
 * performance telemetry, calls the Foundry-side gateway, and applies only
 * validated data-only plans. VQ implementations never ship in this module.
 */

const MODULE_ID = 'rnk-vortex-system-optimizer';
let components = null;
let gmHub = null;

async function loadGMHub() {
  if (components) return components;
  components = await Promise.all([
    import('./gm-hub-ui.js'),
    import('./settings-manager.js')
  ]);
  return components;
}

async function lazyLoadComponents() {
  return loadGMHub();
}

async function openGMHub() {
  const [{ GMHubUI }] = await loadGMHub();
  if (!game.user?.isGM) {
    ui.notifications.warn('GM only.');
    return null;
  }
  if (!gmHub) gmHub = new GMHubUI();
  return gmHub.render(true);
}

function installIncomingPlanHandler() {
  if (!game?.socket?.on || globalThis.__RNK_OPTIMIZER_SOCKET_INSTALLED) return;
  globalThis.__RNK_OPTIMIZER_SOCKET_INSTALLED = true;
  game.socket.on(`module.${MODULE_ID}`, async (message) => {
    if (!message || message.type !== 'gm-plan' || message.senderId === game.user?.id) return;
    if (game.user?.isGM) return;
    try {
      const { applyIncomingGMPlan } = await import('./gm-hub-ui.js');
      const clientId = globalThis.__RNK_OPTIMIZER_CLIENT_ID || null;
      await applyIncomingGMPlan(message.plan, clientId);
      ui.notifications.info('GM performance plan applied.');
    } catch (error) {
      console.warn(`${MODULE_ID} | incoming plan rejected`, error);
      ui.notifications.warn('A GM performance plan could not be applied safely.');
    }
  });
}

Hooks.once('init', async () => {
  console.log(`${MODULE_ID} | Initializing API-only GM Performance Hub`);
  const [{ GMHubUI }, { SettingsManager }] = await loadGMHub();
  await SettingsManager.registerAll(GMHubUI);
  globalThis.RNKSystemOptimizerApp = GMHubUI;
});

Hooks.once('ready', async () => {
  const [{ GMHubUI }, { SettingsManager }] = await loadGMHub();
  await SettingsManager.registerAll(GMHubUI);
  installIncomingPlanHandler();
  if (game.user?.isGM) {
    let openOnStartup = false;
    try {
      openOnStartup = game.settings.get(MODULE_ID, 'openHubOnStartup') === true;
    } catch {
      openOnStartup = false;
    }
    if (openOnStartup) await openGMHub();
  }
});

Hooks.on('getSceneControlButtons', (controls) => {
  if (!game.user?.isGM) return;
  const controlsArr = Array.isArray(controls)
    ? controls
    : (Array.isArray(controls?.controls)
      ? controls.controls
      : (Array.isArray(controls?.sceneControls) ? controls.sceneControls : null));
  if (!controlsArr) return;
  const tokenControls = controlsArr.find((control) => control?.name === 'token');
  if (!tokenControls) return;
  if (!Array.isArray(tokenControls.tools)) tokenControls.tools = [];
  if (tokenControls.tools.some((tool) => tool?.name === 'rnk-system-optimizer')) return;
  tokenControls.tools.push({
    name: 'rnk-system-optimizer',
    title: 'GM Performance Hub',
    icon: 'fas fa-tachometer-alt',
    onClick: () => openGMHub().catch((error) => {
      console.error(`${MODULE_ID} | GM Hub failed to open`, error);
      ui.notifications.error('GM Performance Hub failed to open.');
    }),
    button: true
  });
});

export { loadGMHub, lazyLoadComponents, openGMHub, installIncomingPlanHandler };
