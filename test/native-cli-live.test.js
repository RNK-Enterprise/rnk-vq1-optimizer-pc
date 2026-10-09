/**
 * Live CLI adapter tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { runGatewayVerifyCommand, runWindowsRogVerifyCommand } from '../native/cli-live.mjs';

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
});
