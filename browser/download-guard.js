/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Browser-side advisory adapter. It uses browser native messaging only and
 * never requests arbitrary URLs, paths, or network endpoints.
 */

export const DOWNLOAD_EXTENSION_VERSION = 1;
export const NATIVE_HOST_NAME = 'com.rnk.enterprise.optimizer';

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function positiveBytes(value) { return Number.isFinite(value) && value > 0 ? value : null; }

function apiOrThrow(api) {
  if (!record(api) || !record(api.downloads) || typeof api.downloads.onCreated?.addListener !== 'function') {
    throw new TypeError('Download extension requires a browser downloads API');
  }
  if (typeof api.runtime?.connectNative !== 'function') throw new TypeError('Download extension requires native messaging');
  return api;
}

function messageFor(item, destinationMount) {
  return { type: 'download-preflight', requestId: `download-${item.id}`, sizeBytes: positiveBytes(item.fileSize), destinationMount: typeof destinationMount === 'string' ? destinationMount : null };
}

export function createDownloadExtension({ api, destinationMount = null, hostName = NATIVE_HOST_NAME, notify = () => {} } = {}) {
  const browserApi = apiOrThrow(api);
  if (typeof hostName !== 'string' || !hostName.trim()) throw new TypeError('Download extension host name is required');
  function onCreated(item) {
    const port = browserApi.runtime.connectNative(hostName);
    const message = messageFor(item, destinationMount);
    port.onMessage?.addListener((result) => {
      if (record(result) && ['redirect', 'insufficient-space'].includes(result.state)) notify({ downloadId: item.id, result });
      port.disconnect?.();
    });
    port.onDisconnect?.addListener(() => {});
    port.postMessage(message);
  }
  return Object.freeze({ version: DOWNLOAD_EXTENSION_VERSION, hostName, attach() { browserApi.downloads.onCreated.addListener(onCreated); return { state: 'attached' }; }, detach() { browserApi.downloads.onCreated.removeListener?.(onCreated); return { state: 'detached' }; }, messageFor });
}
