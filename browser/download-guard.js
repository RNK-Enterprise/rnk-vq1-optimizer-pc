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
const ENFORCEABLE_STATES = Object.freeze(['redirect', 'insufficient-space']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function positiveBytes(value) { return Number.isFinite(value) && value > 0 ? value : null; }

function apiOrThrow(api) {
  if (!record(api) || !record(api.downloads) || typeof api.downloads.onCreated?.addListener !== 'function') {
    throw new TypeError('Download extension requires a browser downloads API');
  }
  if (typeof api.runtime?.connectNative !== 'function') throw new TypeError('Download extension requires native messaging');
  return api;
}

function enforceStates(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((state) => !ENFORCEABLE_STATES.includes(state))) throw new TypeError('Download extension enforceStates is invalid');
  return [...new Set(value)];
}

function messageFor(item, destinationMount) {
  return { type: 'download-preflight', requestId: `download-${item.id}`, sizeBytes: positiveBytes(item.fileSize), destinationMount: typeof destinationMount === 'string' ? destinationMount : null };
}

export function createDownloadExtension({ api, destinationMount = null, hostName = NATIVE_HOST_NAME, notify = () => {}, enforceStates: requestedStates, redirectPolicy = null } = {}) {
  const browserApi = apiOrThrow(api);
  if (typeof hostName !== 'string' || !hostName.trim()) throw new TypeError('Download extension host name is required');
  const states = enforceStates(requestedStates);
  const redirectEnabled = record(redirectPolicy);
  if (redirectEnabled && typeof browserApi.downloads.onChanged?.addListener !== 'function') throw new TypeError('Download extension redirection requires download change events');
  if (states.length && typeof browserApi.downloads.cancel !== 'function') throw new TypeError('Download extension enforcement requires downloads cancellation');
  if (states.length && typeof browserApi.downloads.onDeterminingFilename?.addListener !== 'function') throw new TypeError('Download extension enforcement requires filename determination');
  const pendingRedirects = new Map();
  function notifyDecision(item, result, action = null) {
    if (!record(result) || !ENFORCEABLE_STATES.includes(result.state)) return;
    notify(action ? { downloadId: item.id, result, action } : { downloadId: item.id, result });
  }
  function observe(item, onResult) {
    const port = browserApi.runtime.connectNative(hostName);
    port.onMessage?.addListener((result) => { onResult(result); port.disconnect?.(); });
    port.onDisconnect?.addListener(() => {});
    port.postMessage(messageFor(item, destinationMount));
    return port;
  }
  function observeRedirect(item, result) {
    if (!redirectEnabled || result?.state !== 'redirect') return;
    pendingRedirects.set(item.id, { item, result });
  }
  function onCreated(item) {
    observe(item, (result) => { observeRedirect(item, result); notifyDecision(item, result); });
  }
  function onDeterminingFilename(item, suggest) {
    if (typeof suggest === 'function') suggest();
    observe(item, (result) => {
      if (!record(result) || !states.includes(result.state)) return notifyDecision(item, result);
      Promise.resolve(browserApi.downloads.cancel(item.id))
        .then(() => notifyDecision(item, result, 'cancelled'))
        .catch(() => notifyDecision(item, result, 'cancel-failed'));
    });
  }
  function onChanged(change) {
    if (!redirectEnabled || change?.state?.current !== 'complete') return;
    const pending = pendingRedirects.get(change.id);
    pendingRedirects.delete(change.id);
    const sourcePath = change.filename?.current;
    if (!pending || typeof sourcePath !== 'string' || !sourcePath.trim()) {
      if (pending) notify({ downloadId: change.id, result: pending.result, action: 'redirect-source-unavailable' });
      return;
    }
    const port = browserApi.runtime.connectNative(hostName);
    port.onMessage?.addListener((result) => { notify({ downloadId: change.id, result, action: 'redirected' }); port.disconnect?.(); });
    port.onDisconnect?.addListener(() => {});
    port.postMessage({ type: 'download-redirect', requestId: `redirect-${change.id}`, sourcePath, sizeBytes: positiveBytes(pending.item.fileSize), targetMount: pending.result.targetMount });
  }
  return Object.freeze({ version: DOWNLOAD_EXTENSION_VERSION, hostName, enforceStates: Object.freeze(states), redirectEnabled, attach() { browserApi.downloads.onCreated.addListener(onCreated); if (states.length) browserApi.downloads.onDeterminingFilename.addListener(onDeterminingFilename); if (redirectEnabled) browserApi.downloads.onChanged.addListener(onChanged); return { state: 'attached' }; }, detach() { browserApi.downloads.onCreated.removeListener?.(onCreated); if (states.length) browserApi.downloads.onDeterminingFilename.removeListener?.(onDeterminingFilename); if (redirectEnabled) browserApi.downloads.onChanged.removeListener?.(onChanged); pendingRedirects.clear(); return { state: 'detached' }; }, messageFor });
}
