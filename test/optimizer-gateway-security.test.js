import { EventEmitter } from 'events';
import { describe, expect, jest, test } from '@jest/globals';
import { attachOptimizerGateway } from '../optimizer-gateway.js';

const safeAction = { type: 'set-fps-cap', key: 'fps.cap', value: 60 };
const planResponse = (extra = {}) => ({
  unitId: 'VQ-1',
  plan: { protocolVersion: 1, profile: 'balanced', scope: 'self', actions: [safeAction], ...extra }
});

function request(server, path, { method = 'GET', body, headers = {}, error = null, throwHeaders = false, noUrl = false, ended = false, socket = null } = {}) {
  return new Promise((resolve) => {
    const req = new EventEmitter();
    const res = {
      statusCode: 200,
      headers: {},
      writableEnded: false,
      setHeader(key, value) {
        this.headers[key.toLowerCase()] = key.toLowerCase() === 'set-cookie' ? [value] : value;
      },
      end(raw = '') {
        this.writableEnded = true;
        let parsed = null;
        try { parsed = raw ? JSON.parse(raw) : null; } catch { parsed = raw; }
        resolve({ status: this.statusCode, body: parsed, headers: this.headers });
      }
    };
    Object.assign(req, {
      url: noUrl ? undefined : path,
      method,
      headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers },
      socket: socket || undefined,
      destroy: jest.fn()
    });
    if (ended) res.writableEnded = true;
    if (throwHeaders) Object.defineProperty(req, 'headers', { get: () => { throw new Error('header access failed'); } });
    server.emit('request', req, res);
    if (ended) resolve({ status: res.statusCode, body: null, headers: res.headers });
    setImmediate(() => {
      if (error) req.emit('error', error);
      else if (body !== undefined) {
        req.emit('data', typeof body === 'string' ? body : JSON.stringify(body));
        req.emit('end');
      } else if (method === 'POST') req.emit('end');
    });
  });
}

function setup(options = {}) {
  const server = new EventEmitter();
  const proxy = {
    clusterStatus: () => ({ mode: 'TANDEM', unitsHealthy: 2 }),
    dispatchTandem: jest.fn(async () => [planResponse()]),
    dispatch: jest.fn(async () => ({ unitId: 'direct' }))
  };
  const gateway = attachOptimizerGateway(server, proxy, {
    now: () => 1000,
    authenticateGM: () => ({ ok: true, gmId: 'gm-test' }),
    ...options
  });
  return { server, proxy, gateway };
}

async function getCookie(server, headers = {}, socket = null) {
  const result = await request(server, '/optimizer/v1/status', { headers, socket });
  return result.headers['set-cookie'][0].split(';')[0];
}

describe('optimizer gateway security enforcement', () => {
  test('rejects invalid construction and accepts bounded option fallbacks', () => {
    expect(() => attachOptimizerGateway(null, null)).toThrow('HTTP server');
    expect(() => attachOptimizerGateway(new EventEmitter(), {})).toThrow('tandem proxy');
    expect(() => attachOptimizerGateway(new EventEmitter(), { clusterStatus() {}, dispatch() {} }, { authenticateGM: null })).toThrow('authenticator');
    const defaults = attachOptimizerGateway(new EventEmitter(), { clusterStatus() {}, dispatch() {} });
    defaults.close();
    const { gateway } = setup({ rateLimit: null, requestTimeoutMs: 0 });
    gateway.close();
  });

  test('uses secure fail-closed defaults when options are omitted', async () => {
    const server = new EventEmitter();
    const gateway = attachOptimizerGateway(server, { clusterStatus() {}, dispatch() {} });
    expect((await request(server, '/optimizer/v1/status')).status).toBe(200);
    expect((await request(server, '/optimizer/v1/plan', {
      method: 'POST', body: { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: [] }
    })).status).toBe(403);
    gateway.close();
  });

  test('default GM authentication compares the server environment token', async () => {
    const original = process.env.FOUNDRY_GM_TOKEN;
    process.env.FOUNDRY_GM_TOKEN = 'server-gm-secret';
    const server = new EventEmitter();
    const gateway = attachOptimizerGateway(server, {
      clusterStatus() {},
      dispatch() { return planResponse(); }
    });
    const result = await request(server, '/optimizer/v1/plan', {
      method: 'POST', headers: { 'x-foundry-gm-assertion': 'server-gm-secret' },
      body: { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: [] }
    });
    expect(result.status).toBe(200);
    expect(result.body.plan.planId).toMatch(/^relay-/);
    gateway.close();
    if (original === undefined) delete process.env.FOUNDRY_GM_TOKEN;
    else process.env.FOUNDRY_GM_TOKEN = original;
  });

  test('issues opaque identities and strips content from forwarded telemetry', async () => {
    const { server, proxy, gateway } = setup();
    const headers = { cookie: 'optimizer_client_id=%ZZ' };
    const first = await request(server, '/optimizer/v1/status', { headers });
    const cookie = first.headers['set-cookie'][0].split(';')[0];
    const result = await request(server, '/optimizer/v1/telemetry', {
      method: 'POST',
      headers: { cookie },
      body: {
        protocolVersion: 1,
        clientId: 'spoofed-client',
        telemetry: { chat: 'private', document: { text: 'private' }, fps: { average: 60 }, path: '/tmp' }
      }
    });
    expect(result.status).toBe(200);
    const payload = proxy.dispatchTandem.mock.calls[0][0].payload;
    expect(payload.clientId).toMatch(/^client_[A-Za-z0-9_-]{20,}$/);
    expect(payload.clientId).not.toBe('spoofed-client');
    expect(payload.telemetry).toEqual(expect.objectContaining({ fps: { average: 60, low1Percent: null, frameTimeMs: null, varianceMs: null } }));
    expect(payload.telemetry.chat).toBeUndefined();
    expect(payload.telemetry.document).toBeUndefined();
    expect((await request(server, '/optimizer/v1/clients', { headers: { cookie } })).body.clients[0].clientId).toBe(payload.clientId);
    gateway.close();
  });

  test('rejects spoofed target ids, protocol errors, and unsafe cleanup categories', async () => {
    const { server, gateway } = setup();
    expect((await request(server, '/optimizer/v1/telemetry', { method: 'POST', body: {} })).status).toBe(400);
    expect((await request(server, '/optimizer/v1/plan', { method: 'POST', body: { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: ['spoofed'] } })).status).toBe(400);
    expect((await request(server, '/optimizer/v1/plan', { method: 'POST', body: { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: null } })).status).toBe(400);
    expect((await request(server, '/optimizer/v1/cleanup/recommend', { method: 'POST', body: { protocolVersion: 1, categories: ['/etc/passwd'] } })).status).toBe(400);
    expect((await request(server, '/optimizer/v1/cleanup/recommend', { method: 'POST', body: { protocolVersion: 1 } })).status).toBe(200);
    expect((await request(server, '/optimizer/v1/plan', { method: 'POST', body: { protocolVersion: 1, profile: 'bad', scope: 'self', targetClientIds: [] } })).status).toBe(400);
    expect((await request(server, '/optimizer/v1/plan', { method: 'POST', body: { protocolVersion: 1, profile: 'balanced', scope: 'bad', targetClientIds: [] } })).status).toBe(400);
    expect((await request(server, '/optimizer/v1/plan', { method: 'POST', body: [] })).status).toBe(400);
    gateway.close();
  });

  test('fails closed on invalid VQ actions, bounds, expiry, and oversized merges', async () => {
    const cases = [
      { actions: [{ type: 'set-quality', key: 'render.distance', value: 999 }] },
      { actions: [{ ...safeAction, path: '/tmp' }] },
      { actions: Array(25).fill(safeAction) },
      { expiresAt: new Date(999).toISOString() }
    ];
    for (const plan of cases) {
      const { server, proxy, gateway } = setup();
      proxy.dispatchTandem.mockResolvedValue([planResponse(plan)]);
      const result = await request(server, '/optimizer/v1/plan', {
        method: 'POST',
        body: { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: [] }
      });
      expect(result.status).toBe(400);
      gateway.close();
    }
    const fallback = setup();
    fallback.proxy.dispatchTandem.mockResolvedValue([planResponse({ profile: undefined, scope: undefined, actions: [] })]);
    const fallbackResult = await request(fallback.server, '/optimizer/v1/plan', {
      method: 'POST', body: { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: [] }
    });
    expect(fallbackResult.status).toBe(200);
    fallback.gateway.close();
  });

  test('requires GM authentication for every control route', async () => {
    const { server, proxy, gateway } = setup({ authenticateGM: () => false });
    const planBody = { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: [] };
    expect((await request(server, '/optimizer/v1/plan', { method: 'POST', body: planBody })).status).toBe(403);
    expect((await request(server, '/optimizer/v1/cleanup/recommend', { method: 'POST', body: { protocolVersion: 1 } })).status).toBe(403);
    expect((await request(server, '/optimizer/v1/control/apply', { method: 'POST', body: { protocolVersion: 1, planId: 'p', scope: 'self', actionCount: 0 } })).status).toBe(403);
    expect((await request(server, '/optimizer/v1/control/apply', { headers: {}, body: undefined })).status).toBe(405);
    expect((await request(server, '/optimizer/v1/telemetry', { method: 'GET' })).status).toBe(405);
    expect(proxy.dispatchTandem).not.toHaveBeenCalled();
    gateway.close();
  });

  test('fails safely when the GM authenticator throws', async () => {
    const { server, gateway } = setup({ authenticateGM: () => { throw new Error('auth backend unavailable'); } });
    const result = await request(server, '/optimizer/v1/plan', { method: 'POST', body: { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: [] } });
    expect(result.status).toBe(403);
    gateway.close();
  });

  test('accepts a true GM result, validates assertions, and falls back for unsafe GM ids', async () => {
    const seen = [];
    const { server, gateway } = setup({ authenticateGM: (_req, context) => {
      seen.push(context);
      return true;
    } });
    const result = await request(server, '/optimizer/v1/cleanup/recommend', {
      method: 'POST', headers: { 'x-foundry-gm-assertion': 'session-proof' }, body: { protocolVersion: 1 }
    });
    expect(result.status).toBe(200);
    expect(seen[0]).toEqual(expect.objectContaining({ operation: 'cleanup.recommend', assertion: 'session-proof' }));
    gateway.close();

    const unsafe = setup({ authenticateGM: () => ({ ok: true, gmId: '/unsafe' }) });
    const unsafeResult = await request(unsafe.server, '/optimizer/v1/cleanup/recommend', { method: 'POST', body: { protocolVersion: 1 } });
    expect(unsafeResult.status).toBe(200);
    unsafe.gateway.close();
  });

  test('validates apply fields and binds replay to scope and action count', async () => {
    const { server, proxy, gateway } = setup();
    const cookie = await getCookie(server);
    const planResult = await request(server, '/optimizer/v1/plan', {
      method: 'POST', headers: { cookie }, body: { protocolVersion: 1, profile: 'balanced', scope: 'self', targetClientIds: [] }
    });
    const plan = planResult.body.plan;
    for (const body of [
      {},
      { protocolVersion: 1, planId: '../escape', scope: 'self', actionCount: 1 },
      { protocolVersion: 1, planId: plan.planId, scope: 'bad', actionCount: 1 },
      { protocolVersion: 1, planId: plan.planId, scope: 'self', actionCount: 25 },
      { protocolVersion: 1, planId: plan.planId, scope: 'all', actionCount: 1 },
      { protocolVersion: 1, planId: plan.planId, scope: 'self', actionCount: 0 }
    ]) {
      const result = await request(server, '/optimizer/v1/control/apply', { method: 'POST', headers: { cookie }, body });
      expect(result.status).toBe(400);
    }
    const valid = await request(server, '/optimizer/v1/control/apply', {
      method: 'POST', headers: { cookie }, body: { protocolVersion: 1, planId: plan.planId, scope: 'self', actionCount: 1 }
    });
    expect(valid.status).toBe(200);
    expect(gateway.audit()[0]).toEqual(expect.objectContaining({ gmId: 'gm-test', actionCount: 1 }));
    expect(proxy.dispatchTandem).toHaveBeenCalledTimes(1);
    gateway.close();
  });

  test('enforces request rate limits and VQ timeouts', async () => {
    const limited = setup({ rateLimit: { windowMs: 1000, maxRequests: 1 } });
    const socket = { remoteAddress: '127.0.0.1' };
    const headers = { cookie: await getCookie(limited.server, {}, socket) };
    const blocked = await request(limited.server, '/optimizer/v1/status', { headers, socket });
    expect(blocked.status).toBe(429);
    expect(blocked.headers['retry-after']).toBe('1');
    expect((await request(limited.server, '/optimizer/v1/status', { socket })).status).toBe(429);
    limited.gateway.close();

    const timeout = setup({ requestTimeoutMs: 1 });
    timeout.proxy.dispatchTandem.mockReturnValue(new Promise(() => {}));
    const result = await request(timeout.server, '/optimizer/v1/telemetry', { method: 'POST', body: { protocolVersion: 1 } });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('VQ request timeout');
    timeout.gateway.close();
  });

  test('supports a single dispatch proxy and protects malformed request bodies', async () => {
    const { server, proxy, gateway } = setup();
    delete proxy.dispatchTandem;
    expect((await request(server, '/optimizer/v1/telemetry', { method: 'POST', body: { protocolVersion: 1 } })).body.units).toEqual(['direct']);
    expect((await request(server, '/optimizer/v1/telemetry', { method: 'POST' })).status).toBe(400);
    expect((await request(server, '/optimizer/v1/telemetry', { method: 'POST', body: '{bad' })).status).toBe(400);
    expect((await request(server, '/optimizer/v1/telemetry', { method: 'POST', body: 'x'.repeat(129 * 1024) })).status).toBe(400);
    expect((await request(server, '/optimizer/v1/telemetry', { method: 'POST', error: new Error('body read failed') })).status).toBe(400);
    gateway.close();
  });

  test('converts an unexpected request-handler rejection into a 500 response', async () => {
    const { server, gateway } = setup({ requireToken: 'secret' });
    const result = await request(server, '/optimizer/v1/status', { headers: { 'x-optimizer-token': 'secret' }, throwHeaders: true });
    expect(result.status).toBe(500);
    await request(server, '/optimizer/v1/status', {
      headers: { 'x-optimizer-token': 'secret' }, throwHeaders: true, ended: true
    });
    await new Promise((resolve) => setImmediate(resolve));
    const endedRequest = new EventEmitter();
    Object.assign(endedRequest, { url: '/optimizer/v1/status', method: 'GET' });
    Object.defineProperty(endedRequest, 'headers', { get: () => { throw new Error('header access failed'); } });
    const endedResponse = { writableEnded: true, setHeader: jest.fn(), end: jest.fn() };
    server.emit('request', endedRequest, endedResponse);
    await new Promise((resolve) => setImmediate(resolve));
    expect(endedResponse.end).not.toHaveBeenCalled();
    const nullRequest = new EventEmitter();
    Object.assign(nullRequest, { url: '/optimizer/v1/status', method: 'GET' });
    Object.defineProperty(nullRequest, 'headers', { get: () => { throw null; } });
    const nullResponse = { writableEnded: false, setHeader: jest.fn(), end: jest.fn() };
    server.emit('request', nullRequest, nullResponse);
    await new Promise((resolve) => setImmediate(resolve));
    expect(nullResponse.end).toHaveBeenCalledWith(expect.stringContaining('null'));
    gateway.close();
  });

  test('handles missing URLs and non-Error dispatch failures', async () => {
    const noUrl = setup();
    const missing = await request(noUrl.server, '/ignored', { noUrl: true });
    expect(missing.status).toBe(404);
    noUrl.gateway.close();

    const rejected = setup();
    rejected.proxy.dispatchTandem.mockRejectedValue(null);
    const result = await request(rejected.server, '/optimizer/v1/telemetry', { method: 'POST', body: { protocolVersion: 1 } });
    expect(result.status).toBe(400);
    expect(result.body.error).toBe('null');
    rejected.gateway.close();
  });

  test('bounds the remembered client map', async () => {
    const { server, gateway } = setup({ rateLimit: { windowMs: 1000, maxRequests: 1000 } });
    for (let index = 0; index < 257; index += 1) {
      const cookie = `optimizer_client_id=client_${String(index).padStart(2, '0')}${'a'.repeat(20)}`;
      await request(server, '/optimizer/v1/telemetry', { method: 'POST', headers: { cookie }, body: { protocolVersion: 1 } });
    }
    expect(gateway.clients.size).toBe(256);
    gateway.close();
  });
});
