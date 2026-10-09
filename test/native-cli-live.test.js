/**
 * Live CLI adapter tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { runGatewayVerifyCommand, runGpuFpsControlCommand, runMacosLaunchLimitCommand, runWindowsRogVerifyCommand } from '../native/cli-live.mjs';
import { runCli } from '../native/cli.mjs';

describe('live CLI adapters', () => {
  test('passes explicit gateway options to the verifier', async () => {
    const verify = jest.fn(async (options) => ({ state: options.gatewayUrl, profile: options.profile, timeoutMs: options.timeoutMs }));
    await expect(runGatewayVerifyCommand({ gateway: 'https://gateway.example/plan', token: 't', client: 'c', profile: 'gaming', 'timeout-ms': '2500' }, { adapter: {}, verify })).resolves.toEqual({ state: 'https://gateway.example/plan', profile: 'gaming', timeoutMs: 2500 });
    expect(verify).toHaveBeenCalledWith(expect.objectContaining({ gatewayToken: 't', clientId: 'c', adapter: {} }));
  });

  test('uses environment values and rejects missing gateway', async () => {
    const verify = jest.fn(async () => ({ state: 'verified' }));
    await expect(runGatewayVerifyCommand({}, { env: { OPTIMIZER_GATEWAY_URL: 'https://gateway.example/plan', OPTIMIZER_GATEWAY_TOKEN: 'env-token', OPTIMIZER_CLIENT_ID: 'env-client' }, adapter: {}, verify })).resolves.toEqual({ state: 'verified' });
    await expect(runGatewayVerifyCommand({}, { env: {}, adapter: {}, verify })).rejects.toThrow('--gateway is required');
  });

  test('reports Windows-only ROG verification and collects Windows facts', async () => {
    await expect(runWindowsRogVerifyCommand({ platform: 'linux' })).resolves.toMatchObject({ state: 'unsupported', platform: 'linux' });
    const commandRunner = { run: jest.fn(async () => ({ code: 0, stdout: JSON.stringify({ Manufacturer: 'ASUS', Model: 'ROG STRIX', IsAdministrator: false }) })) };
    await expect(runWindowsRogVerifyCommand({ platform: 'win32', commandRunner })).resolves.toMatchObject({ platform: 'win32', rog: { isRog: true } });
  });

  test('runs universal GPU/FPS preview and approved apply commands', async () => {
    const adapter = { collectFacts: jest.fn(async () => ({ platform: 'linux', gpu: { available: false } })), applyAction: jest.fn() };
    await expect(runGpuFpsControlCommand('gpu-fps-preview', { 'fps-limit': '60' }, { adapter })).resolves.toMatchObject({ plan: { state: 'unsupported-control' } });
    await expect(runGpuFpsControlCommand('gpu-fps-apply', { 'fps-limit': '60' }, { adapter })).rejects.toThrow('--confirm');
    await expect(runGpuFpsControlCommand('gpu-fps-apply', { 'fps-limit': '60', confirm: true }, { adapter })).resolves.toMatchObject({ result: { state: 'unsupported' } });
    await expect(runGpuFpsControlCommand('gpu-fps-preview', {}, { adapter: {} })).rejects.toThrow('platform adapter');
  });

  test('runs macOS launch-limit preview and apply boundaries', async () => {
    await expect(runMacosLaunchLimitCommand('macos-limit-preview', { label: 'rnk.test', executable: '/bin/game', 'memory-bytes': String(64 * 1024 ** 2) }, { platform: 'linux' })).resolves.toMatchObject({ state: 'unsupported' });
    await expect(runMacosLaunchLimitCommand('macos-limit-preview', { label: 'rnk.test', executable: '/bin/game', 'memory-bytes': String(64 * 1024 ** 2) }, { platform: 'darwin' })).resolves.toMatchObject({ state: 'plan-ready' });
    await expect(runMacosLaunchLimitCommand('macos-limit-apply', { label: 'rnk.test', executable: '/bin/game', 'memory-bytes': String(64 * 1024 ** 2) }, { platform: 'darwin' })).rejects.toThrow('--confirm');
    const runner = { run: jest.fn(async () => ({ code: 0 })) };
    const fsImpl = { mkdir: jest.fn(async () => {}), writeFile: jest.fn(async () => {}) };
    const pathImpl = { join: (...parts) => parts.join('/') };
    await expect(runMacosLaunchLimitCommand('macos-limit-apply', { label: 'rnk.test', executable: '/bin/game', 'args-json': '["--safe"]', 'memory-bytes': String(64 * 1024 ** 2), confirm: true }, { platform: 'darwin', commandRunner: runner, fsImpl, pathImpl, userId: '501' })).resolves.toMatchObject({ result: { state: 'applied' } });
  });

  test('routes live commands through the native CLI dispatcher', async () => {
    await expect(runCli(['gateway-verify'], { adapter: {} })).rejects.toThrow('--gateway is required');
    await expect(runCli(['windows-rog-verify'], { platform: 'linux', adapter: {} })).resolves.toMatchObject({ state: 'unsupported' });
    const adapter = { collectFacts: jest.fn(async () => ({ platform: 'linux', gpu: { available: false } })) };
    await expect(runCli(['gpu-fps-preview', '--fps-limit=60'], { platform: 'linux', adapter })).resolves.toMatchObject({ plan: { state: 'unsupported-control' } });
    await expect(runCli(['macos-limit-preview', '--label=rnk.test', '--executable=/bin/game'], { platform: 'linux', adapter })).resolves.toMatchObject({ state: 'unsupported' });
  });
});
