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
 * Foundry-side Optimizer Gateway.
 * This file is transport and validation only. Optimization decisions remain
 * in VQ-1/VQ-2; no engine, model, heuristic, or executable plan code lives here.
 */

const PROTOCOL_VERSION = 1;
const MAX_BODY_BYTES = 128 * 1024;
const MAX_CLIENTS = 256;
const MAX_TELEMETRY_BYTES = 16 * 1024;
const PROFILE_SET = new Set(['power', 'balanced', 'performance', 'low-latency', 'battery-mobile']);
const SCOPE_SET = new Set(['self', 'all', 'selected']);

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
  if (!isObject(value)) return {};
  let result;
  try {
    result = JSON.parse(JSON.stringify(value));
  } catch {
    return {};
  }
  if (JSON.stringify(result).length > MAX_TELEMETRY_BYTES) return { truncated: true };
  return result;
}

function validatePlanRequest(body) {
  if (!isObject(body)) throw new Error('Plan request must be an object');
  if (body.protocolVersion !== PROTOCOL_VERSION) throw new Error('Plan request protocol mismatch');
  if (!PROFILE_SET.has(body.profile)) throw new Error(`Unknown optimization profile: ${body.profile}`);
  if (!SCOPE_SET.has(body.scope)) throw new Error(`Unknown optimization scope: ${body.scope}`);
  if (body.clientId !== undefined && (typeof body.clientId !== 'string' || body.clientId.length > 128)) {
    throw new Error('clientId must be a short string');
  }
  if (!Array.isArray(body.targetClientIds) || body.targetClientIds.length > 128) {
    throw new Error('targetClientIds must be an array of at most 128 ids');
  }
  if (body.targetClientIds.some((id) => typeof id !== 'string' || id.length > 128)) {
    throw new Error('targetClientIds contains an invalid id');
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: typeof body.requestId === 'string' ? body.requestId.slice(0, 128) : requestId(),
    profile: body.profile,
    scope: body.scope,
    clientId: body.clientId || null,
    targetClientIds: body.targetClientIds.slice(),
    telemetry: safeTelemetry(body.telemetry)
  };
}

function validateTelemetryRequest(body) {
  if (!isObject(body) || body.protocolVersion !== PROTOCOL_VERSION) {
    throw new Error('Telemetry request protocol mismatch');
  }
  if (typeof body.clientId !== 'string' || body.clientId.length === 0 || body.clientId.length > 128) {
    throw new Error('Telemetry requires a short clientId');
  }
  return {
    protocolVersion: PROTOCOL_VERSION,
    requestId: typeof body.requestId === 'string' ? body.requestId.slice(0, 128) : requestId(),
    clientId: body.clientId,
    telemetry: safeTelemetry(body.telemetry)
  };
}

function normalizePlan(response, request) {
  const plan = response?.plan || (response?.type === 'vq.optimizer.plan' ? response : null);
  if (!isObject(plan) || plan.protocolVersion !== PROTOCOL_VERSION || !Array.isArray(plan.actions)) return null;
  const actions = plan.actions.filter((action) => isObject(action)).slice(0, 24);
  return {
    protocolVersion: PROTOCOL_VERSION,
    planId: typeof plan.planId === 'string' ? plan.planId : requestId(),
    profile: PROFILE_SET.has(plan.profile) ? plan.profile : request.profile,
    scope: SCOPE_SET.has(plan.scope) ? plan.scope : request.scope,
    targetClientIds: request.targetClientIds,
    expiresAt: typeof plan.expiresAt === 'string' ? plan.expiresAt : new Date(Date.now() + 30000).toISOString(),
    actions,
    recommendations: Array.isArray(plan.recommendations)
      ? plan.recommendations.filter((item) => typeof item === 'string').slice(0, 32)
      : [],
    sourceUnits: [response.unitId].filter((id) => typeof id === 'string')
  };
}

function mergePlans(responses, request) {
  const plans = responses.map((response) => normalizePlan(response, request)).filter(Boolean);
  if (!plans.length) throw new Error('VQ cluster returned no valid optimizer plan');
  const actionMap = new Map();
  const recommendations = new Set();
  for (const plan of plans) {
    for (const action of plan.actions) {
      const key = `${action.type}:${action.key || ''}`;
      // Later VQ responses are allowed to specialize an earlier suggestion,
      // while the gateway still treats the payload as opaque data.
      actionMap.set(key, action);
    }
    for (const recommendation of plan.recommendations) recommendations.add(recommendation);
  }
  return {
    ...plans[plans.length - 1],
    planId: request.requestId,
    profile: request.profile,
    scope: request.scope,
    targetClientIds: request.targetClientIds,
    actions: [...actionMap.values()].slice(0, 24),
    recommendations: [...recommendations].slice(0, 32),
    sourceUnits: [...new Set(plans.flatMap((plan) => plan.sourceUnits))]
  };
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
export function attachOptimizerGateway(server, proxy, { requireToken = null, now = () => Date.now() } = {}) {
  if (!server || typeof server.on !== 'function') throw new TypeError('Gateway requires an HTTP server');
  if (!proxy || typeof proxy.clusterStatus !== 'function' || typeof proxy.dispatch !== 'function') {
    throw new TypeError('Gateway requires a tandem proxy');
  }
  const clients = new Map();
  const authorize = (req) => !requireToken || req.headers['x-optimizer-token'] === requireToken;
  const remember = (clientId, telemetry, extra = {}) => {
    if (!clientId) return;
    clients.set(clientId, { clientId, telemetry, lastSeen: new Date(now()).toISOString(), ...extra });
    while (clients.size > MAX_CLIENTS) clients.delete(clients.keys().next().value);
  };
  const dispatchTandem = async (payload) => {
    if (typeof proxy.dispatchTandem === 'function') return proxy.dispatchTandem(payload);
    return [await proxy.dispatch(payload)];
  };

  const listener = async (req, res) => {
    const url = new URL(req.url || '/', 'http://localhost');
    if (!url.pathname.startsWith('/optimizer/v1/')) return false;
    if (!authorize(req)) {
      json(res, 401, { error: 'unauthorized' });
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
        const request = validateTelemetryRequest(body);
        remember(request.clientId, request.telemetry);
        const responses = await dispatchTandem({
          type: 'vq.optimizer.telemetry',
          requestId: request.requestId,
          payload: { clientId: request.clientId, telemetry: request.telemetry }
        });
        json(res, 200, { protocolVersion: PROTOCOL_VERSION, accepted: true, units: responses.map((item) => item.unitId).filter(Boolean) });
        return true;
      }
      if (url.pathname === '/optimizer/v1/plan') {
        const request = validatePlanRequest(body);
        remember(request.clientId, request.telemetry, { profile: request.profile, scope: request.scope });
        const responses = await dispatchTandem({ type: 'vq.optimizer.plan', requestId: request.requestId, payload: request });
        json(res, 200, { success: true, protocolVersion: PROTOCOL_VERSION, plan: mergePlans(responses, request) });
        return true;
      }
      if (url.pathname === '/optimizer/v1/cleanup/recommend') {
        const request = validateTelemetryRequest({ ...body, clientId: body.clientId || 'gm' });
        const responses = await dispatchTandem({
          type: 'vq.optimizer.cleanup.recommend',
          requestId: request.requestId,
          payload: { clientId: request.clientId, telemetry: request.telemetry, categories: Array.isArray(body.categories) ? body.categories.slice(0, 16) : [] }
        });
        json(res, 200, { success: true, protocolVersion: PROTOCOL_VERSION, recommendations: responses.map((item) => item.recommendations || []).flat().slice(0, 32) });
        return true;
      }
      json(res, 404, { error: 'not found' });
      return true;
    } catch (error) {
      json(res, 400, { error: error?.message || String(error) });
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
      if (!res.writableEnded) json(res, 500, { error: error?.message || String(error) });
    });
  };
  server.on('request', requestHandler);
  return {
    clients,
    close() {
      server.off?.('request', requestHandler);
    }
  };
}

export const optimizerGatewayConstants = Object.freeze({ PROTOCOL_VERSION, MAX_BODY_BYTES, MAX_CLIENTS, MAX_TELEMETRY_BYTES });
