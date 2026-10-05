/**
 * RNK Vortex System Optimizer
 * Copyright © 2025 Asgard Innovations / RNK™
 * Contributor: Lisa's Dungeon
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
 * Guarded browser capability probes shared by the Foundry and PC hosts.
 * Missing browser APIs degrade to explicit null or false values.
 */

function readNavigator(navigatorRef) {
  if (navigatorRef !== undefined) return navigatorRef ?? {};
  return globalThis?.navigator ?? {};
}

function readDocument(documentRef) {
  if (documentRef !== undefined) return documentRef;
  return globalThis?.document;
}

async function readBattery(nav) {
  if (typeof nav.getBattery !== 'function') return null;
  try {
    const battery = await nav.getBattery();
    return { charging: battery.charging !== false };
  } catch {
    return null;
  }
}

function readWebgl(documentRef) {
  try {
    const canvas = documentRef?.createElement?.('canvas');
    if (!canvas) return null;
    return (canvas.getContext('webgl2') && '2.0') || (canvas.getContext('webgl') && '1.0') || null;
  } catch {
    return null;
  }
}

async function readWebgpu(nav) {
  try {
    return typeof nav.gpu?.requestAdapter === 'function'
      ? Boolean(await nav.gpu.requestAdapter())
      : false;
  } catch {
    return false;
  }
}

/**
 * Build the shared environment shape from guarded browser APIs.
 *
 * @param {Object} [options]
 * @param {string} [options.host='browser'] - Host identity for the protocol.
 * @param {Object} [options.navigatorRef] - Navigator-like test/runtime object.
 * @param {Object} [options.documentRef] - Document-like test/runtime object.
 * @returns {Promise<Object>} Normalized environment.
 */
export async function createBrowserEnvironment({
  host = 'browser',
  navigatorRef,
  documentRef
} = {}) {
  const nav = readNavigator(navigatorRef);
  const doc = readDocument(documentRef);
  const uaData = nav.userAgentData;
  const platformType = nav.platform || uaData?.platform || 'browser';
  const mobile = uaData?.mobile ?? /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent ?? '');
  const battery = await readBattery(nav);
  const webgl = readWebgl(doc);
  const webgpu = await readWebgpu(nav);
  const connection = nav.connection ?? {};

  return {
    platform: { host, type: platformType, mobile: mobile === true },
    runtime: mobile ? 'lite' : 'standard',
    hardware: {
      cpu: { cores: Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : null },
      memory: Number.isFinite(nav.deviceMemory) ? { total: nav.deviceMemory * 1024 ** 3 } : null,
      battery
    },
    capabilities: {
      wasm: typeof WebAssembly === 'object' && WebAssembly !== null,
      webgl,
      webgpu
    },
    network: {
      effectiveType: connection.effectiveType ?? null,
      saveData: connection.saveData === true
    }
  };
}
