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
 * Tandem Cluster Tests
 * Covers zero-config discovery, least-loaded dispatch, health polling
 * and failover for the dual-unit secure proxy.
 */

import { LISAProxyServer, VQUnit, probePort, UNIT_PORTS } from '../lisa-secure-proxy.js';

const silentLog = () => {};

function makeUnit(id, port, options = {}) {
  return new VQUnit(id, options.host || '127.0.0.1', port, silentLog);
}

describe('UNIT_PORTS', () => {
  test('defines two candidate unit ports for zero-config discovery', () => {
    expect(Array.isArray(UNIT_PORTS)).toBe(true);
    expect(UNIT_PORTS.length).toBe(2);
  });
});

describe('probePort', () => {
  test('returns false for a closed port', async () => {
    // Port 1 on localhost is effectively never listening.
    const result = await probePort('127.0.0.1', 1, 250);
    expect(result).toBe(false);
  });

  test('returns true when a server is listening', async () => {
    const http = require('http');
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    const result = await probePort('127.0.0.1', port, 500);
    server.close();
    expect(result).toBe(true);
  });
});

describe('VQUnit', () => {
  test('starts disconnected and unhealthy', () => {
    const unit = makeUnit('VQ-1', 3000);
    expect(unit.connected).toBe(false);
    expect(unit.healthy).toBe(false);
    expect(unit.load).toBe(0);
  });

  test('request rejects when not connected', async () => {
    const unit = makeUnit('VQ-1', 3000);
    await expect(unit.request({ type: 'x' })).rejects.toThrow('not connected');
    expect(unit.failures).toBe(1);
  });

  test('pollHealth marks unhealthy without a socket', async () => {
    const unit = makeUnit('VQ-1', 3000);
    unit.healthy = true; // stale state
    const result = await unit.pollHealth();
    expect(result).toBe(false);
    expect(unit.healthy).toBe(false);
  });

  test('stop prevents reconnect timers', () => {
    const unit = makeUnit('VQ-1', 3000);
    unit.stop();
    expect(unit.stopped).toBe(true);
  });
});

describe('LISAProxyServer', () => {
  function makeServer(options = {}) {
    const server = new LISAProxyServer(9999, options);
    server.log = silentLog;
    return server;
  }

  test('configureUnits creates two unit slots by default', () => {
    const server = makeServer();
    server.configureUnits();
    expect(server.units.length).toBe(2);
    expect(server.units[0].id).toBe('VQ-1');
    expect(server.units[1].id).toBe('VQ-2');
  });

  test('configureUnits honors unitPorts override', () => {
    const server = makeServer({ unitPorts: [4000, 4001] });
    server.configureUnits();
    expect(server.units[0].port).toBe(4000);
    expect(server.units[1].port).toBe(4001);
  });

  test('discoverUnits connects only to ports that answer', async () => {
    const http = require('http');
    const server = http.createServer();
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const openPort = server.address().port;
    const closedPort = openPort + 1;

    const proxy = makeServer({ unitPorts: [openPort, closedPort] });
    proxy.configureUnits();

    await proxy.discoverUnits();

    // The open port gets a connection attempt; the closed one stays down.
    expect(proxy.units[0].ws).not.toBeNull();
    expect(proxy.units[1].ws).toBeNull();

    proxy.stop();
    server.close();
  });

  test('pickUnit returns null with no healthy units', () => {
    const proxy = makeServer();
    proxy.configureUnits();
    expect(proxy.pickUnit()).toBeNull();
  });

  test('pickUnit returns the single healthy unit', () => {
    const proxy = makeServer();
    proxy.configureUnits();
    proxy.units[0].healthy = true;
    expect(proxy.pickUnit().id).toBe('VQ-1');
  });

  test('pickUnit prefers the least-loaded unit', () => {
    const proxy = makeServer();
    proxy.configureUnits();
    proxy.units[0].healthy = true;
    proxy.units[1].healthy = true;
    proxy.units[0].inFlight = 3;
    proxy.units[1].inFlight = 1;
    expect(proxy.pickUnit().id).toBe('VQ-2');
  });

  test('pickUnit breaks load ties with lowest latency', () => {
    const proxy = makeServer();
    proxy.configureUnits();
    proxy.units[0].healthy = true;
    proxy.units[1].healthy = true;
    proxy.units[0].lastLatencyMs = 40;
    proxy.units[1].lastLatencyMs = 10;
    expect(proxy.pickUnit().id).toBe('VQ-2');
  });

  test('dispatch fails over to the second unit when the first errors', async () => {
    const proxy = makeServer();
    proxy.configureUnits();

    proxy.units[0].healthy = true;
    proxy.units[1].healthy = true;
    proxy.units[0].request = jest.fn().mockRejectedValue(new Error('boom'));
    proxy.units[1].request = jest.fn().mockResolvedValue({ ok: true });

    const result = await proxy.dispatch({ type: 'lisa.command' });

    expect(result).toEqual({ ok: true });
    expect(proxy.units[0].request).toHaveBeenCalledTimes(1);
    expect(proxy.units[1].request).toHaveBeenCalledTimes(1);
    expect(proxy.stats.failovers).toBe(1);
    expect(proxy.stats.requestsDispatched).toBe(1);
  });

  test('dispatch throws when no units are healthy', async () => {
    const proxy = makeServer();
    proxy.configureUnits();
    await expect(proxy.dispatch({ type: 'lisa.command' })).rejects.toThrow('No healthy VQ units');
  });

  test('dispatch routes to the least-loaded unit', async () => {
    const proxy = makeServer();
    proxy.configureUnits();
    proxy.units[0].healthy = true;
    proxy.units[1].healthy = true;
    proxy.units[0].inFlight = 5;
    proxy.units[1].inFlight = 0;
    const unit1Spy = jest.spyOn(proxy.units[1], 'request').mockResolvedValue({ ok: true });
    const unit0Spy = jest.spyOn(proxy.units[0], 'request');

    await proxy.dispatch({ type: 'lisa.command' });

    expect(unit1Spy).toHaveBeenCalledTimes(1);
    expect(unit0Spy).not.toHaveBeenCalled();
  });

  test('clusterStatus reports TANDEM mode with two healthy units', () => {
    const proxy = makeServer();
    proxy.configureUnits();
    proxy.units.forEach((u) => { u.healthy = true; });
    const status = proxy.clusterStatus();
    expect(status.mode).toBe('TANDEM');
    expect(status.unitsHealthy).toBe(2);
    expect(status.unitsTotal).toBe(2);
  });

  test('clusterStatus reports DEGRADED-SINGLE with one healthy unit', () => {
    const proxy = makeServer();
    proxy.configureUnits();
    proxy.units[0].healthy = true;
    const status = proxy.clusterStatus();
    expect(status.mode).toBe('DEGRADED-SINGLE');
  });

  test('clusterStatus reports OFFLINE with no healthy units', () => {
    const proxy = makeServer();
    proxy.configureUnits();
    expect(proxy.clusterStatus().mode).toBe('OFFLINE');
  });

  test('onUnitStateChange counts failovers on down/unhealthy transitions', () => {
    const proxy = makeServer();
    proxy.configureUnits();
    proxy.onUnitStateChange(proxy.units[0], 'down');
    proxy.onUnitStateChange(proxy.units[1], 'unhealthy');
    expect(proxy.stats.failovers).toBe(2);
  });
});
