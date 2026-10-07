/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
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
 * Foundry-side Optimizer Gateway.
 * This file is transport and validation only. Optimization decisions remain
 * in VQ-1/VQ-2; no engine, model, heuristic, or executable plan code lives here.
 */

import { createHash, timingSafeEqual } from 'crypto';
import {
  RELAY_ACTION_LIMIT,
  RELAY_PLAN_TTL_MS,
  RELAY_TELEMETRY_LIMIT,
  RelayAuditLog,
  RelayRateLimiter,
  RelayReplayGuard,
  createOpaqueClientId,
  sanitizeTelemetry,
  validateRelayPlan
} from './foundry-relay-security.js';

const PROTOCOL_VERSION = 1;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_CLIENTS = 256;
const MAX_TELEMETRY_BYTES = RELAY_TELEMETRY_LIMIT;
const PROFILE_SET = new Set(['power', 'balanced', 'performance', 'low-latency', 'battery-mobile']);
const SCOPE_SET = new Set(['self', 'all', 'selected']);
const OPAQUE_CLIENT_ID = /^client_[A-Za-z0-9_-]{20,}$/;
const SAFE_PLAN_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const SAFE_CATEGORY = /^[a-z][a-z0-9._-]{0,31}$/;

function json(res, status, body) {
  const encoded = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Optimizer-Protocol', String(PROTOCOL_VERSION));
  res.end(encoded);
}

function requestId() {
  return `optimizer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorText(error) {
  return String(error?.message ?? error);
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

function environmentGMAuthenticator(_req, { assertion }) {
  const expected = process.env.FOUNDRY_GM_TOKEN || null;
  return expected && tokensMatch(assertion, expected)
    ? { ok: true, gmId: 'foundry-gm' }
    : false;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
        reject(new Error('Request body exceeds gateway limit'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Request body must be valid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function safeTelemetry(value) {
  return sanitizeTelemetry(value, { maxBytes: MAX_TELEMETRY_BYTES });
}

function parseCookies(value) {
  const cookies = {};
  for (const item of String(value || '').split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (!key || parts.length === 0) continue;
    try {
      cookies[key] = decodeURIComponent(parts.join('='));
    } catch {
      // An invalid cookie cannot become an identity.
    }
  }
  return cookies;
}

function clientIdFromCookie(req) {
  const value = parseCookies(req.headers.cookie).optimizer_client_id;
  return typeof value === 'string' && OPAQUE_CLIENT_ID.test(value) ? value : null;
}

function ensureClientId(req, res) {
  const existing = clientIdFromCookie(req);
  if (existing) return existing;
  const clientId = createOpaqueClientId();
  res.setHeader('Set-Cookie', `optimizer_client_id=${encodeURIComponent(clientId)}; HttpOnly; SameSite=Strict; Path=/optimizer/v1`);
  return clientId;
}

function withTimeout(task, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('VQ request timeout')), timeoutMs);
    Promise.resolve(task).then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}

function validateTargetClientIds(targetClientIds) {
  if (!Array.isArray(targetClientIds) || targetClientIds.length > 128) {
    throw new Error('targetClientIds must be an array of at most 128 opaque ids');
  }
  if (targetClientIds.some((id) => typeof id !== 'string' || !OPAQUE_CLIENT_ID.test(id))) {
    throw new Error('targetClientIds contains an invalid opaque id');
  }
  return targetClientIds.slice();
}

function validatePlanRequest(body, clientId) {
  if (!isObject(body)) throw new Error('Plan request must be an object');
  if (body.protocolVersion !== PROTOCOL_VERSION) throw new Error('Plan request protocol mismatch');
  if (!PROFILE_SET.has(body.profile)) throw new Error(`Unknown optimization profile: ${body.profile}`);
  if (!SCOPE_SET.has(body.scope)) throw new Error(`Unknown optimization scope: ${body.scope}`);
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: requestId(),
    profile: body.profile,
    scope: body.scope,
    clientId,
    targetClientIds: validateTargetClientIds(body.targetClientIds),
    telemetry: safeTelemetry(body.telemetry)
  };
}

function validateTelemetryRequest(body, clientId) {
  if (!isObject(body) || body.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error('Telemetry request protocol mismatch');
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: requestId(),
    clientId,
    telemetry: safeTelemetry(body.telemetry)
  };
}

function validateCleanupRequest(body, clientId) {
  const request = validateTelemetryRequest(body, clientId);
  const categories = Array.isArray(body.categories) ? body.categories.slice(0, 16) : [];
  if (categories.some((category) => typeof category !== 'string' || !SAFE_CATEGORY.test(category))) {
    throw new Error('Cleanup categories must be bounded identifiers');
  }
  return { ...request, categories };
}

function validateApplyRequest(body) {
  if (!isObject(body) || body.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error('Apply request protocol mismatch');
  }
  if (typeof body.planId !== 'string' || !SAFE_PLAN_ID.test(body.planId)) {
    throw new Error('Apply request requires a valid planId');
  }
  if (!SCOPE_SET.has(body.scope)) throw new Error(`Unknown optimization scope: ${body.scope}`);
  if (!Number.isInteger(body.actionCount) || body.actionCount < 0 || body.actionCount > RELAY_ACTION_LIMIT) {
    throw new Error(`actionCount must be an integer from 0-${RELAY_ACTION_LIMIT}`);
  }
  return { planId: body.planId, scope: body.scope, actionCount: body.actionCount };
}

function normalizePlan(response, request, { now, maxTtlMs }) {
  const plan = response?.plan || (response?.type === 'vq.optimizer.plan' ? response : null);
  if (!isObject(plan) || plan.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(plan.actions)) return null;
  return validateRelayPlan({
    ...plan,
    planId: null,
    profile: plan.profile || request.profile,
    scope: plan.scope || request.scope,
    sourceUnits: [response.unitId].filter((id) => typeof id === 'string')
  }, { now, request, maxTtlMs });
}

function mergePlans(responses, request, options) {
  const plans = responses.map((response) => normalizePlan(response, request, options)).filter(Boolean);
  if (!plans.length) throw new Error('VQ cluster returned no valid optimizer plan');
  const actionMap = new Map();
  const recommendations = new Set();
  for (const plan of plans) {
    for (const action of plan.actions) {
      const key = `${action.type}:${action.key}`;
      // Later VQ responses are allowed to specialize an earlier suggestion,
      // while the gateway still treats the payload as opaque data.
      actionMap.set(key, action);
    }
    for (const recommendation of plan.recommendations) recommendations.add(recommendation);
  }
  return validateRelayPlan({
    ...plans[plans.length - 1],
    planId: null,
    profile: request.profile,
    scope: request.scope,
    targetClientIds: request.targetClientIds,
    actions: [...actionMap.values()],
    recommendations: [...recommendations].slice(0, 32),
    sourceUnits: [...new Set(plans.flatMap((plan) => plan.sourceUnits))]
  }, options);
}

function clientView(record) {
  return {
    clientId: record.clientId,
    lastSeen: record.lastSeen,
    telemetry: record.telemetry,
    profile: record.profile,
    scope: record.scope
  };
}

/** Attach the HTTP gateway to the already-created Foundry proxy server. */
export function attachOptimizerGateway(server, proxy, {
  requireToken = null,
  now = () => Date.now(),
  authenticateGM = environmentGMAuthenticator,
  requestTimeoutMs = 7000,
  maxPlanTtlMs = RELAY_PLAN_TTL_MS,
  rateLimit = {}
} = {}) {
  if (!server || typeof server.on !== 'function') throw new TypeError('Gateway requires an HTTP server');
  if (!proxy || typeof proxy.clusterStatus !== 'function' || typeof proxy.dispatch !== 'function') {
    throw new TypeError('Gateway requires a tandem proxy');
  }
  if (typeof authenticateGM !== 'function') throw new TypeError('Gateway GM authenticator must be a function');
  const timeoutMs = Number.isFinite(requestTimeoutMs) && requestTimeoutMs >= 1 ? requestTimeoutMs : 7000;
  const rateLimiter = new RelayRateLimiter({ now, ...(isObject(rateLimit) ? rateLimit : {}) });
  const sourceRateLimiter = new RelayRateLimiter({ now, ...(isObject(rateLimit) ? rateLimit : {}) });
  const replayGuard = new RelayReplayGuard({ now });
  const auditLog = new RelayAuditLog();
  const clients = new Map();
  const authorize = (req) => !requireToken || tokensMatch(req.headers['x-optimizer-token'], requireToken);
  const remember = (clientId, telemetry, extra = {}) => {
    clients.set(clientId, { clientId, telemetry, lastSeen: new Date(now()).toISOString(), ...extra });
    while (clients.size > MAX_CLIENTS) clients.delete(clients.keys().next().value);
  };
  const dispatchTandem = async (payload) => {
    if (typeof proxy.dispatchTandem === 'function') return proxy.dispatchTandem(payload);
    return [await proxy.dispatch(payload)];
  };
  const authenticateControl = async (req, operation, clientId) => {
    try {
      const result = await authenticateGM(req, {
        operation,
        clientId,
        assertion: typeof req.headers['x-foundry-gm-assertion'] === 'string'
          ? req.headers['x-foundry-gm-assertion']
          : null
      });
      if (result === true) return 'gm';
      if (!isObject(result) || result.ok !== true) return null;
      return typeof result.gmId === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(result.gmId)
        ? result.gmId
        : 'gm';
    } catch {
      return null;
    }
  };

  const listener = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/optimizer/v1/')) return false;
    if (!authorize(req)) {
      json(res, 401, { error: 'unauthorized' });
      return true;
    }
    const clientId = ensureClientId(req, res);
    const clientRate = rateLimiter.check(clientId);
    const sourceKey = typeof req.socket?.remoteAddress === 'string' ? req.socket.remoteAddress : 'unknown';
    const sourceRate = sourceRateLimiter.check(sourceKey);
    if (!clientRate.allowed || !sourceRate.allowed) {
      const retryAfterMs = Math.max(clientRate.retryAfterMs, sourceRate.retryAfterMs);
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
      json(res, 429, { error: 'rate limit exceeded' });
      return true;
    }
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.setHeader('Allow', 'GET,POST,OPTIONS');
      res.end();
      return true;
    }
    try {
      if (url.pathname === '/optimizer/v1/status' || url.pathname === '/optimizer/v1/clients') {
        if (req.method !== 'GET') {
          json(res, 405, { error: 'method not allowed' });
          return true;
        }
        if (url.pathname === '/optimizer/v1/status') {
          json(res, 200, { protocolVersion: PROTOCOL_VERSION, gateway: 'online', cluster: proxy.clusterStatus(), clients: clients.size });
        } else {
          json(res, 200, { protocolVersion: PROTOCOL_VERSION, clients: [...clients.values()].map(clientView) });
        }
        return true;
      }
      if (url.pathname === '/optimizer/v1/control/apply') {
        if (req.method !== 'POST') {
          json(res, 405, { error: 'method not allowed' });
          return true;
        }
        const gmId = await authenticateControl(req, 'apply', clientId);
        if (!gmId) {
          json(res, 403, { error: 'GM authentication required' });
          return true;
        }
        const body = await readBody(req);
        const apply = validateApplyRequest(body);
        replayGuard.consume(apply.planId, clientId, apply);
        auditLog.append({
          at: new Date(now()).toISOString(),
          operation: 'apply',
          gmId,
          clientId,
          planId: apply.planId,
          scope: apply.scope,
          actionCount: apply.actionCount
        });
        json(res, 200, { protocolVersion: PROTOCOL_VERSION, accepted: true, planId: apply.planId });
        return true;
      }
      const postPaths = new Set(['/optimizer/v1/telemetry', '/optimizer/v1/plan', '/optimizer/v1/cleanup/recommend']);
      if (!postPaths.has(url.pathname)) {
        json(res, 404, { error: 'not found' });
        return true;
      }
      if (req.method !== 'POST') {
        json(res, 405, { error: 'method not allowed' });
        return true;
      }
      const body = await readBody(req);
      if (url.pathname === '/optimizer/v1/telemetry') {
        const request = validateTelemetryRequest(body, clientId);
        remember(request.clientId, request.telemetry);
        const responses = await withTimeout(dispatchTandem({
          type: 'vq.optimizer.telemetry',
          requestId: request.requestId,
          payload: { clientId: request.clientId, telemetry: request.telemetry }
        }), timeoutMs);
        json(res, 200, { protocolVersion: PROTOCOL_VERSION, accepted: true, units: responses.map((item) => item.unitId).filter(Boolean) });
        return true;
      }
      if (url.pathname === '/optimizer/v1/plan') {
        const gmId = await authenticateControl(req, 'plan', clientId);
        if (!gmId) {
          json(res, 403, { error: 'GM authentication required' });
          return true;
        }
        const request = validatePlanRequest(body, clientId);
        remember(request.clientId, request.telemetry, { profile: request.profile, scope: request.scope });
        const responses = await withTimeout(dispatchTandem({ type: 'vq.optimizer.plan', requestId: request.requestId, payload: request }), timeoutMs);
        const plan = mergePlans(responses, request, { now, maxTtlMs: maxPlanTtlMs });
        replayGuard.issue(plan, clientId);
        json(res, 200, { success: true, protocolVersion: PROTOCOL_VERSION, plan });
        return true;
      }
      const gmId = await authenticateControl(req, 'cleanup.recommend', clientId);
      if (!gmId) {
        json(res, 403, { error: 'GM authentication required' });
        return true;
      }
      const request = validateCleanupRequest(body, clientId);
      const responses = await withTimeout(dispatchTandem({
        type: 'vq.optimizer.cleanup.recommend',
        requestId: request.requestId,
        payload: { clientId: request.clientId, telemetry: request.telemetry, categories: request.categories }
      }), timeoutMs);
      json(res, 200, { success: true, protocolVersion: PROTOCOL_VERSION, recommendations: responses.map((item) => item.recommendations || []).flat().slice(0, 32) });
      return true;
    } catch (error) {
      json(res, 400, { error: errorText(error) });
      return true;
    }
  };

  const requestHandler = (req, res) => {
    listener(req, res).then((handled) => {
      if (!handled && !res.writableEnded) {
        res.statusCode = 404;
        res.end('Not found');
      }
    }).catch((error) => {
      if (!res.writableEnded) json(res, 500, { error: errorText(error) });
    });
  };
  server.on('request', requestHandler);
  return {
    clients,
    audit: () => auditLog.list(),
    close() {
      server.off?.('request', requestHandler);
    }
  };
}

export const optimizerGatewayConstants = Object.freeze({ PROTOCOL_VERSION, MAX_BODY_BYTES, MAX_CLIENTS, MAX_TELEMETRY_BYTES });
