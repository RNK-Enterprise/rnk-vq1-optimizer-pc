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
 * Secure LISA Proxy Server for Foundry VTT
 *
 * SECURITY ARCHITECTURE:
 * - Runs on Foundry server (curator's machine only)
 * - Handles all VQ/LISA connections internally
 * - No IP addresses exposed to clients
 * - Clients connect to local proxy endpoint only
 *
 * TANDEM CLUSTER:
 * - Manages TWO upstream VQ units (VQ-1 and VQ-2)
 * - ZERO-CONFIG: auto-discovers both units on the local host
 * - Dispatches client requests to the least-loaded healthy unit
 * - Polls unit health over the wire and fails over automatically
 * - Degraded mode: runs with a single unit or none (requests error)
 */

import * as ws_ from 'ws';
const WebSocket = ws_.WebSocket || ws_.default;
const WebSocketServer = ws_.WebSocketServer || ws_.Server || ws_.default;
import http from 'http';
import net from 'net';
import { createHash, timingSafeEqual } from 'crypto';
import { pathToFileURL } from 'url';
import { classifyWork, pickUnitForWork, WORK_CLASSES } from './vq-work-routing.js';
import { attachOptimizerGateway } from './optimizer-gateway.js';

// Units the cluster expects to find. Discovery is automatic; these
// define the candidate ports only. Hosts are probed on the local
// machine so no configuration is ever required.
const UNIT_PORTS = [3000, 3001];

const POLL_INTERVAL_MS = 5000;
const POLL_TIMEOUT_MS = 1500;
const RECONNECT_DELAY_MS = 5000;
const DISCOVERY_INTERVAL_MS = 15000;

// Per-frame cap for client WebSocket traffic. Matches the gateway's HTTP
// body limit so neither transport can be used to smuggle oversized
// payloads into the cluster.
const MAX_CLIENT_FRAME_BYTES = 128 * 1024;

// Upper bound on cluster requests in flight at once. Beyond this the
// proxy fails closed instead of amplifying load into the units.
const MAX_ACTIVE_DISPATCHES = 64;

/**
 * Server-side requestId sanitizer. Client-supplied ids are echoed by
 * units to correlate responses, so an attacker-chosen id must never
 * reach the cluster verbatim: enforce type, length and charset, and
 * mint a server id otherwise.
 */
function safeRequestId(value) {
  if (typeof value === 'string' && value.length > 0 && value.length <= 128
    && /^[A-Za-z0-9._:-]+$/.test(value)) {
    return value;
  }
  return `req-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
}

/**
 * Timing-safe secret comparison. Both sides are hashed first so length
 * differences do not leak and the call is constant-time.
 */
function tokensMatch(supplied, expected) {
  if (typeof supplied !== 'string' || typeof expected !== 'string' || !supplied || !expected) return false;
  const a = createHash('sha256').update(supplied).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * Probe a TCP port for liveness (fast discovery primitive).
 * @param {string} host
 * @param {number} port
 * @param {number} timeoutMs
 * @returns {Promise<boolean>} true when something is listening
 */
function probePort(host, port, timeoutMs = 1000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * One upstream VQ unit connection: its socket, identity, health state
 * and rolling load statistics.
 */
class VQUnit {
  /**
   * @param {string} id stable unit id, e.g. 'VQ-1'
   * @param {string} host upstream host
   * @param {number} port upstream port
   * @param {object} logger
   */
  constructor(id, host, port, logger, authToken = null) {
    this.id = id;
    this.host = host;
    this.port = port;
    this.log = logger;
    this.authToken = authToken;
    this.ws = null;
    this.connected = false;
    this.healthy = false;
    this.inFlight = 0;
    this.totalRequests = 0;
    this.failures = 0;
    this.lastLatencyMs = null;
    this.lastSeen = null;
    this.reconnectTimer = null;
    this.stopped = false;
    this.onStateChange = null;
  }

  get label() {
    return `${this.id} (${this.host}:${this.port})`;
  }

  get load() {
    return this.inFlight;
  }

  connect() {
    if (this.stopped) return;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.log(`[Tandem] Connecting to unit ${this.label}...`);
    // Shared-token auth: units configured with VQ_CLUSTER_TOKEN reject
    // upgrades that do not carry the token (header preferred, query fallback).
    const connectOptions = {};
    if (this.authToken) {
      connectOptions.headers = { 'x-vq-token': this.authToken };
    }
    const ws = new WebSocket(`ws://${this.host}:${this.port}`, connectOptions);
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.log(`[Tandem] Unit ${this.label} ONLINE`);
      this.emitState('up');
      this.sendPoll();
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg && msg.type === 'vq.health') {
          this.lastLatencyMs = typeof msg.latencyMs === 'number' ? msg.latencyMs : (Date.now() - (this.lastPollSentAt || Date.now()));
          this.lastSeen = Date.now();
          // Capability advertisement (units may update this at runtime).
          if (typeof msg.role === 'string') this.role = msg.role;
          if (Array.isArray(msg.capabilities)) this.capabilities = msg.capabilities.filter((c) => typeof c === 'string');
          if (!this.healthy) {
            this.healthy = true;
            this.log(`[Tandem] Unit ${this.label} HEALTHY (latency ${this.lastLatencyMs}ms)`);
            this.emitState('healthy');
          }
          this.lastHealth = msg;
        }
      } catch (_e) {
        // Malformed frame from upstream - ignore.
      }
    });

    ws.on('error', (error) => {
      this.log(`[Tandem] Unit ${this.label} connection error: ${error.message}`);
    });

    ws.on('close', () => {
      const wasHealthy = this.connected;
      this.connected = false;
      this.healthy = false;
      this.ws = null;
      if (wasHealthy) {
        this.log(`[Tandem] Unit ${this.label} went DOWN - failing over`);
        this.emitState('down');
      }
      if (!this.stopped) {
        this.reconnectTimer = setTimeout(() => this.connect(), RECONNECT_DELAY_MS);
      }
    });
  }

  emitState(state) {
    if (typeof this.onStateChange === 'function') {
      try {
        this.onStateChange(this, state);
      } catch (_e) {
        // Listener errors must never break the proxy loop.
      }
    }
  }

  sendPoll() {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.lastPollSentAt = Date.now();
      this.ws.send(JSON.stringify({ type: 'vq.health.ping', unitId: this.id, timestamp: Date.now() }));
    }
  }

  /** Wire-level health poll. A unit is healthy only if it answers. */
  async pollHealth() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.healthy = false;
      return false;
    }
    this.sendPoll();
    // Health flips back to false if the unit misses two consecutive polls.
    const missed = this.lastSeen && (Date.now() - this.lastSeen > POLL_INTERVAL_MS * 2 + POLL_TIMEOUT_MS);
    if (missed && this.healthy) {
      this.healthy = false;
      this.log(`[Tandem] Unit ${this.label} missed health polls - marked UNHEALTHY`);
      this.emitState('unhealthy');
    }
    return this.healthy;
  }

  /**
   * Send a client request to this unit, tracking load and latency.
   * @param {object} payload JSON-serializable request
   * @returns {Promise<object>} the unit's JSON response
   */
  async request(payload) {
    const t0 = Date.now();
    this.inFlight++;
    this.totalRequests++;
    try {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
        throw new Error(`Unit ${this.id} not connected`);
      }
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error(`Unit ${this.id} request timeout`)), POLL_TIMEOUT_MS * 4);
        const onMessage = (data) => {
          let msg;
          try {
            msg = JSON.parse(data.toString());
          } catch (_e) {
            return; // Not JSON - not ours.
          }
          if (msg && msg.requestId === payload.requestId) {
            clearTimeout(timeout);
            ws_off();
            resolve(msg);
          }
        };
        const onClose = () => {
          clearTimeout(timeout);
          ws_off();
          reject(new Error(`Unit ${this.id} closed mid-request`));
        };
        const ws_off = () => {
          this.ws?.off('message', onMessage);
          this.ws?.off('close', onClose);
        };
        this.ws.on('message', onMessage);
        this.ws.once('close', onClose);
        this.ws.send(JSON.stringify({ ...payload, unitId: this.id }));
      });
      this.lastLatencyMs = Date.now() - t0;
      this.lastSeen = Date.now();
      if (!this.healthy) {
        this.healthy = true;
        this.emitState('healthy');
      }
      return response;
    } catch (error) {
      this.failures++;
      this.healthy = false;
      this.emitState('unhealthy');
      throw error;
    } finally {
      this.inFlight--;
    }
  }

  stop() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.ws) this.ws.close();
  }
}

class LISAProxyServer {
  /**
   * @param {number} port local listening port
   * @param {object} options overrides for tests: unitHosts, unitPorts, discovery
   */
  constructor(port = 9999, options = {}) {
    this.port = port;
    this.options = options;
    this.clients = new Set();
    this.units = [];
    this.stats = {
      clientsConnected: 0,
      messagesProxied: 0,
      requestsDispatched: 0,
      failovers: 0,
      discoveryScans: 0,
      lisaConnected: false,
      dispatchByClass: { render: { dispatched: 0, matched: 0 }, compute: { dispatched: 0, matched: 0 }, general: { dispatched: 0, matched: 0 } }
    };
    this._lastRouting = null;
    this.pollTimer = null;
    this.discoveryTimer = null;
    this._activeDispatches = 0;
    this.log = (msg) => console.log(msg);
  }

  /** Attach a unit slot for each candidate host:port. */
  configureUnits() {
    const hosts = this.options.unitHosts || [process.env.VQ_UNIT_HOST || '127.0.0.1'];
    // Port candidates: constructor option > VQ_UNIT_PORTS env (comma-separated)
    // > built-in default [3000, 3001].
    const envPorts = process.env.VQ_UNIT_PORTS
      ? process.env.VQ_UNIT_PORTS.split(',').map((p) => Number(p.trim())).filter((p) => Number.isFinite(p) && p > 0)
      : null;
    const ports = this.options.unitPorts || envPorts || UNIT_PORTS;
    const authToken = this.options.unitAuthToken !== undefined
      ? this.options.unitAuthToken
      : (process.env.VQ_CLUSTER_TOKEN || null);
    this.units = ports.map((port, idx) => {
      const host = hosts[idx % hosts.length];
      return new VQUnit(`VQ-${idx + 1}`, host, port, this.log, authToken);
    });
    this.units.forEach((unit) => {
      unit.onStateChange = (changedUnit, state) => {
        this.onUnitStateChange(changedUnit, state);
      };
    });
  }

  onUnitStateChange(unit, state) {
    const onlineCount = this.units.filter((u) => u.healthy).length;
    this.log(`[Tandem] Cluster state: ${onlineCount}/${this.units.length} units healthy`);
    if (state === 'down' || state === 'unhealthy') {
      this.stats.failovers++;
    }
  }

  /**
   * ZERO-CONFIG DISCOVERY: probe candidate ports and connect to whatever
   * answers. Runs at startup and periodically so units started later are
   * still picked up.
   */
  async discoverUnits() {
    this.stats.discoveryScans++;
    for (const unit of this.units) {
      if (unit.connected) continue;
      const listening = await probePort(unit.host, unit.port);
      if (listening) {
        unit.connect();
      } else if (unit.ws) {
        // Nothing is listening anymore - drop stale state so the next
        // scan can pick the unit back up cleanly.
        unit.healthy = false;
      }
    }
  }

  getHealthyUnits() {
    return this.units.filter((u) => u.healthy);
  }

  /**
   * Pick the unit to route a request to.
   * - One healthy unit: use it.
   * - Multiple healthy units: least in-flight requests, then lowest latency.
   * - None: null (caller decides).
   * @returns {VQUnit|null}
   */
  /**
   * Pick the unit to route a request to.
   * @param {object} [payload] optional request payload - when given, units
   *   whose advertised role/capabilities match the work class are preferred
   *   (render-heavy work -> render unit, compute-heavy -> compute unit),
   *   degrading to plain least-loaded when no specialist qualifies.
   * @returns {VQUnit|null}
   */
  pickUnit(payload = null) {
    const healthy = this.getHealthyUnits();
    if (healthy.length === 0) return null;
    if (!payload) {
      if (healthy.length === 1) return healthy[0];
      return healthy.slice().sort((a, b) => {
        if (b.load !== a.load) return a.load - b.load;
        const la = a.lastLatencyMs ?? Number.MAX_SAFE_INTEGER;
        const lb = b.lastLatencyMs ?? Number.MAX_SAFE_INTEGER;
        return la - lb;
      })[0];
    }
    // Capability-aware path: always record the decision so `routing.last`
    // never goes stale, even in the single-survivor degraded case.
    const { workClass } = classifyWork(payload);
    const { unit, matched } = pickUnitForWork(healthy, workClass);
    this._lastRouting = { unitId: unit ? unit.id : null, workClass, matched };
    return unit;
  }

  /**
   * Send a read/plan request to every healthy unit so tandem responses can be
   * combined by the API gateway. Failed specialists are omitted when at least
   * one unit answers; a fully unavailable cluster still fails closed.
   */
  async dispatchTandem(payload) {
    if (this._activeDispatches >= MAX_ACTIVE_DISPATCHES) {
      throw new Error('Proxy busy: too many in-flight cluster requests');
    }
    const healthy = this.getHealthyUnits();
    if (!healthy.length) throw new Error('No healthy VQ units available');
    const tagged = { ...payload, requestId: safeRequestId(payload.requestId) };
    this.stats.requestsDispatched += healthy.length;
    this._activeDispatches++;
    try {
      const results = await Promise.allSettled(healthy.map(async (unit) => {
        this._recordDispatch(classifyWork(payload).workClass, unit.id);
        return unit.request(tagged);
      }));
      const fulfilled = results.filter((result) => result.status === 'fulfilled').map((result) => result.value);
      if (!fulfilled.length) {
        this.stats.failovers++;
        throw new Error('All healthy VQ units rejected the request');
      }
      return fulfilled;
    } finally {
      this._activeDispatches--;
    }
  }

  /**
   * Dispatch a client request to the best unit, with one failover retry
   * on the next-best unit when the chosen one errors.
   * @param {object} payload
   * @returns {Promise<object>}
   */
  async dispatch(payload) {
    if (this._activeDispatches >= MAX_ACTIVE_DISPATCHES) {
      throw new Error('Proxy busy: too many in-flight cluster requests');
    }
    const { workClass, reason } = classifyWork(payload);
    const unit = this.pickUnit(payload);
    if (!unit) {
      throw new Error('No healthy VQ units available');
    }
    this._recordDispatch(workClass, unit.id);
    const tagged = { ...payload, requestId: safeRequestId(payload.requestId) };
    this.stats.requestsDispatched++;
    this._activeDispatches++;
    try {
      return await unit.request(tagged);
    } catch (error) {
      this.log(`[Tandem] Dispatch to ${unit.id} failed (${error.message}) - failing over`);
      this.stats.failovers++;
      // Capability-aware failover: prefer a healthy supporter of the same
      // work class; degrade to any other healthy unit.
      const fallback = this.getHealthyUnits().find((u) =>
        u.id !== unit.id && pickUnitForWork([u], workClass).matched);
      const target = fallback
        || this.getHealthyUnits().find((u) => u.id !== unit.id);
      if (!target) throw error;
      this.log(`[Tandem] Failover: ${unit.id} -> ${target.id}`);
      return await target.request(tagged);
    } finally {
      this._activeDispatches--;
    }
  }

  _recordDispatch(workClass, unitId) {
    if (!this.stats.dispatchByClass) {
      this.stats.dispatchByClass = { render: { dispatched: 0, matched: 0 }, compute: { dispatched: 0, matched: 0 }, general: { dispatched: 0, matched: 0 } };
    }
    const entry = this.stats.dispatchByClass[workClass] || this.stats.dispatchByClass.general;
    entry.dispatched++;
    const supporters = this.getHealthyUnits().filter((u) => pickUnitForWork([u], workClass).matched);
    if (supporters.some((u) => u.id === unitId)) entry.matched++;
  }

  handleClient(ws, req) {
    // Optional shared-token auth for WebSocket clients. When configured
    // (LISA_PROXY_CLIENT_TOKEN), upgrades without the token are rejected
    // before any cluster information is sent.
    const clientToken = this.options.clientToken !== undefined
      ? this.options.clientToken
      : (process.env.LISA_PROXY_CLIENT_TOKEN || null);
    if (clientToken) {
      const supplied = req.headers['x-lisa-token']
        || new URL(req.url || '/', 'http://localhost').searchParams.get('token');
      if (!tokensMatch(supplied, clientToken)) {
        this.log(`[LISA Proxy] Rejected unauthenticated client from ${req.socket.remoteAddress}`);
        ws.close(1008, 'unauthorized');
        return;
      }
    }

    const clientIp = req.socket.remoteAddress;
    this.log(`[LISA Proxy] Client connected from ${clientIp}`);
    this.clients.add(ws);
    this.stats.clientsConnected++;

    // Topology hygiene: the hello deliberately omits unit host:port.
    // Clients learn unit ids and health only; endpoints stay server-side.
    ws.send(JSON.stringify({
      type: 'lisa.proxy.connected',
      lisaAvailable: this.getHealthyUnits().length > 0,
      units: this.units.map((u) => ({ id: u.id, healthy: u.healthy })),
      cluster: this.clusterStatus()
    }));

    ws.on('message', async (data) => {
      // Frame size gate: reject oversized frames before parsing.
      if (Buffer.byteLength(data) > MAX_CLIENT_FRAME_BYTES) {
        this.log(`[LISA Proxy] Oversized frame (${Buffer.byteLength(data)} bytes) from ${clientIp} - closing`);
        try { ws.close(1009, 'frame too large'); } catch (_e) { /* already closed */ }
        this.clients.delete(ws);
        return;
      }
      let message;
      try {
        message = JSON.parse(data.toString());
      } catch (e) {
        this.log(`[LISA Proxy] Parse error: ${e.message}`);
        return;
      }

      this.stats.messagesProxied++;

      // Health/status queries are answered locally from cluster state.
      // requestId is echoed back so clients can correlate responses.
      if (message.type === 'lisa.status') {
        ws.send(JSON.stringify({ type: 'lisa.status', cluster: this.clusterStatus(), requestId: safeRequestId(message.requestId) }));
        return;
      }
      if (message.type === 'lisa.cluster.status') {
        ws.send(JSON.stringify({ type: 'lisa.cluster.status', cluster: this.clusterStatus(), requestId: safeRequestId(message.requestId) }));
        return;
      }

      // Everything else is dispatched to the tandem cluster.
      try {
        const response = await this.dispatch(message);
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify(response));
        }
      } catch (error) {
        this.log(`[LISA Proxy] Dispatch failed for client ${clientIp}: ${error.message}`);
        if (ws.readyState === WebSocket.OPEN) {
          // Failure-injection hygiene: internal error details (unit ids,
          // timeouts, stack context) stay in the server log; clients get
          // a fixed, non-committal message.
          ws.send(JSON.stringify({ type: 'error', message: 'Request could not be completed', requestId: safeRequestId(message.requestId) }));
        }
      }
    });

    ws.on('close', () => {
      this.log(`[LISA Proxy] Client disconnected from ${clientIp}`);
      this.clients.delete(ws);
    });

    ws.on('error', (error) => {
      this.log(`[LISA Proxy] Client error: ${error.message}`);
      this.clients.delete(ws);
    });
  }

  clusterStatus() {
    const healthy = this.getHealthyUnits();
    return {
      mode: healthy.length >= 2 ? 'TANDEM' : (healthy.length === 1 ? 'DEGRADED-SINGLE' : 'OFFLINE'),
      unitsHealthy: healthy.length,
      unitsTotal: this.units.length,
      units: this.units.map((u) => ({
        id: u.id,
        // Topology hygiene: unit host:port never leaves the server. Only
        // the proxy needs to know where the units live.
        healthy: u.healthy,
        connected: u.connected,
        inFlight: u.inFlight,
        totalRequests: u.totalRequests,
        failures: u.failures,
        lastLatencyMs: u.lastLatencyMs,
        role: u.role || null,
        capabilities: Array.isArray(u.capabilities) ? u.capabilities : []
      })),
      routing: {
        dispatchByClass: this.stats.dispatchByClass,
        last: this._lastRouting
      },
      requestsDispatched: this.stats.requestsDispatched,
      failovers: this.stats.failovers,
      timestamp: new Date().toISOString()
    };
  }

  start() {
    this.configureUnits();
    const server = http.createServer();
    this.server = server;
    const wss = new WebSocketServer({ server });

    this.gateway = attachOptimizerGateway(server, this, {
      requireToken: process.env.OPTIMIZER_GATEWAY_TOKEN || null
    });

    wss.on('connection', (ws, req) => this.handleClient(ws, req));

    server.listen(this.port, () => {
      console.log('===================================');
      console.log('  RNK VORTEX QUANTUM - LISA PROXY');
      console.log('  Dual-Unit Tandem Cluster Mode');
      console.log('===================================');
      console.log(`[OK] Proxy listening on port ${this.port}`);
      console.log(`[OK] Security: No external IP exposure`);
      console.log('[OK] Zero-config: auto-discovering VQ units...');
      console.log('===================================');
    });

    // Initial discovery, then periodic re-scan for units that start later.
    this.discoverUnits().catch(() => {});
    this.discoveryTimer = setInterval(() => {
      this.discoverUnits().catch(() => {});
    }, DISCOVERY_INTERVAL_MS);

    // Wire-level health polling of both units.
    this.pollTimer = setInterval(() => {
      this.units.forEach((unit) => {
        unit.pollHealth().catch(() => {});
      });
    }, POLL_INTERVAL_MS);

    // Stats reporting
    setInterval(() => {
      const s = this.clusterStatus();
      console.log(`[LISA Proxy] Stats: ${this.clients.size} clients, mode=${s.mode}, units=${s.unitsHealthy}/${s.unitsTotal}, dispatched=${s.requestsDispatched}, failovers=${s.failovers}`);
    }, 60000);

    // Graceful shutdown
    process.on('SIGINT', () => {
      console.log('\n[LISA Proxy] Shutting down...');
      this.stop();
      server.close(() => {
        console.log('[LISA Proxy] Server closed');
        process.exit(0);
      });
    });
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.discoveryTimer) clearInterval(this.discoveryTimer);
    if (this.gateway) this.gateway.close();
    this.units.forEach((unit) => unit.stop());
    this.clients.forEach((client) => client.close());
  }
}

// Auto-start lives in start-proxy.mjs so this module stays a pure,
// testable ESM library (import.meta cannot survive Jest's CJS transform).

export { LISAProxyServer, VQUnit, probePort, UNIT_PORTS };
