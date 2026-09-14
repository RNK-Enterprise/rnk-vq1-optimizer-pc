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
 * Failure-injection tests.
 *
 * Injects faults into the tandem dispatch and gateway paths and asserts
 * the system fails closed, fails over exactly once, keeps its concurrency
 * accounting intact, and never surfaces internal error detail to clients.
 * Complements tandem-proxy.test.js (behavioral coverage) with hostile
 * cases: every dependency failing, partial failure, mid-request socket
 * loss, request timeouts, busy rejection and malformed traffic.
 */

import http from 'http';
import { describe, test, expect, jest, afterAll } from '@jest/globals';
import { LISAProxyServer, VQUnit } from '../lisa-secure-proxy.js';
import { attachOptimizerGateway } from '../optimizer-gateway.js';

const silentLog = () => {};

function makeServer(options = {}) {
  const server = new LISAProxyServer(9999, options);
  server.log = silentLog;
  server.configureUnits();
  return server;
}

describe('proxy dispatch failure injection', () => {
  test('failover target failing too propagates the error and counts one failover', async () => {
    const proxy = makeServer();
    proxy.units[0].healthy = true;
    proxy.units[1].healthy = true;
    proxy.units[0].request = jest.fn().mockRejectedValue(new Error('primary boom'));
    proxy.units[1].request = jest.fn().mockRejectedValue(new Error('fallback boom'));

    await expect(proxy.dispatch({ type: 'lisa.command' })).rejects.toThrow('fallback boom');
    expect(proxy.units[0].request).toHaveBeenCalledTimes(1);
    expect(proxy.units[1].request).toHaveBeenCalledTimes(1);
    expect(proxy.stats.failovers).toBe(1);
    // Concurrency accounting survives double failure.
    expect(proxy._activeDispatches).toBe(0);
  });

  test('dispatchTandem survives partial failure and returns only fulfilled responses', async () => {
    const proxy = makeServer();
    proxy.units[0].healthy = true;
    proxy.units[1].healthy = true;
    proxy.units[0].request = jest.fn().mockRejectedValue(new Error('unit down'));
    proxy.units[1].request = jest.fn().mockResolvedValue({ ok: true, unitId: 'VQ-2' });

    const responses = await proxy.dispatchTandem({ type: 'vq.optimizer.plan' });
    expect(responses).toEqual([{ ok: true, unitId: 'VQ-2' }]);
    expect(proxy.stats.requestsDispatched).toBe(2);
    expect(proxy.stats.failovers).toBe(0);
    expect(proxy._activeDispatches).toBe(0);
  });

  test('dispatchTandem fails closed when every healthy unit rejects', async () => {
    const proxy = makeServer();
    proxy.units[0].healthy = true;
    proxy.units[1].healthy = true;
    proxy.units[0].request = jest.fn().mockRejectedValue(new Error('a'));
    proxy.units[1].request = jest.fn().mockRejectedValue(new Error('b'));

    await expect(proxy.dispatchTandem({ type: 'vq.optimizer.plan' }))
      .rejects.toThrow('All healthy VQ units rejected the request');
    expect(proxy.stats.failovers).toBe(1);
    expect(proxy._activeDispatches).toBe(0);
  });

  test('busy cap rejects dispatch and tandem dispatch instead of amplifying load', async () => {
    const proxy = makeServer();
    proxy._activeDispatches = 999;
    await expect(proxy.dispatch({ type: 'lisa.command' })).rejects.toThrow('Proxy busy');
    await expect(proxy.dispatchTandem({ type: 'vq.optimizer.plan' })).rejects.toThrow('Proxy busy');
    expect(proxy.stats.requestsDispatched).toBe(0);
  });

  test('successful dispatch returns the in-flight counter to zero', async () => {
    const proxy = makeServer();
    proxy.units[0].healthy = true;
    proxy.units[0].request = jest.fn().mockResolvedValue({ ok: true });

    await proxy.dispatch({ type: 'lisa.command' });
    expect(proxy._activeDispatches).toBe(0);
  });

  test('hostile client requestId never reaches the units verbatim', async () => {
    const proxy = makeServer();
    proxy.units[0].healthy = true;
    let seen;
    proxy.units[0].request = jest.fn(async (payload) => {
      seen = payload.requestId;
      return { ok: true };
    });

    await proxy.dispatch({ type: 'lisa.command', requestId: '../etc/passwd?<>=' });
    expect(seen).not.toBe('../etc/passwd?<>=');
    expect(seen).toMatch(/^req-\d+-\d+$/);
  });
});

describe('unit-level failure injection', () => {
  function fakeUnit() {
    const unit = new VQUnit('VQ-1', '127.0.0.1', 3000, silentLog);
    const handlers = {};
    unit.ws = {
      readyState: 1, // WebSocket.OPEN
      on: (ev, fn) => { handlers[ev] = fn; },
      once: (ev, fn) => { handlers[ev] = fn; },
      off: jest.fn(),
      send: jest.fn()
    };
    return { unit, handlers };
  }

  test('socket closing mid-request rejects and marks the unit unhealthy', async () => {
    const { unit, handlers } = fakeUnit();
    const pending = unit.request({ type: 'x', requestId: 'r1' });
    handlers.close();
    await expect(pending).rejects.toThrow('closed mid-request');
    expect(unit.failures).toBe(1);
    expect(unit.healthy).toBe(false);
    expect(unit.ws.off).toHaveBeenCalled();
  });

  test('unresponsive unit times out and marks itself unhealthy', async () => {
    jest.useFakeTimers();
    try {
      const { unit } = fakeUnit();
      const pending = unit.request({ type: 'x', requestId: 'r2' });
      jest.advanceTimersByTime(6001); // POLL_TIMEOUT_MS * 4
      await expect(pending).rejects.toThrow('request timeout');
      expect(unit.failures).toBe(1);
      expect(unit.healthy).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  test('non-JSON frames from a unit never resolve a pending request', async () => {
    const { unit, handlers } = fakeUnit();
    const pending = unit.request({ type: 'x', requestId: 'r3' });
    handlers.message(Buffer.from('garbage'));
    expect(unit.failures).toBe(0);
    handlers.message(Buffer.from(JSON.stringify({ requestId: 'r3', ok: true })));
    await expect(pending).resolves.toEqual({ requestId: 'r3', ok: true });
  });
});

describe('gateway failure injection over real HTTP', () => {
  const servers = [];

  async function startGateway(proxyMock, opts = {}) {
    const server = http.createServer();
    const gateway = attachOptimizerGateway(server, proxyMock, opts);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return { server, gateway, port: server.address().port };
  }

  function post(port, path, body, headers = {}) {
    const payload = typeof body === 'string' ? body : JSON.stringify(body);
    return new Promise((resolve) => {
      const req = http.request({
        host: '127.0.0.1', port, path, method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload), ...headers }
      }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      });
      req.on('error', (e) => resolve({ status: 0, body: e.message }));
      req.end(payload);
    });
  }

  function get(port, path, headers = {}) {
    return new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', headers }, (res) => {
        let buf = '';
        res.on('data', (c) => (buf += c));
        res.on('end', () => resolve({ status: res.statusCode, body: buf }));
      });
      req.on('error', (e) => resolve({ status: 0, body: e.message }));
      req.end();
    });
  }

  const PLAN_BODY = { protocolVersion: 1, profile: 'balanced', scope: 'all', targetClientIds: [] };

  function makeProxyMock() {
    return {
      clusterStatus: () => ({ mode: 'TANDEM', unitsHealthy: 2 }),
      dispatchTandem: jest.fn(),
      dispatch: jest.fn()
    };
  }

  afterAll(async () => {
    await Promise.all(servers.map((s) => new Promise((r) => s.close(r))));
  });

  test('cluster fully down -> 400 with the fail-closed message', async () => {
    const proxy = makeProxyMock();
    proxy.dispatchTandem.mockRejectedValue(new Error('No healthy VQ units available'));
    const { port } = await startGateway(proxy);

    const res = await post(port, '/optimizer/v1/plan', PLAN_BODY);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe('No healthy VQ units available');
  });

  test('units reject the plan -> 400 with the all-rejected message', async () => {
    const proxy = makeProxyMock();
    proxy.dispatchTandem.mockRejectedValue(new Error('All healthy VQ units rejected the request'));
    const { port } = await startGateway(proxy);

    const res = await post(port, '/optimizer/v1/plan', PLAN_BODY);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toContain('All healthy VQ units rejected');
  });

  test('units answer with no valid plan -> 400, garbage never becomes a plan', async () => {
    const proxy = makeProxyMock();
    proxy.dispatchTandem.mockResolvedValue([
      { unitId: 'VQ-1', note: 'no plan field at all' },
      { unitId: 'VQ-2', plan: { protocolVersion: 999, actions: 'not-an-array' } }
    ]);
    const { port } = await startGateway(proxy);

    const res = await post(port, '/optimizer/v1/plan', PLAN_BODY);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe('VQ cluster returned no valid optimizer plan');
  });

  test('valid tandem plan -> 200 with merged, bounded actions', async () => {
    const proxy = makeProxyMock();
    proxy.dispatchTandem.mockResolvedValue([
      { unitId: 'VQ-1', plan: { protocolVersion: 1, planId: 'p1', actions: [{ type: 'set-quality', key: 'render.quality', value: 1 }] } },
      { unitId: 'VQ-2', plan: { protocolVersion: 1, planId: 'p2', actions: [{ type: 'set-quality', key: 'render.quality', value: 2 }] } }
    ]);
    const { port } = await startGateway(proxy);

    const res = await post(port, '/optimizer/v1/plan', PLAN_BODY);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.success).toBe(true);
    // Later units specialize the same action key - exactly one wins.
    expect(body.plan.actions).toEqual([{ type: 'set-quality', key: 'render.quality', value: 2 }]);
    expect(body.plan.sourceUnits).toEqual(['VQ-1', 'VQ-2']);
  });

  test('oversized body never reaches the cluster', async () => {
    const proxy = makeProxyMock();
    const { port } = await startGateway(proxy);

    const res = await post(port, '/optimizer/v1/telemetry', JSON.stringify({ protocolVersion: 1, clientId: 'c', blob: 'x'.repeat(200 * 1024) }));
    // The gateway destroys the socket mid-upload as DoS defense, so the
    // client sees either the 400 (race won) or a connection reset (0).
    expect([0, 400]).toContain(res.status);
    if (res.status === 400) {
      expect(JSON.parse(res.body).error).toBe('Request body exceeds gateway limit');
    }
    expect(proxy.dispatchTandem).not.toHaveBeenCalled();
  });

  test('malformed JSON -> 400 and no dispatch', async () => {
    const proxy = makeProxyMock();
    const { port } = await startGateway(proxy);

    const res = await post(port, '/optimizer/v1/telemetry', '{not json');
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toBe('Request body must be valid JSON');
    expect(proxy.dispatchTandem).not.toHaveBeenCalled();
  });

  test('wrong method and unknown paths fail without touching the cluster', async () => {
    const proxy = makeProxyMock();
    const { port } = await startGateway(proxy);

    expect((await post(port, '/optimizer/v1/status', PLAN_BODY)).status).toBe(405);
    expect((await post(port, '/optimizer/v1/nope', PLAN_BODY)).status).toBe(404);
    const outside = await post(port, '/elsewhere', PLAN_BODY);
    expect(outside.status).toBe(404);
  });

  test('gateway token required -> 401 without, 200 with (timing-safe path)', async () => {
    const proxy = makeProxyMock();
    const { port } = await startGateway(proxy, { requireToken: 'secret-token' });

    expect((await get(port, '/optimizer/v1/status')).status).toBe(401);
    expect((await get(port, '/optimizer/v1/status', { 'x-optimizer-token': 'secret-token' })).status).toBe(200);
  });

  test('telemetry happy path with units lacking ids yields empty unit list, not a crash', async () => {
    const proxy = makeProxyMock();
    proxy.dispatchTandem.mockResolvedValue([{ ok: true }, { ok: true }]);
    const { port } = await startGateway(proxy);

    const res = await post(port, '/optimizer/v1/telemetry', { protocolVersion: 1, clientId: 'client-1', telemetry: { fps: 60 } });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ accepted: true, units: [] });
  });
});
