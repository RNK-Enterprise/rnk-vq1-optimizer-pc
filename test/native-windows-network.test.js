/**
 * Windows network authority tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { applyWindowsTrafficShape, buildWindowsTrafficShapeAction, collectWindowsNetworkCounters, parseWindowsNetworkCounters, removeWindowsTrafficShape, windowsTrafficShapeCommands, WINDOWS_NETWORK_COVERAGE } from '../native/windows-network.js';

const valid = { pid: 42, bytesPerSecond: 4096 };

describe('Windows network authority', () => {
  test('parses bounded per-process counters and refuses malformed provider data', () => {
    expect(parseWindowsNetworkCounters(JSON.stringify([{ Pid: 42, ProcessName: 'game.exe', BytesReceived: 100, BytesSent: 200, Protocol: 'tcp', AddressFamily: 'ipv4' }]))).toMatchObject({ state: 'observed', available: true, source: 'windows-ipv4-tcp-estats', coverage: WINDOWS_NETWORK_COVERAGE, processes: [{ pid: 42, name: 'game.exe', receivedBytes: 100, sentBytes: 200, protocol: 'tcp', addressFamily: 'ipv4' }] });
    expect(parseWindowsNetworkCounters(JSON.stringify([{ Pid: 43, ProcessName: 'ipv6.exe', BytesReceived: 100, BytesSent: 200, Protocol: 'tcp', AddressFamily: 'ipv6' }]))).toMatchObject({ state: 'unavailable', available: false });
    expect(parseWindowsNetworkCounters(JSON.stringify({ ProcessId: 7, ReceivedBytes: 1, SentBytes: 2 }))).toMatchObject({ state: 'observed', processes: [{ pid: 7, name: 'unknown' }] });
    expect(parseWindowsNetworkCounters(JSON.stringify([{ Pid: 7, BytesReceived: 1, BytesSent: 2, Protocol: 'udp' }, { Pid: 8, BytesReceived: 1, BytesSent: 2, AddressFamily: 'other' }]))).toMatchObject({ state: 'unavailable', available: false });
    expect(parseWindowsNetworkCounters(JSON.stringify([{ Pid: 9, BytesReceived: 1, BytesSent: 2, Protocol: null, AddressFamily: null }]))).toMatchObject({ state: 'unavailable', available: false });
    expect(parseWindowsNetworkCounters('bad')).toMatchObject({ state: 'unavailable', available: false });
    expect(parseWindowsNetworkCounters(JSON.stringify([{ Pid: 0, BytesReceived: -1, BytesSent: null }]))).toMatchObject({ state: 'unavailable', reason: 'no valid process counters were returned' });
    expect(parseWindowsNetworkCounters()).toMatchObject({ state: 'unavailable' });
    expect(parseWindowsNetworkCounters('null')).toMatchObject({ state: 'unavailable' });
  });

  test('collects only from the fixed provider', async () => {
    await expect(collectWindowsNetworkCounters()).resolves.toMatchObject({ state: 'unavailable', reason: 'command runner unavailable' });
    const runner = { run: jest.fn(async () => ({ code: 0, stdout: JSON.stringify([{ Pid: 42, BytesReceived: 1, BytesSent: 2 }]) })) };
    await expect(collectWindowsNetworkCounters({ commandRunner: runner })).resolves.toMatchObject({ state: 'observed' });
    expect(runner.run).toHaveBeenCalledWith('powershell.exe', expect.arrayContaining(['-File', expect.stringContaining('windows-network-counters.ps1'), '--json']), expect.objectContaining({ timeoutMs: 10000 }));
    runner.run.mockResolvedValueOnce({ code: 1, stderr: 'provider failed' });
    await expect(collectWindowsNetworkCounters({ commandRunner: runner })).resolves.toMatchObject({ state: 'unavailable', reason: 'provider failed' });
    runner.run.mockRejectedValueOnce(new Error('not installed'));
    await expect(collectWindowsNetworkCounters({ commandRunner: runner })).resolves.toMatchObject({ state: 'unavailable', reason: 'not installed' });
  });

  test('builds and applies approval-gated NetQos policies', async () => {
    const action = buildWindowsTrafficShapeAction(valid);
    expect(action).toMatchObject({ type: 'set-process-network-limit', label: 'WINDOWS_APP_NETWORK_LIMIT', pid: 42, limit: 4096, scope: 'APPLICATION_PATH', instanceScoped: false, policyName: 'RNK-Optimizer-42' });
    expect(() => buildWindowsTrafficShapeAction({ pid: 0, bytesPerSecond: 4096 })).toThrow('bounded');
    expect(() => buildWindowsTrafficShapeAction({ pid: 42, bytesPerSecond: 1 })).toThrow('bounded');
    expect(() => buildWindowsTrafficShapeAction()).toThrow('bounded');
    await expect(applyWindowsTrafficShape(action)).resolves.toMatchObject({ state: 'approval-required', applied: false });
    await expect(applyWindowsTrafficShape(action, { approved: true, dryRun: true })).resolves.toMatchObject({ state: 'preview', applied: false });
    await expect(applyWindowsTrafficShape(action, { approved: true, dryRun: false })).resolves.toMatchObject({ state: 'unavailable', applied: false });
    const runner = { run: jest.fn(async () => ({ code: 0, stdout: JSON.stringify({ verified: true, requestedPid: 42, resolvedExecutablePath: 'C:\\Game\\game.exe', enforcementScope: 'APPLICATION_PATH', policyName: 'RNK-Optimizer-42', rateBytesPerSecond: 4096 }) })) };
    await expect(applyWindowsTrafficShape(action, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'applied', applied: true, verified: true, resolvedExecutablePath: 'C:\\Game\\game.exe', scope: 'APPLICATION_PATH' });
    expect(runner.run.mock.calls[0][0]).toBe('powershell.exe');
    runner.run.mockResolvedValueOnce({ code: 1, stderr: 'access denied' });
    await expect(applyWindowsTrafficShape(action, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'access denied' });
    runner.run.mockRejectedValueOnce(new Error('runner error'));
    await expect(applyWindowsTrafficShape(action, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'runner error' });
    runner.run.mockResolvedValueOnce({ code: 1 });
    await expect(applyWindowsTrafficShape(action, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'Windows traffic shaping failed' });
    runner.run.mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ verified: true }) });
    await expect(applyWindowsTrafficShape(action, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'applied', resolvedExecutablePath: null, policyName: 'RNK-Optimizer-42', rateBytesPerSecond: 4096 });
    runner.run.mockResolvedValueOnce({ code: 0, stdout: 'invalid json' });
    await expect(applyWindowsTrafficShape(action, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'Windows traffic shaping verification unavailable' });
  });

  test('removes approval-gated policies and exposes fixed commands', async () => {
    await expect(removeWindowsTrafficShape(0)).rejects.toThrow('valid process id');
    await expect(removeWindowsTrafficShape(42)).resolves.toMatchObject({ state: 'approval-required', removed: false });
    await expect(removeWindowsTrafficShape(42, { approved: true, dryRun: true })).resolves.toMatchObject({ state: 'preview', removed: false });
    await expect(removeWindowsTrafficShape(42, { approved: true, dryRun: false })).resolves.toMatchObject({ state: 'unavailable', removed: false });
    const runner = { run: jest.fn(async () => ({ code: 0, stdout: JSON.stringify({ verified: true, policyName: 'RNK-Optimizer-42', verification: 'REMOVED' }) })) };
    await expect(removeWindowsTrafficShape(42, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'removed', removed: true, verified: true, scope: 'APPLICATION_PATH' });
    runner.run.mockResolvedValueOnce({ code: 0, stdout: JSON.stringify({ verified: true }) });
    await expect(removeWindowsTrafficShape(42, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'removed', policyName: 'RNK-Optimizer-42' });
    runner.run.mockResolvedValueOnce({ code: 0, stdout: 'null' });
    await expect(removeWindowsTrafficShape(42, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'Windows traffic shaping verification unavailable' });
    runner.run.mockResolvedValueOnce({ code: 1 });
    await expect(removeWindowsTrafficShape(42, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'Windows traffic shaping removal failed' });
    runner.run.mockRejectedValueOnce(new Error('remove error'));
    await expect(removeWindowsTrafficShape(42, { commandRunner: runner, approved: true, dryRun: false })).resolves.toMatchObject({ state: 'rejected', reason: 'remove error' });
    expect(windowsTrafficShapeCommands()).toMatchObject({ provider: 'windows-network-counters.ps1', providerPath: expect.stringContaining('windows-network-counters.ps1'), apply: expect.stringContaining('New-NetQosPolicy'), remove: expect.stringContaining('Remove-NetQosPolicy'), label: 'WINDOWS_APP_NETWORK_LIMIT', scope: 'APPLICATION_PATH', instanceScoped: false, coverage: WINDOWS_NETWORK_COVERAGE });
  });
});
