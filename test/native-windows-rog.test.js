/**
 * Windows ROG host-fact tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { collectWindowsRogFacts, parseWindowsRogFacts, windowsRogCommand } from '../native/windows-rog.js';

const rog = JSON.stringify({ Manufacturer: 'ASUSTeK COMPUTER INC.', Model: 'ROG Zephyrus G16', ProductName: 'ROG STRIX', BiosVersion: 'G16-1', IsAdministrator: true });

describe('Windows ROG host facts', () => {
  test('parses ROG and non-ROG identities', () => {
    expect(parseWindowsRogFacts(rog)).toMatchObject({ state: 'observed', isRog: true, isAdministrator: true, model: 'ROG Zephyrus G16' });
    expect(parseWindowsRogFacts(JSON.stringify({ Manufacturer: 'Dell', Model: 'XPS', ProductName: 'XPS', IsAdministrator: false }))).toMatchObject({ isRog: false, isAdministrator: false });
    expect(parseWindowsRogFacts(JSON.stringify({}))).toMatchObject({ isRog: false, manufacturer: null, model: null, productName: null });
    expect(parseWindowsRogFacts('not-json')).toMatchObject({ state: 'unavailable', isRog: false });
    expect(parseWindowsRogFacts()).toMatchObject({ state: 'unavailable' });
  });

  test('collects facts through the fixed Windows command and fails closed', async () => {
    const runner = { run: jest.fn(async () => ({ code: 0, stdout: rog })) };
    await expect(collectWindowsRogFacts({ commandRunner: runner })).resolves.toMatchObject({ isRog: true });
    expect(runner.run).toHaveBeenCalledWith('powershell.exe', expect.any(Array), expect.objectContaining({ timeoutMs: 5000 }));
    runner.run.mockResolvedValueOnce({ code: 1, stderr: 'denied' });
    await expect(collectWindowsRogFacts({ commandRunner: runner })).resolves.toMatchObject({ state: 'unavailable', reason: 'denied' });
    runner.run.mockRejectedValueOnce(new Error('missing powershell'));
    await expect(collectWindowsRogFacts({ commandRunner: runner })).resolves.toMatchObject({ state: 'unavailable', reason: 'missing powershell' });
    await expect(collectWindowsRogFacts()).resolves.toMatchObject({ state: 'unavailable', reason: 'command runner unavailable' });
    expect(windowsRogCommand()).toMatchObject({ file: 'powershell.exe', args: expect.any(Array), options: { maxOutputBytes: 8192 } });
  });
});
