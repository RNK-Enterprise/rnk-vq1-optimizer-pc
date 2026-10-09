/**
 * Browser redirect bridge tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { handleBrowserMessage } from '../native/browser-bridge.js';

const factsProvider = async () => ({ volumes: { volumes: [{ mount: 'E:', freeBytes: 1000 }] } });

describe('browser redirect bridge', () => {
  test('returns a preview through the trusted root policy', async () => {
    await expect(handleBrowserMessage({ type: 'download-redirect', requestId: 'r1', sourcePath: 'C:/Downloads/game.zip', sizeBytes: 100, targetMount: 'E:' }, { factsProvider, redirectPolicy: { sourceRoot: 'C:/Downloads', targetRoots: { 'E:': 'E:/Games' } } })).resolves.toMatchObject({ type: 'download-redirect-result', state: 'redirect-preview', redirect: { plan: { state: 'preview-ready' } } });
    await expect(handleBrowserMessage({ type: 'download-redirect', requestId: 'r2', sourcePath: 'C:/Downloads/game.zip', sizeBytes: 100, targetMount: 'E:' }, { factsProvider })).rejects.toThrow('policy');
    await expect(handleBrowserMessage({ type: 'download-redirect', requestId: 'r3', sourcePath: 'E:/Downloads/game.zip', sizeBytes: 100, targetMount: 'E:' }, { factsProvider, redirectPolicy: { sourceRoot: 'C:/Downloads', targetRoots: { 'E:': 'E:/Games' } } })).resolves.toMatchObject({ state: 'rejected', redirect: { plan: { state: 'rejected' } } });
    await expect(handleBrowserMessage({ type: 'download-redirect', requestId: 'r4', sourcePath: 'C:/Downloads/game.zip', sizeBytes: 100, targetMount: 'E:' }, { factsProvider: async () => ({}), redirectPolicy: { sourceRoot: 'C:/Downloads', targetRoots: { 'E:': 'E:/Games' } } })).resolves.toMatchObject({ state: 'observation-required' });
    await expect(handleBrowserMessage({ type: 'download-redirect', requestId: 'r5', sourcePath: 'C:/Downloads/game.zip', sizeBytes: 100, targetMount: 'E:' }, { factsProvider, redirectPolicy: { sourceRoot: 'C:/Downloads', targetRoots: { 'E:': 'E:/Games' }, approved: true } })).resolves.toMatchObject({ state: 'rejected', redirect: { state: 'rejected' } });
  });
});
