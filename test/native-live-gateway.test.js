/**
 * Live gateway verification tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { verifyLiveGateway, verifyLiveGatewayWithAdapter } from '../native/live-gateway.js';

const now = 1000000;
const plan = { protocolVersion: 1, planId: 'live-plan', expiresAt: new Date(now + 60000).toISOString(), actions: [] };

describe('live gateway verification', () => {
  test('verifies a bounded response without applying actions', async () => {
    const fetchFn = jest.fn(async (url, request) => {
      expect(url).toBe('https://gateway.example/plan');
      expect(request.headers['x-optimizer-token']).toBe('token');
      expect(JSON.parse(request.body).profile).toBe('gaming');
      return { ok: true, json: async () => ({ plan }) };
    });
    await expect(verifyLiveGateway({ gatewayUrl: 'https://gateway.example/plan', facts: { platform: 'win32' }, profile: 'gaming', gatewayToken: 'token', fetchFn, now: () => now })).resolves.toMatchObject({ state: 'verified', planId: 'live-plan', actionCount: 0 });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  test('accepts a response body directly and omits blank token', async () => {
    const fetchFn = jest.fn(async (_url, request) => {
      expect(request.headers).toEqual({ 'content-type': 'application/json' });
      return { ok: true, json: async () => plan };
    });
    await expect(verifyLiveGateway({ gatewayUrl: 'https://gateway.example/plan', facts: {}, gatewayToken: ' ', fetchFn, now: () => now })).resolves.toMatchObject({ state: 'verified', protocolVersion: 1 });
  });

  test('reports gateway status, malformed response, and network failures', async () => {
    await expect(verifyLiveGateway({ gatewayUrl: 'https://gateway.example/plan', facts: {}, fetchFn: async () => ({ ok: false, status: 503 }), now: () => now })).resolves.toMatchObject({ state: 'rejected', status: 503 });
    await expect(verifyLiveGateway({ gatewayUrl: 'https://gateway.example/plan', facts: {}, fetchFn: async () => ({ ok: true }), now: () => now })).resolves.toMatchObject({ state: 'rejected', reason: 'gateway returned no JSON response' });
    await expect(verifyLiveGateway({ gatewayUrl: 'https://gateway.example/plan', facts: {}, fetchFn: async () => { throw new Error('offline'); }, now: () => now })).resolves.toMatchObject({ state: 'unavailable', reason: 'offline' });
    await expect(verifyLiveGateway({ gatewayUrl: 'https://gateway.example/plan', facts: {}, fetchFn: async () => ({ ok: true, json: async () => ({ plan: { ...plan, expiresAt: new Date(now - 1).toISOString() } }) }), now: () => now })).resolves.toMatchObject({ state: 'unavailable', reason: 'Native plan expired' });
  });

  test('rejects invalid verification inputs and delegates to an adapter', async () => {
    await expect(verifyLiveGateway({ gatewayUrl: 'http://remote.example/plan', facts: {}, fetchFn: jest.fn() })).rejects.toThrow('Remote optimizer gateways must use HTTPS');
    await expect(verifyLiveGateway({ gatewayUrl: 'https://gateway.example/plan', facts: [], fetchFn: jest.fn() })).rejects.toThrow('facts');
    await expect(verifyLiveGateway({ gatewayUrl: 'https://gateway.example/plan', facts: {}, fetchFn: null })).rejects.toThrow('Fetch');
    await expect(verifyLiveGateway({ gatewayUrl: 'https://gateway.example/plan', facts: {}, timeoutMs: 0, fetchFn: jest.fn() })).rejects.toThrow('timeout');
    await expect(verifyLiveGateway({ gatewayUrl: 'https://gateway.example/plan', facts: {}, profile: 'unknown', fetchFn: jest.fn() })).rejects.toThrow('profile');
    await expect(verifyLiveGatewayWithAdapter({ gatewayUrl: 'https://gateway.example/plan', adapter: {}, fetchFn: jest.fn() })).rejects.toThrow('platform adapter');
    const adapter = { collectFacts: jest.fn(async () => ({ platform: 'linux' })) };
    await expect(verifyLiveGatewayWithAdapter({ gatewayUrl: 'https://gateway.example/plan', adapter, fetchFn: async () => ({ ok: true, json: async () => plan }), now: () => now })).resolves.toMatchObject({ state: 'verified' });
  });
});
