/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * CLI adapters for live, read-only verification commands.
 */

import { verifyLiveGatewayWithAdapter } from './live-gateway.js';
import { collectWindowsRogFacts } from './windows-rog.js';

function required(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`--${name} is required`);
  return value.trim();
}

export async function runGatewayVerifyCommand(args, { adapter, env = process.env, verify = verifyLiveGatewayWithAdapter } = {}) {
  const gatewayUrl = args.gateway || env.OPTIMIZER_GATEWAY_URL;
  return verify({
    adapter,
    gatewayUrl: required(gatewayUrl, 'gateway'),
    gatewayToken: args.token || env.OPTIMIZER_GATEWAY_TOKEN || '',
    clientId: args.client || env.OPTIMIZER_CLIENT_ID || 'native-live-verifier',
    profile: args.profile || 'balanced',
    timeoutMs: args['timeout-ms'] === undefined ? 10000 : Number(args['timeout-ms'])
  });
}

export async function runWindowsRogVerifyCommand({ platform = process.platform, commandRunner } = {}) {
  if (platform !== 'win32') return { version: 1, state: 'unsupported', platform, reason: 'ROG verification requires Windows' };
  return { platform, rog: await collectWindowsRogFacts({ commandRunner }) };
}
