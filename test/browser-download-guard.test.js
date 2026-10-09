/**
 * Browser download guard tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { createDownloadExtension, DOWNLOAD_EXTENSION_VERSION, NATIVE_HOST_NAME } from '../browser/download-guard.js';

function browserHarness() {
  const listeners = new Set();
  const filenameListeners = new Set();
  const notifications = [];
  const ports = [];
  const cancelled = [];
  const api = {
    downloads: { onCreated: { addListener: (listener) => listeners.add(listener), removeListener: (listener) => listeners.delete(listener) }, onDeterminingFilename: { addListener: (listener) => filenameListeners.add(listener), removeListener: (listener) => filenameListeners.delete(listener) }, cancel: jest.fn(async (id) => { cancelled.push(id); }) },
    runtime: { connectNative: jest.fn(() => {
      const messageListeners = new Set();
      const port = { postMessage: jest.fn(), disconnect: jest.fn(), onMessage: { addListener: (listener) => messageListeners.add(listener) }, onDisconnect: { addListener: (listener) => listener() }, emit: (value) => messageListeners.forEach((listener) => listener(value)) };
      ports.push(port);
      return port;
    }) }
  };
  return { api, listeners, filenameListeners, notifications, ports, cancelled };
}

describe('browser download guard', () => {
  test('requires browser native messaging APIs', () => {
    expect(() => createDownloadExtension()).toThrow('downloads API');
    expect(() => createDownloadExtension({ api: { downloads: { onCreated: { addListener: jest.fn() } } } })).toThrow('native messaging');
    const h = browserHarness();
    expect(() => createDownloadExtension({ api: h.api, hostName: '' })).toThrow('host name');
  });

  test('sends bounded download facts and notifies only redirect decisions', () => {
    const h = browserHarness();
    const extension = createDownloadExtension({ api: h.api, destinationMount: 'C:', notify: (item) => h.notifications.push(item) });
    expect(extension).toMatchObject({ version: DOWNLOAD_EXTENSION_VERSION, hostName: NATIVE_HOST_NAME });
    expect(extension.attach()).toEqual({ state: 'attached' });
    const listener = [...h.listeners][0];
    listener({ id: 7, fileSize: 1200 });
    expect(h.api.runtime.connectNative).toHaveBeenCalledWith(NATIVE_HOST_NAME);
    expect(h.ports[0].postMessage).toHaveBeenCalledWith({ type: 'download-preflight', requestId: 'download-7', sizeBytes: 1200, destinationMount: 'C:' });
    h.ports[0].emit({ state: 'redirect', targetMount: 'E:' });
    expect(h.notifications).toEqual([{ downloadId: 7, result: { state: 'redirect', targetMount: 'E:' } }]);
    listener({ id: 8, fileSize: 0 });
    h.ports[1].emit({ state: 'allow' });
    expect(h.ports[1].postMessage).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'download-8', sizeBytes: null }));
    expect(extension.detach()).toEqual({ state: 'detached' });
    const noMount = createDownloadExtension({ api: h.api });
    noMount.attach();
    const noMountListener = [...h.listeners][0];
    noMountListener({ id: 9, fileSize: 1 });
    h.ports[2].emit({ state: 'insufficient-space' });
    noMount.detach();
  });

  test('supports explicit bounded cancellation during filename determination', async () => {
    const h = browserHarness();
    const extension = createDownloadExtension({ api: h.api, enforceStates: ['insufficient-space'], notify: (item) => h.notifications.push(item) });
    expect(extension.enforceStates).toEqual(['insufficient-space']);
    extension.attach();
    const listener = [...h.filenameListeners][0];
    const suggest = jest.fn();
    listener({ id: 12, fileSize: 99 }, suggest);
    expect(suggest).toHaveBeenCalled();
    h.ports[0].emit({ state: 'insufficient-space' });
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.cancelled).toEqual([12]);
    expect(h.notifications).toEqual([{ downloadId: 12, result: { state: 'insufficient-space' }, action: 'cancelled' }]);
    extension.detach();
    expect(h.filenameListeners.size).toBe(0);
  });

  test('fails closed when enforcement APIs or states are invalid', () => {
    const h = browserHarness();
    expect(() => createDownloadExtension({ api: h.api, enforceStates: ['allow'] })).toThrow('enforceStates');
    expect(() => createDownloadExtension({ api: { ...h.api, downloads: { ...h.api.downloads, cancel: null } }, enforceStates: ['redirect'] })).toThrow('cancellation');
    expect(() => createDownloadExtension({ api: { ...h.api, downloads: { ...h.api.downloads, onDeterminingFilename: null } }, enforceStates: ['redirect'] })).toThrow('filename determination');
  });
});
