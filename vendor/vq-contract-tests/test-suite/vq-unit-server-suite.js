/**
 * RNK Vortex System Optimizer (vendored component)
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
 * Shared vq-unit-server suite - parameterized by which stack's
 * vq-unit-server.js to spawn. Both stacks implement the Optimizer unit
 * protocol; this factory spawns each stack's real server process and
 * holds it to the wire contract:
 *
 *   - requestId echo on handler responses AND error-typed responses
 *   - no requestId fabrication when the request carried none
 *   - invalid JSON -> { type:'error', error:'invalid JSON', requestId:null }
 *   - unknown commands -> structured error listing supported commands
 *   - vq.health.ping -> vq.health with role/capabilities (proxy contract)
 *   - stats counters (requestsServed, healthProbes, connections) move by
 *     exactly the traffic issued, read from the HTTP /status surface
 *
 * Tests run in open mode (no VQ_CLUSTER_TOKEN); the auth gate itself is
 * covered by vq-cluster-auth.test.js and the live E2E.
 */

import { spawn } from 'child_process';
import fs from 'fs';
import net from 'net';
import path from 'path';
import * as ws_ from 'ws';

const WebSocket = ws_.WebSocket || ws_.default;

/** Rejects so a broken handshake fails the test instead of hanging it.
 *  The safety timer is cleared when the wrapped promise settles first. */
function withTimeout(promise, ms = 5000, label = 'step') {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]);
}

/** Grab a free TCP port by binding and releasing it. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

/** Wait until the port accepts TCP connections (server booted). */
function waitUntilListening(port, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const sock = net.connect(port, '127.0.0.1');
      sock.once('connect', () => { sock.destroy(); resolve(); });
      sock.once('error', () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`unit server did not listen on ${port} within ${timeoutMs}ms`));
        else setTimeout(tryOnce, 250);
      });
    };
    tryOnce();
  });
}

/**
 * Register the full unit-server contract suite.
 * @param {string} label describe() heading, e.g. 'VQ 1 unit server'
 * @param {string} stackRootAbs absolute path of the stack root
 */
export function registerUnitServerSuite(label, stackRootAbs) {
  const serverFile = path.join(stackRootAbs, 'vq-unit-server.js');
  const present = fs.existsSync(serverFile);
  const maybe = present ? describe : describe.skip;

  maybe(label, () => {
    jest.setTimeout(60000);

    let child = null;
    let port = null;
    let ws = null;
    let pending = null;
    let seq = 0;

    const sendRaw = (raw) => new Promise((resolve, reject) => {
      const onMessage = (data) => {
        ws.off('message', onMessage);
        try { resolve(JSON.parse(data.toString())); } catch (e) { reject(e); }
      };
      ws.on('message', onMessage);
      ws.send(raw);
    });

    const send = (msg) => {
      const id = `us-${++seq}-${Date.now()}`;
      return withTimeout(sendRaw(JSON.stringify({ ...msg, requestId: id })).then((res) => {
        expect(res.requestId).toBe(id); // echo contract, checked on every send
        return res;
      }), 15000, `send ${msg.type}`);
    };

    const httpGet = (p) => withTimeout(fetch(`http://127.0.0.1:${port}${p}`).then((r) => r.json()), 5000, `GET ${p}`);

    beforeAll(async () => {
      port = await freePort();
      child = spawn('node', [serverFile], {
        cwd: stackRootAbs,
        env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', UNIT_ID: 'VQ-TEST' },
        stdio: ['ignore', 'ignore', 'ignore']
      });
      child.on('error', () => {}); // avoid unhandled error events
      await waitUntilListening(port);

      pending = new Promise((resolve, reject) => {
        ws = new WebSocket(`ws://127.0.0.1:${port}`);
        ws.on('open', resolve);
        ws.on('error', reject);
      });
      await withTimeout(pending, 10000, 'ws connect');
    });

    afterAll(async () => {
      try { ws?.close(); } catch { /* ignore */ }
      if (child) {
        child.kill('SIGTERM');
        await new Promise((r) => setTimeout(r, 300));
        child.kill('SIGKILL');
      }
    });

    test('vq.ping answers vq.pong with the echoed payload and unit id', async () => {
      const res = await send({ type: 'vq.ping', payload: { hello: 'unit' } });
      expect(res.type).toBe('vq.pong');
      expect(res.unitId).toBe('VQ-TEST'); // UNIT_ID env is honored
      expect(res.echo).toEqual({ hello: 'unit' });
    });

    test('requestId echo: every handler response carries the request id back', async () => {
      // send() itself asserts res.requestId === sent id; a second shape:
      const res = await send({ type: 'vq.ping', payload: 'x' });
      expect(res.requestId).toMatch(/^us-\d+-\d+$/);
    });

    test('error-typed responses echo requestId too (unknown command)', async () => {
      const res = await send({ type: 'vq.no.such.command' });
      expect(res.type).toBe('error');
      expect(res.error).toBe('Unknown command: vq.no.such.command');
      expect(res.requestId).toMatch(/^us-\d+-\d+$/);
    });

    test('engine errors echo requestId (vq.work.error is structured, not thrown)', async () => {
      const res = await send({ type: 'vq.work.execute', payload: {} });
      expect(res.type).toBe('vq.work.error');
      expect(res.error).toMatch(/requires payload/);
      expect(res.requestId).toMatch(/^us-\d+-\d+$/);
    });

    test('no requestId in -> no requestId out (nothing fabricated)', async () => {
      const res = await sendRaw(JSON.stringify({ type: 'vq.ping', payload: null }));
      expect(res.type).toBe('vq.pong');
      expect(res.requestId).toBeUndefined();
    });

    test('invalid JSON frame -> structured error with requestId null', async () => {
      const res = await sendRaw('this is not json');
      expect(res.type).toBe('error');
      expect(res.error).toBe('invalid JSON');
      expect(res.requestId).toBeNull();
    });

    test('unknown command lists the supported command surface', async () => {
      const res = await send({ type: 'vq.definitely.not.here' });
      expect(Array.isArray(res.supported)).toBe(true);
      // vq.health.ping is intentionally absent: it is answered before the
      // handler dispatch, so it never appears in the handlers map.
      for (const required of ['vq.ping', 'vq.info', 'vq.work.execute']) {
        expect(res.supported).toContain(required);
      }
      expect(res.supported).not.toContain('vq.health.ping');
    });

    test('vq.health.ping answers the proxy health contract', async () => {
      const res = await sendRaw(JSON.stringify({ type: 'vq.health.ping', unitId: 'VQ-TEST' }));
      expect(res.type).toBe('vq.health');
      expect(res.unitId).toBe('VQ-TEST');
      expect(typeof res.latencyMs).toBe('number');
      expect(typeof res.role).toBe('string');
      expect(res.role.length).toBeGreaterThan(0);
      expect(Array.isArray(res.capabilities)).toBe(true);
      expect(res.capabilities.length).toBeGreaterThan(0);
    });

    test('stats counters move by exactly the traffic issued', async () => {
      const before = await httpGet('/status');
      expect(before.stats).toEqual({
        requestsServed: expect.any(Number),
        healthProbes: expect.any(Number),
        connections: expect.any(Number),
        authFailures: expect.any(Number)
      });

      const KNOWN = 3;
      const HEALTH = 2;
      const UNKNOWN = 1;
      for (let i = 0; i < KNOWN; i++) await send({ type: 'vq.ping', payload: { i } });
      for (let i = 0; i < HEALTH; i++) await sendRaw(JSON.stringify({ type: 'vq.health.ping' }));
      await send({ type: 'vq.unknown.counter.probe' });

      const after = await httpGet('/status');
      expect(after.stats.requestsServed - before.stats.requestsServed).toBe(KNOWN + UNKNOWN);
      expect(after.stats.healthProbes - before.stats.healthProbes).toBe(HEALTH);
      expect(after.stats.authFailures).toBe(before.stats.authFailures); // open mode: no auth traffic
    });

    test('/status and /health report the unit identity and open-mode auth', async () => {
      const status = await httpGet('/status');
      expect(status.unitId).toBe('VQ-TEST');
      expect(typeof status.role).toBe('string');
      expect(status.auth).toBeUndefined(); // auth lives on /health
      expect(status.stats).toBeTruthy();

      const health = await httpGet('/health');
      expect(health.unitId).toBe('VQ-TEST');
      expect(health.ok).toBe(true);
      expect(health.auth).toBe('open');
      expect(typeof health.engines).toBe('number');
      expect(health.engines).toBeGreaterThan(0);
    });

    test('connection counter tracks websocket sessions', async () => {
      const before = await httpGet('/status');
      let extra;
      await withTimeout(new Promise((resolve, reject) => {
        extra = new WebSocket(`ws://127.0.0.1:${port}`);
        extra.on('open', resolve);
        extra.on('error', reject);
      }), 10000, 'second ws connect');
      expect(extra.readyState).toBe(1); // OPEN

      const during = await httpGet('/status');
      expect(during.stats.connections).toBe(before.stats.connections + 1);

      extra.close();
      await new Promise((r) => setTimeout(r, 400)); // server decrements on 'close'
      const after = await httpGet('/status');
      expect(after.stats.connections).toBe(before.stats.connections);
    });
  });
}
