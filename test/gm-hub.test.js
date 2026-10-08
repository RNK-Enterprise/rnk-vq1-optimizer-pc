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
 * GM Hub API-only contract tests.
 */

import { EventEmitter } from 'events';
import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  GMHubApi, GMHubController, GM_HUB_PROTOCOL, OPTIMIZATION_PROFILES,
  TARGET_SCOPES, validateGMPlan
} from '../scripts/gm-hub.js';
import { PerformanceTelemetry } from '../scripts/telemetry.js';
import { FoundryActionHost } from '../scripts/foundry-action-host.js';
import { attachOptimizerGateway } from '../optimizer-gateway.js';

const safeAction = { type: 'set-fps-cap', key: 'fps.cap', value: 60 };
const makePlan = (extra = {}) => ({
  protocolVersion: 1, planId: 'plan-1', profile: 'balanced', scope: 'self',
  actions: [safeAction], ...extra
});
const fakeResponse = (body, ok = true, status = 200) => ({ ok, status, json: async () => body });

function httpRequest(server, path, { method = 'GET', body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = new EventEmitter();
    const response = {
      statusCode: 200,
      headers: {},
      writableEnded: false,
      setHeader(key, value) { this.headers[key.toLowerCase()] = key.toLowerCase() === 'set-cookie' ? [value] : value; },
      end(raw = '') {
        this.writableEnded = true;
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: this.statusCode, body: parsed, headers: this.headers });
      }
    };
    request.url = path;
    request.method = method;
    request.headers = {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers
    };
    request.destroy = jest.fn();
    server.emit('request', request, response);
    if (body !== undefined) {
      setImmediate(() => {
        request.emit('data', JSON.stringify(body));
        request.emit('end');
      });
    }
  });
}

describe('GM Hub protocol validation', () => {
  test('exports the supported profiles and scopes', () => {
    expect(GM_HUB_PROTOCOL).toBe(1);
    expect(OPTIMIZATION_PROFILES).toEqual(['power', 'balanced', 'performance', 'low-latency', 'battery-mobile']);
    expect(TARGET_SCOPES).toEqual(['self', 'all', 'selected']);
  });

  test('normalizes optional fields and filters untrusted values', () => {
    const result = validateGMPlan(makePlan({ planId: undefined, targetClientIds: ['a', 2], recommendations: ['r', 2] }));
    expect(result.planId).toMatch(/^gm-/);
    expect(result.targetClientIds).toEqual(['a']);
    expect(result.recommendations).toEqual(['r']);
    expect(result.expiresAt).toBeNull();
  });

  test('rejects invalid shapes, profile, scope, size, expiry, and actions', () => {
    expect(() => validateGMPlan(null)).toThrow('object');
    expect(() => validateGMPlan(makePlan({ protocolVersion: 2 }))).toThrow('protocol mismatch');
    expect(() => validateGMPlan(makePlan({ profile: 'turbo' }))).toThrow('Unknown optimization profile');
    expect(() => validateGMPlan(makePlan({ scope: 'world' }))).toThrow('Unknown optimization scope');
    expect(() => validateGMPlan(makePlan({ actions: Array(25).fill(safeAction) }))).toThrow('0-24');
    expect(() => validateGMPlan(makePlan({ expiresAt: 'invalid' }))).toThrow('valid timestamp');
    expect(() => validateGMPlan(makePlan({ expiresAt: new Date(Date.now() - 1).toISOString() }))).toThrow('expired');
    expect(() => validateGMPlan(makePlan({ actions: [{ type: 'run-shell' }] }))).toThrow('Unsupported optimizer action');
  });
});

describe('GMHubApi', () => {
  test('sends authenticated GET and POST requests to the gateway', async () => {
    const calls = [];
    const fetchFn = async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/status')) return fakeResponse({ gateway: 'online' });
      if (url.endsWith('/clients')) return fakeResponse({ clients: [] });
      if (url.endsWith('/telemetry')) return fakeResponse({ accepted: true });
      if (url.endsWith('/cleanup/recommend')) return fakeResponse({ recommendations: ['review'] });
      if (url.endsWith('/control/apply')) return fakeResponse({ accepted: true });
      return fakeResponse({ plan: makePlan() });
    };
    const api = new GMHubApi({ baseUrl: 'http://gateway/', fetchFn, token: 'secret', gmAssertion: 'gm-proof' });
    await expect(api.getStatus()).resolves.toEqual({ gateway: 'online' });
    await expect(api.getClients()).resolves.toEqual({ clients: [] });
    await expect(api.sendTelemetry('c1', { fps: {} })).resolves.toEqual({ accepted: true });
    await expect(api.requestPlan({ profile: 'power', scope: 'all', targetClientIds: ['c1'], clientId: 'gm', telemetry: {} })).resolves.toHaveProperty('profile', 'balanced');
    await expect(api.requestCleanupRecommendation({ clientId: 'gm' })).resolves.toEqual({ recommendations: ['review'] });
    await expect(api.authorizeApply({ planId: 'relay-1', scope: 'self', actionCount: 1 })).resolves.toEqual({ accepted: true });
    await expect(api.authorizeApply()).resolves.toEqual({ accepted: true });
    expect(calls.every(({ options }) => options.headers['x-optimizer-token'] === 'secret')).toBe(true);
    expect(calls.every(({ options }) => options.headers['x-foundry-gm-assertion'] === 'gm-proof')).toBe(true);
    expect(calls.find(({ url }) => url.endsWith('/status')).options.method).toBe('GET');
    expect(calls.find(({ url }) => url.endsWith('/plan')).options.method).toBe('POST');
  });

  test('rejects invalid input, failed responses, and missing plans', async () => {
    const empty = new GMHubApi({ fetchFn: async () => fakeResponse({}) });
    await expect(empty.requestPlan({ profile: 'bad' })).rejects.toThrow('Unknown optimization profile');
    await expect(empty.requestPlan({ scope: 'bad' })).rejects.toThrow('Unknown optimization scope');
    await expect(empty.requestPlan()).rejects.toThrow('Gateway response did not include a plan');
    const failed = new GMHubApi({ fetchFn: async () => fakeResponse({ error: 'down' }, false, 503) });
    await expect(failed.getStatus()).rejects.toThrow('down');
  });

  test('requires a fetch implementation and clamps timeout', () => {
    expect(() => new GMHubApi({ fetchFn: null })).not.toThrow();
    expect(new GMHubApi({ fetchFn: async () => fakeResponse({}), timeoutMs: 0 }).timeoutMs).toBe(7000);
  });
});

describe('GMHubController', () => {
  const makeController = (extra = {}) => {
    const host = { settings: {}, disabled: new Set(), applyAction: jest.fn().mockResolvedValue({ ok: true }), saveNow: jest.fn().mockResolvedValue(true) };
    const api = { requestPlan: jest.fn().mockResolvedValue(makePlan()), requestCleanupRecommendation: jest.fn() };
    const telemetry = { snapshot: jest.fn().mockReturnValue({ fps: { average: 60 } }) };
    return { controller: new GMHubController({ api, host, telemetry, clientId: 'gm', ...extra }), host, api, telemetry };
  };

  test('collects, previews, applies, and logs through the host', async () => {
    const { controller, host, api, telemetry } = makeController({ logFn: jest.fn() });
    await expect(controller.collectTelemetry()).resolves.toEqual({ fps: { average: 60 } });
    await expect(controller.preview({ profile: 'power' })).resolves.toHaveProperty('planId', 'plan-1');
    expect(api.requestPlan).toHaveBeenCalledWith(expect.objectContaining({ profile: 'power', clientId: 'gm' }));
    await expect(controller.apply()).resolves.toEqual(expect.objectContaining({ applied: [safeAction], rejected: [] }));
    expect(host.applyAction).toHaveBeenCalledWith(safeAction);
    expect(telemetry.snapshot).toHaveBeenCalled();
  });

  test('handles busy state, missing telemetry, missing plan, and host errors', async () => {
    const { controller, host } = makeController({ telemetry: null });
    controller.state.busy = true;
    await expect(controller.preview()).rejects.toThrow('already running');
    controller.state.busy = false;
    await expect(controller.apply()).rejects.toThrow('No GM plan');
    controller.state.lastPlan = makePlan();
    host.applyAction.mockRejectedValue('host failure');
    await expect(controller.apply()).resolves.toEqual(expect.objectContaining({ rejected: [{ action: safeAction, reason: 'host failure' }] }));
  });

  test('broadcasts non-self plans and resets state', async () => {
    const broadcastPlan = jest.fn().mockResolvedValue(true);
    const { controller, host } = makeController({ broadcastPlan });
    controller.state.lastPlan = makePlan({ scope: 'all' });
    await expect(controller.apply(undefined, { broadcast: true })).resolves.toHaveProperty('broadcast', true);
    expect(broadcastPlan).toHaveBeenCalled();
    host.settings.old = 1;
    host.disabled.add('fx');
    await controller.reset();
    expect(host.settings).toEqual({});
    expect(host.disabled.size).toBe(0);
  });

  test('rejects broadcast without transport and writes optional logs', async () => {
    const logFn = jest.fn();
    const { controller } = makeController({ logFn });
    controller.state.lastPlan = makePlan({ scope: 'selected' });
    await expect(controller.apply(undefined, { broadcast: true })).rejects.toThrow('transport');
    controller.log('hello');
    expect(logFn).toHaveBeenCalledWith('hello');
  });

  test('authorizes an apply before mutating the host when the API supports it', async () => {
    const host = { applyAction: jest.fn().mockResolvedValue(true), settings: {}, disabled: new Set() };
    const authorizeApply = jest.fn().mockResolvedValue({ accepted: true });
    const api = { requestPlan: jest.fn(), authorizeApply };
    const controller = new GMHubController({ api, host });
    const plan = makePlan();
    await expect(controller.apply(plan)).resolves.toEqual(expect.objectContaining({ applied: [safeAction] }));
    expect(authorizeApply).toHaveBeenCalledWith({ planId: 'plan-1', scope: 'self', actionCount: 1 });
    expect(host.applyAction).toHaveBeenCalledWith(safeAction);
  });
});

describe('PerformanceTelemetry', () => {
  test('collects frame, memory, network, runtime, and long-task values', () => {
    const frames = [];
    const windowRef = {
      navigator: { userAgent: 'Android Mobile', hardwareConcurrency: 4, deviceMemory: 2, connection: { effectiveType: '3g', saveData: true } },
      performance: { memory: { usedJSHeapSize: 1048576, jsHeapSizeLimit: 4194304 } },
      canvas: { app: { ticker: { maxFPS: 60 } } },
      requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
      cancelAnimationFrame: jest.fn(),
      PerformanceObserver: class { constructor(callback) { this.callback = callback; } observe() {} disconnect() {} }
    };
    const telemetry = new PerformanceTelemetry({ windowRef });
    expect(telemetry.start()).toBe(telemetry);
    frames[0](0); frames[1](16);
    telemetry.observer.callback({ getEntries: () => [1, 2] });
    const snapshot = telemetry.snapshot();
    expect(snapshot.fps.average).toBe(62.5);
    expect(snapshot.fps.low1Percent).toBe(62.5);
    expect(snapshot.memory).toEqual({ usedMB: 1, limitMB: 4 });
    expect(snapshot.network.saveData).toBe(true);
    expect(snapshot.workload.longTasks).toBe(2);
    expect(snapshot.runtime.mobile).toBe(true);
    telemetry.stop();
    expect(windowRef.cancelAnimationFrame).toHaveBeenCalled();
    telemetry.resetWindow();
    expect(telemetry.snapshot().fps.average).toBeNull();
  });

  test('degrades without browser APIs and is idempotent', () => {
    const telemetry = new PerformanceTelemetry({ windowRef: {} });
    expect(telemetry.start()).toBe(telemetry);
    expect(telemetry.start()).toBe(telemetry);
    const snapshot = telemetry.snapshot();
    expect(snapshot.fps.frameTimeMs).toBeNull();
    expect(snapshot.memory.usedMB).toBeNull();
    expect(snapshot.runtime.mobile).toBe(false);
    telemetry.stop();
    expect(telemetry.rafId).toBeNull();
  });

  test('handles observer and frame sampling failures', () => {
    const windowRef = {
      PerformanceObserver: class { observe() { throw new Error('observer'); } disconnect() {} },
      requestAnimationFrame: () => { throw new Error('raf'); },
      navigator: {}
    };
    const telemetry = new PerformanceTelemetry({ windowRef });
    expect(() => telemetry.start()).not.toThrow();
    expect(telemetry.observer).toBeNull();
    expect(telemetry.snapshot().fps.average).toBeNull();
    telemetry.stop();
  });
});

describe('FoundryActionHost', () => {
  beforeEach(() => {
    const values = new Map();
    game.settings.get = jest.fn(async (namespace, key) => values.get(`${namespace}.${key}`));
    game.settings.register = jest.fn();
    game.settings.set = jest.fn(async (namespace, key, value) => values.set(`${namespace}.${key}`, value));
  });

  test('applies every supported data action and persists it', async () => {
    const host = new FoundryActionHost();
    const actions = [
      { type: 'set-quality', key: 'render.resolution', value: 1 },
      { type: 'set-cache-size', key: 'cache.size', value: 256 },
      { type: 'set-batch-size', key: 'batch.size', value: 8 },
      { type: 'set-fps-cap', key: 'fps.cap', value: 60 },
      { type: 'set-effect-budget', key: 'effects.budget', value: 50 },
      { type: 'set-animation-budget', key: 'animation.budget', value: 50 },
      { type: 'set-network-batch', key: 'network.batch', value: 8 },
      { type: 'set-runtime-variant', key: 'lite' },
      { type: 'disable-component', key: 'fx' },
      { type: 'enable-component', key: 'fx' }
    ];
    for (const item of actions) await host.applyAction(item);
    expect(host.settings['render.resolution']).toBe(1);
    expect(host.settings['cache.size']).toBe(256);
    expect(host.settings['batch.size']).toBe(8);
    expect(host.settings['fps.cap']).toBe(60);
    expect(host.runtime).toEqual({ effectsBudget: 50, animationBudget: 50, networkBatch: 8 });
    expect(host.disabled.size).toBe(0);
    expect(game.settings.set).toHaveBeenCalled();
  });

  test('restores state, saves, and rejects unknown actions', async () => {
    const first = new FoundryActionHost();
    await first.applyAction({ type: 'set-cache-size', key: 'cache.size', value: 256 });
    const second = new FoundryActionHost();
    await second.ready;
    expect(second.settings['cache.size']).toBe(256);
    await expect(second.applyAction({ type: 'run-shell' })).rejects.toThrow('Unsupported action type');
    expect(await second.saveNow()).toBe(true);
  });

  test('survives missing settings APIs and persistence failure', async () => {
    const saved = game.settings;
    game.settings = undefined;
    const host = new FoundryActionHost();
    await expect(host.applyAction({ type: 'set-fps-cap', key: 'fps.cap', value: 30 })).resolves.toEqual({ ok: true });
    expect(await host.saveNow()).toBe(false);
    game.settings = saved;
  });
});

describe('GM Hub edge cases', () => {
  test('covers API defaults, URL normalization, and transport failures', async () => {
    const originalFetch = global.fetch;
    delete global.fetch;
    expect(() => new GMHubApi({ fetchFn: null })).toThrow('requires fetch');
    global.fetch = originalFetch;

    const calls = [];
    const api = new GMHubApi({ baseUrl: '', fetchFn: async (url, options) => {
      calls.push({ url, options });
      return fakeResponse({ gateway: 'online' });
    }, token: '   ' });
    expect(new GMHubApi()).toBeInstanceOf(GMHubApi);
    await api._request('status');
    await expect(api.requestCleanupRecommendation({ categories: 'not-an-array' })).resolves.toEqual({ gateway: 'online' });
    expect(calls[0].url).toBe('/optimizer/v1/status');
    expect(calls[0].options.headers['x-optimizer-token']).toBeUndefined();

    const failed = new GMHubApi({ fetchFn: async () => fakeResponse({}, false, 418) });
    await expect(failed.getStatus()).rejects.toThrow('HTTP 418');

    const future = new Date(Date.now() + 60000).toISOString();
    expect(validateGMPlan(makePlan({ expiresAt: future, targetClientIds: undefined, recommendations: undefined }))).toEqual(expect.objectContaining({ expiresAt: future, targetClientIds: [], recommendations: [] }));
    expect(() => validateGMPlan([])).toThrow('object');
  });

  test('covers request timeout and optional argument defaults', async () => {
    jest.useFakeTimers();
    try {
      let aborted = false;
      const api = new GMHubApi({ timeoutMs: 1000, fetchFn: async (_url, { signal }) => new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => {
          aborted = true;
          reject(new Error('aborted'));
        });
      }) });
      const pending = api.getStatus();
      jest.advanceTimersByTime(1000);
      await expect(pending).rejects.toThrow('aborted');
      expect(aborted).toBe(true);
      const cleanupPending = api.requestCleanupRecommendation();
      jest.advanceTimersByTime(1000);
      await expect(cleanupPending).rejects.toThrow('aborted');
    } finally {
      jest.useRealTimers();
    }
  });

  test('covers controller defaults, constructor guards, and self apply path', async () => {
    expect(() => new GMHubController()).toThrow('GMHubApi');
    expect(() => new GMHubController({ api: { requestPlan: jest.fn() } })).toThrow('host');
    const host = { applyAction: jest.fn().mockResolvedValue(true), settings: {}, disabled: {} };
    const controller = new GMHubController({ api: { requestPlan: jest.fn().mockResolvedValue(makePlan()) }, host });
    expect(controller.clientId).toMatch(/^client-/);
    expect(controller.log('ignored')).toBeUndefined();
    expect(await controller.collectTelemetry()).toEqual({});
    controller.state.lastPlan = makePlan({ scope: 'self' });
    await expect(controller.apply(undefined, { broadcast: true })).resolves.toEqual(expect.objectContaining({ applied: [safeAction] }));
    await controller.reset();
  });

  test('covers telemetry rolling window, stopped callbacks, and default clock', () => {
    const callbacks = [];
    const telemetry = new PerformanceTelemetry({ windowRef: {
      requestAnimationFrame: (callback) => { callbacks.push(callback); return callbacks.length; },
      cancelAnimationFrame: jest.fn(),
      navigator: {}
    } });
    expect(typeof new PerformanceTelemetry().now()).toBe('number');
    const originalPerformance = globalThis.performance;
    globalThis.performance = {};
    expect(typeof new PerformanceTelemetry().now()).toBe('number');
    globalThis.performance = originalPerformance;
    telemetry.start();
    callbacks[0](0);
    for (let index = 1; index <= 122; index += 1) callbacks[index - 1](index * 16);
    expect(telemetry.frames.length).toBe(120);
    telemetry.frames = [16, 32, 8];
    expect(telemetry.snapshot().fps.varianceMs).toBeGreaterThan(0);
    telemetry.stop();
    callbacks.at(-1)(2000);
    expect(telemetry.frames.length).toBe(3);
  });

  test('covers action-host restore fallbacks and absent ticker', async () => {
    const originalSettings = game.settings;
    game.settings = { get: jest.fn().mockResolvedValue({ settings: null, disabled: null }), set: jest.fn().mockResolvedValue(true) };
    const restored = new FoundryActionHost();
    await restored.ready;
    expect(restored.settings).toEqual({});
    expect(restored.disabled.size).toBe(0);
    const originalCanvas = globalThis.canvas;
    globalThis.canvas = { app: {} };
    await restored.applyAction({ type: 'set-fps-cap', key: 'fps.cap', value: 30 });
    globalThis.canvas = originalCanvas;

    game.settings = originalSettings;
  });

  test('covers action-host renderer, registration absence, and save failure', async () => {
    const originalSettings = game.settings;
    game.settings = {
      get: jest.fn().mockResolvedValue(undefined),
      set: jest.fn().mockRejectedValue(new Error('save failed'))
    };
    globalThis.canvas.app.renderer = { resolution: 1 };
    const host = new FoundryActionHost();
    await expect(host.applyAction({ type: 'set-quality', key: 'render.resolution', value: 2 })).resolves.toEqual({ ok: true });
    expect(globalThis.canvas.app.renderer.resolution).toBe(2);
    expect(await host.saveNow()).toBe(false);
    game.settings = originalSettings;
    delete globalThis.canvas.app.renderer;
  });
});

describe('optimizer gateway', () => {
  let server;
  let gateway;
  const proxy = {
    clusterStatus: () => ({ mode: 'TANDEM', unitsHealthy: 2, unitsTotal: 2 }),
    dispatchTandem: jest.fn(async (payload) => [
      { unitId: 'VQ-1', ...makePlan(), type: payload.type },
      { unitId: 'VQ-2', ...makePlan({ recommendations: ['render'] }), type: payload.type }
    ]),
    dispatch: jest.fn()
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    server = new EventEmitter();
    gateway = attachOptimizerGateway(server, proxy, {
      requireToken: 'secret',
      authenticateGM: () => ({ ok: true, gmId: 'test-gm' }),
      now: () => 1700000000000
    });
  });
  afterEach(async () => {
    gateway.close();
  });

  test('serves status, clients, telemetry, plan, and cleanup', async () => {
    const headers = { 'x-optimizer-token': 'secret' };
    const first = await httpRequest(server, '/optimizer/v1/status', { headers });
    const cookie = first.headers['set-cookie'][0].split(';')[0];
    expect(first.body.gateway).toBe('online');
    expect((await httpRequest(server, '/optimizer/v1/clients', { headers: { ...headers, cookie } })).body.clients).toEqual([]);
    expect((await httpRequest(server, '/optimizer/v1/telemetry', { method: 'POST', headers: { ...headers, cookie }, body: { protocolVersion: 1, clientId: 'spoofed', telemetry: { fps: {}, chat: 'secret' } } })).body.accepted).toBe(true);
    const client = (await httpRequest(server, '/optimizer/v1/clients', { headers: { ...headers, cookie } })).body.clients[0];
    expect(client.clientId).toMatch(/^client_[A-Za-z0-9_-]{20,}$/);
    const p = await httpRequest(server, '/optimizer/v1/plan', { method: 'POST', headers: { ...headers, cookie }, body: { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: [], clientId: 'spoofed', telemetry: {} } });
    expect(p.body.success).toBe(true);
    expect(p.body.plan.sourceUnits).toEqual(['VQ-1', 'VQ-2']);
    expect(p.body.plan.planId).toMatch(/^relay-/);
    const applyBody = { protocolVersion: 1, planId: p.body.plan.planId, scope: p.body.plan.scope, actionCount: p.body.plan.actions.length };
    expect((await httpRequest(server, '/optimizer/v1/control/apply', { method: 'POST', headers: { ...headers, cookie }, body: applyBody })).body.accepted).toBe(true);
    expect((await httpRequest(server, '/optimizer/v1/control/apply', { method: 'POST', headers: { ...headers, cookie }, body: applyBody })).status).toBe(400);
    const c = await httpRequest(server, '/optimizer/v1/cleanup/recommend', { method: 'POST', headers: { ...headers, cookie }, body: { protocolVersion: 1, clientId: 'spoofed', telemetry: {}, categories: ['chat'] } });
    expect(c.body.recommendations).toEqual(expect.arrayContaining(['render']));
    expect(gateway.audit()).toEqual([expect.objectContaining({ operation: 'apply', gmId: 'test-gm', actionCount: 1 })]);
    expect(proxy.dispatchTandem).toHaveBeenCalledTimes(3);
  });

  test('enforces auth, methods, protocol, and routes', async () => {
    const headers = { 'x-optimizer-token': 'secret' };
    expect((await httpRequest(server, '/optimizer/v1/status')).status).toBe(401);
    expect((await httpRequest(server, '/optimizer/v1/status', { method: 'POST', headers, body: {} })).status).toBe(405);
    expect((await httpRequest(server, '/optimizer/v1/status', { method: 'PUT', headers })).status).toBe(405);
    expect((await httpRequest(server, '/optimizer/v1/nope', { headers })).status).toBe(404);
    expect((await httpRequest(server, '/optimizer/v1/plan', { method: 'POST', headers, body: { protocolVersion: 2, profile: 'balanced', scope: 'self', targetClientIds: [] } })).status).toBe(400);
    expect((await httpRequest(server, '/other', { headers })).status).toBe(404);
  });

  test('fails closed when no VQ plan is valid and accepts OPTIONS', async () => {
    const headers = { 'x-optimizer-token': 'secret' };
    proxy.dispatchTandem.mockResolvedValueOnce([{ unitId: 'VQ-1', type: 'wrong' }]);
    const result = await httpRequest(server, '/optimizer/v1/plan', { method: 'POST', headers, body: { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: [], clientId: 'c', telemetry: {} } });
    expect(result.status).toBe(400);
    expect((await httpRequest(server, '/optimizer/v1/status', { method: 'OPTIONS', headers })).status).toBe(204);
  });
});
