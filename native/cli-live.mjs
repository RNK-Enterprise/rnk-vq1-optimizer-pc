/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * CLI adapters for live, read-only verification commands.
 */

import { verifyLiveGatewayWithAdapter } from './live-gateway.js';
import { collectWindowsRogFacts } from './windows-rog.js';
import { applyGpuFpsControl, previewGpuFpsControl } from './gpu-fps-control.js';
import { applyMacosLaunchLimits, previewMacosLaunchLimits } from './macos-limits.js';
import fs from 'fs/promises';
import path from 'path';

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

export async function runGpuFpsControlCommand(command, args, { adapter } = {}) {
  if (!adapter || typeof adapter.collectFacts !== 'function') throw new TypeError('GPU/FPS control requires a platform adapter');
  const facts = await adapter.collectFacts();
  const plan = previewGpuFpsControl(facts, {
    policy: args.policy || 'balanced',
    powerLimitWatts: args['power-limit-watts'] === undefined ? null : Number(args['power-limit-watts']),
    fpsLimit: args['fps-limit'] === undefined ? null : Number(args['fps-limit'])
  });
  if (command === 'gpu-fps-preview') return { facts, plan };
  if (args.confirm !== true) throw new Error('gpu-fps-apply requires --confirm');
  return { facts, plan, result: await applyGpuFpsControl(plan, { adapter, approved: true, allowAdmin: args['allow-admin'] === true, dryRun: false }) };
}

export async function runMacosLaunchLimitCommand(command, args, { platform = process.platform, commandRunner, fsImpl = fs, pathImpl = path, userId = typeof process.getuid === 'function' ? String(process.getuid()) : '0' } = {}) {
  if (platform !== 'darwin') return { state: 'unsupported', platform, reason: 'macOS launch limits require macOS' };
  const launchArgs = args['args-json'] === undefined ? [] : JSON.parse(args['args-json']);
  const plan = previewMacosLaunchLimits({ label: args.label, executable: args.executable, args: launchArgs, cpuSeconds: args['cpu-seconds'] === undefined ? null : Number(args['cpu-seconds']), memoryBytes: args['memory-bytes'] === undefined ? null : Number(args['memory-bytes']) });
  if (command === 'macos-limit-preview') return plan;
  if (args.confirm !== true) throw new Error('macos-limit-apply requires --confirm');
  return { plan, result: await applyMacosLaunchLimits(plan, { commandRunner, fsImpl, pathImpl, userId, approved: true, dryRun: false }) };
}
