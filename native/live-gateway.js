/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Read-only live gateway verification. A verified response is still a plan;
 * this module never dispatches a native action.
 */

import { validateGatewayUrl } from './gateway-url.js';
import { validateNativePlan } from './protocol.js';

export const LIVE_GATEWAY_VERSION = 1;
const PROFILES = Object.freeze(['balanced', 'gaming', 'developer']);

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function profile(value) {
  const selected = text(value) || 'balanced';
  if (!PROFILES.includes(selected)) throw new Error(`Unsupported gateway verification profile: ${selected}`);
  return selected;
}
function result(state, gateway, details) {
  return Object.freeze({ version: LIVE_GATEWAY_VERSION, state, gateway, ...details });
}

/** Verify reachability, response JSON, protocol, TTL, and action boundaries. */
export async function verifyLiveGateway({
  gatewayUrl,
  facts = {},
  profile: requestedProfile = 'balanced',
  clientId = 'native-live-verifier',
  gatewayToken = '',
  fetchFn = globalThis.fetch,
  now = Date.now,
  timeoutMs = 10000
} = {}) {
  const gateway = validateGatewayUrl(gatewayUrl);
  if (!record(facts)) throw new TypeError('Gateway verification facts must be an object');
  if (typeof fetchFn !== 'function') throw new Error('Fetch is unavailable');
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new RangeError('Gateway verification timeout is invalid');
  const selectedProfile = profile(requestedProfile);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = { 'content-type': 'application/json' };
  if (text(gatewayToken)) headers['x-optimizer-token'] = gatewayToken.trim();
  try {
    const response = await fetchFn(gateway, {
      method: 'POST',
      headers,
      signal: controller.signal,
      body: JSON.stringify({
        protocolVersion: 1,
        requestId: `gateway-verify-${now()}`,
        profile: selectedProfile,
        scope: 'self',
        clientId: text(clientId) || 'native-live-verifier',
        targetClientIds: [],
        telemetry: facts
      })
    });
    if (!response?.ok) return result('rejected', gateway, { status: response?.status || null, reason: 'gateway returned a non-success status' });
    if (typeof response.json !== 'function') return result('rejected', gateway, { reason: 'gateway returned no JSON response' });
    const body = await response.json();
    const plan = validateNativePlan(body?.plan || body, { now });
    return result('verified', gateway, { planId: plan.planId, actionCount: plan.actions.length, expiresAt: plan.expiresAt, protocolVersion: plan.protocolVersion });
  } catch (error) {
    return result('unavailable', gateway, { reason: error.message });
  } finally {
    clearTimeout(timer);
  }
}

export async function verifyLiveGatewayWithAdapter({ adapter, gatewayUrl, ...options } = {}) {
  if (!adapter || typeof adapter.collectFacts !== 'function') throw new TypeError('Gateway verification requires a platform adapter');
  return verifyLiveGateway({ gatewayUrl, facts: await adapter.collectFacts(), ...options });
}
