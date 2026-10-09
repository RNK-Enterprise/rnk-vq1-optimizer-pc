import { collectNetworkConnectionTelemetry, NETWORK_CONNECTIONS_VERSION, parseNetworkConnectionTelemetry } from '../native/network-connections.js';

function runner(result) { return { run: jest.fn(async () => result) }; }

describe('native network connection evidence', () => {
  test('parses bounded Windows, Linux, and macOS ownership evidence', () => {
    const windows = parseNetworkConnectionTelemetry(JSON.stringify({ OwningProcess: 12, State: 'Established', LocalAddress: '127.0.0.1', LocalPort: 3000, RemoteAddress: '10.0.0.2', RemotePort: 443 }), { platform: 'win32' });
    expect(windows).toMatchObject({ version: NETWORK_CONNECTIONS_VERSION, available: true, source: 'Get-NetTCPConnection', connections: [{ pid: 12, state: 'Established', localPort: '3000', remotePort: '443' }] });
    expect(parseNetworkConnectionTelemetry(JSON.stringify({ OwningProcess: 13, localEndpoint: '127.0.0.1:1', remoteEndpoint: '10.0.0.2:2' }), { platform: 'win32' }).connections[0]).toMatchObject({ localPort: '1', remotePort: '2' });
    expect(parseNetworkConnectionTelemetry(JSON.stringify({ processId: 14, local: '127.0.0.1:3', remote: '10.0.0.2:4' }), { platform: 'win32' }).connections[0]).toMatchObject({ pid: 14, localPort: '3', remotePort: '4' });
    expect(parseNetworkConnectionTelemetry(JSON.stringify({ processId: 15 }), { platform: 'win32' }).connections[0]).toMatchObject({ pid: 15, localAddress: null, remoteAddress: null });
    expect(parseNetworkConnectionTelemetry(JSON.stringify({ processId: 16, LocalAddress: '127.0.0.1', RemoteAddress: '10.0.0.2' }), { platform: 'win32' }).connections[0]).toMatchObject({ pid: 16, localPort: null, remotePort: null });
    expect(parseNetworkConnectionTelemetry(JSON.stringify({ OwningProcess: 0 }), { platform: 'win32' })).toMatchObject({ available: false, connections: [] });
    expect(parseNetworkConnectionTelemetry(undefined, { platform: 'win32' })).toMatchObject({ available: false, connections: [] });
    const linux = parseNetworkConnectionTelemetry('tcp ESTAB 0 0 127.0.0.1:3000 10.0.0.2:443 users:(("node",pid=42,fd=3))\nudp UNCONN 0 0 *:* *:*', { platform: 'linux' });
    expect(linux.connections[0]).toMatchObject({ pid: 42, name: 'node', protocol: 'tcp', localPort: '3000', remoteAddress: '10.0.0.2', remotePort: '443' });
    const mac = parseNetworkConnectionTelemetry('COMMAND PID USER FD TYPE DEVICE SIZE/OFF NODE NAME\nnode 42 odinn 3u IPv4 1 0t0 TCP 127.0.0.1:3000->10.0.0.2:443 (ESTABLISHED)', { platform: 'darwin' });
    expect(mac.connections[0]).toMatchObject({ pid: 42, name: 'node', protocol: 'tcp', state: 'ESTABLISHED' });
    expect(parseNetworkConnectionTelemetry('malformed mac row', { platform: 'darwin' })).toMatchObject({ available: false, connections: [] });
    expect(parseNetworkConnectionTelemetry('bad', { platform: 'freebsd' })).toMatchObject({ available: false, source: 'platform unsupported' });
    expect(parseNetworkConnectionTelemetry()).toMatchObject({ available: false, platform: 'unknown' });
  });

  test('rejects malformed rows and reports truncation without exceeding the bound', () => {
    expect(parseNetworkConnectionTelemetry('tcp ESTAB 0 0 local remote', { platform: 'linux' })).toMatchObject({ available: false });
    expect(parseNetworkConnectionTelemetry('tcp ESTAB 0 0 local remote users:(("x",pid=2))\nshort', { platform: 'linux' }).connections).toHaveLength(1);
    const many = Array.from({ length: 513 }, (_, index) => `tcp ESTAB 0 0 127.0.0.1:${index + 1} 10.0.0.2:443 users:(("node",pid=${index + 1}))`).join('\n');
    expect(parseNetworkConnectionTelemetry(many, { platform: 'linux' })).toMatchObject({ truncated: true, connections: expect.any(Array) });
    expect(parseNetworkConnectionTelemetry(JSON.stringify([{ OwningProcess: 1 }, { OwningProcess: 0 }]), { platform: 'win32' }).connections).toHaveLength(1);
  });

  test('collects fixed commands and fails closed', async () => {
    const win = runner({ code: 0, stdout: JSON.stringify({ OwningProcess: 1, State: 'Established' }) });
    await expect(collectNetworkConnectionTelemetry({ platform: 'win32', commandRunner: win })).resolves.toMatchObject({ available: true });
    expect(win.run.mock.calls[0][0]).toBe('powershell.exe');
    await expect(collectNetworkConnectionTelemetry({ platform: 'linux', commandRunner: runner({ code: 0, stdout: 'tcp ESTAB 0 0 127.0.0.1:1 10.0.0.2:443 users:(("node",pid=2))' }) })).resolves.toMatchObject({ available: true });
    await expect(collectNetworkConnectionTelemetry({ platform: 'darwin', commandRunner: runner({ code: 0, stdout: '' }) })).resolves.toMatchObject({ available: false });
    await expect(collectNetworkConnectionTelemetry({ platform: 'freebsd', commandRunner: win })).resolves.toMatchObject({ available: false, source: 'platform unsupported' });
    await expect(collectNetworkConnectionTelemetry({ platform: 'linux' })).resolves.toMatchObject({ available: false, source: 'command runner unavailable' });
    await expect(collectNetworkConnectionTelemetry({ platform: 'linux', commandRunner: runner({ code: 1, stderr: 'denied' }) })).resolves.toMatchObject({ source: 'denied' });
    await expect(collectNetworkConnectionTelemetry({ platform: 'linux', commandRunner: { run: jest.fn().mockRejectedValue(new Error('missing')) } })).resolves.toMatchObject({ source: 'missing' });
    await expect(collectNetworkConnectionTelemetry()).resolves.toMatchObject({ source: 'command runner unavailable' });
  });
});
