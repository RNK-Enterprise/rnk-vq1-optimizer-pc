/**
 * Native browser bridge tests.
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 */

import { EventEmitter } from 'events';
import { pathToFileURL } from 'url';
import { encodeBrowserMessage, handleBrowserMessage, MAX_BROWSER_MESSAGE_BYTES, runBrowserBridge } from '../native/browser-bridge.js';
import { isBrowserBridgeEntrypoint, runBrowserBridgeEntrypoint, runBrowserBridgeProcess, runIfBrowserBridgeEntrypoint, setBrowserBridgeExitCode, writeBrowserBridgeError } from '../native/browser-bridge.mjs';

function frame(message) { return encodeBrowserMessage(message); }

describe('native browser bridge', () => {
  test('handles bounded preflight messages from volume facts', async () => {
    const factsProvider = jest.fn(async () => ({ volumes: { volumes: [{ mount: 'C:', freeBytes: 100, writable: true }, { mount: 'E:', freeBytes: 1000, writable: true }] } }));
    await expect(handleBrowserMessage({ type: 'download-preflight', requestId: 'one', sizeBytes: 200, destinationMount: 'C:' }, { factsProvider })).resolves.toMatchObject({ version: 1, state: 'redirect', preflight: { targetMount: 'E:' } });
    await expect(handleBrowserMessage({ type: 'download-preflight', sizeBytes: 0, destinationMount: 'C:' }, { factsProvider })).resolves.toMatchObject({ state: 'allow' });
    await expect(handleBrowserMessage({ type: 'download-preflight', sizeBytes: null }, { factsProvider })).resolves.toMatchObject({ state: 'observation-required' });
    await expect(handleBrowserMessage({ type: 'download-preflight', sizeBytes: null })).resolves.toMatchObject({ state: 'observation-required' });
    await expect(handleBrowserMessage({ type: 'download-preflight', sizeBytes: 1 }, { factsProvider: async () => ({}) })).resolves.toMatchObject({ state: 'insufficient-space' });
    await expect(handleBrowserMessage({ type: 'other' }, { factsProvider })).rejects.toThrow('unsupported');
    await expect(handleBrowserMessage(null, { factsProvider })).rejects.toThrow('object');
    expect(factsProvider).toHaveBeenCalledTimes(2);
  });

  test('encodes native messages and rejects oversized payloads', () => {
    const encoded = encodeBrowserMessage({ ok: true });
    expect(encoded.readUInt32LE(0)).toBe(encoded.length - 4);
    expect(() => encodeBrowserMessage({ ok: true }, { maxBytes: 1 })).toThrow('too large');
    expect(() => encodeBrowserMessage(null)).toThrow('object');
  });

  test('runs framed requests and returns framed errors', async () => {
    const input = new EventEmitter();
    const output = { write: jest.fn() };
    const factsProvider = jest.fn(async () => ({ volumes: { volumes: [{ mount: 'C:', freeBytes: 1000, writable: true }] } }));
    const running = runBrowserBridge({ input, output, factsProvider });
    const request = frame({ type: 'download-preflight', requestId: 'two', sizeBytes: 200 });
    input.emit('data', request.subarray(0, 2));
    await new Promise((resolve) => setImmediate(resolve));
    expect(output.write).not.toHaveBeenCalled();
    input.emit('data', request.subarray(2, 4));
    await new Promise((resolve) => setImmediate(resolve));
    expect(output.write).not.toHaveBeenCalled();
    input.emit('data', request.subarray(4));
    await new Promise((resolve) => setImmediate(resolve));
    expect(output.write).toHaveBeenCalledWith(expect.any(Buffer));
    input.emit('data', frame({ type: 'other' }));
    await new Promise((resolve) => setImmediate(resolve));
    expect(output.write).toHaveBeenCalledTimes(2);
    input.emit('end');
    await expect(running).resolves.toEqual({ state: 'stopped' });
    const badInput = new EventEmitter();
    const badOutput = { write: jest.fn() };
    const badRun = runBrowserBridge({ input: badInput, output: badOutput, maxMessageBytes: 64 });
    badInput.emit('data', Buffer.from([65, 0, 0, 0]));
    await new Promise((resolve) => setImmediate(resolve));
    expect(badOutput.write).toHaveBeenCalledWith(expect.any(Buffer));
    badInput.emit('end');
    await expect(badRun).resolves.toEqual({ state: 'stopped' });
    expect(MAX_BROWSER_MESSAGE_BYTES).toBe(64 * 1024);
  });

  test('rejects invalid bridge endpoints', async () => {
    await expect(runBrowserBridge({ input: null, output: { write: jest.fn() } })).rejects.toThrow('input');
    await expect(runBrowserBridge()).rejects.toThrow('input');
    const input = new EventEmitter();
    await expect(runBrowserBridge({ input, output: null })).rejects.toThrow('output');
    const output = { write: jest.fn() };
    const running = runBrowserBridge({ input, output });
    input.emit('error', new Error('read failed'));
    await expect(running).rejects.toThrow('read failed');
  });

  test('exposes a safe native-host entrypoint boundary', async () => {
    expect(isBrowserBridgeEntrypoint(pathToFileURL('/host.mjs').href, '/host.mjs')).toBe(true);
    expect(isBrowserBridgeEntrypoint(pathToFileURL('/host.mjs').href, '/other.mjs')).toBe(false);
    expect(isBrowserBridgeEntrypoint('file:///host.mjs')).toBe(false);
    await expect(runIfBrowserBridgeEntrypoint()).resolves.toEqual({ state: 'skipped' });
    await expect(runIfBrowserBridgeEntrypoint({ entrypoint: false })).resolves.toEqual({ state: 'skipped' });
    await expect(runBrowserBridgeEntrypoint()).resolves.toEqual({ state: 'skipped' });
    const run = jest.fn(async (options) => ({ state: options.value }));
    await expect(runIfBrowserBridgeEntrypoint({ entrypoint: true, run, runOptions: { value: 'started' } })).resolves.toEqual({ state: 'started' });
    expect(run).toHaveBeenCalledWith({ value: 'started' });
    await expect(runBrowserBridgeEntrypoint({ entrypoint: false })).resolves.toEqual({ state: 'skipped' });
    const write = jest.fn();
    await expect(runBrowserBridgeEntrypoint({ entrypoint: true, run: async () => { throw new Error('bridge failed'); }, write })).resolves.toEqual({ state: 'error', reason: 'bridge failed' });
    expect(write).toHaveBeenCalledWith('bridge failed\n');
    const target = { exitCode: 0 };
    expect(setBrowserBridgeExitCode({ state: 'error' }, target)).toMatchObject({ state: 'error' });
    expect(target.exitCode).toBe(1);
    expect(setBrowserBridgeExitCode({ state: 'skipped' }, target)).toMatchObject({ state: 'skipped' });
    const input = new EventEmitter();
    const output = { write: jest.fn() };
    const processRun = runBrowserBridgeProcess({ input, output });
    input.emit('end');
    await expect(processRun).resolves.toEqual({ state: 'stopped' });
    await expect(runBrowserBridgeProcess()).rejects.toThrow('input');
    const errorWrite = { write: jest.fn() };
    expect(writeBrowserBridgeError('bridge\n', errorWrite)).toBeUndefined();
    expect(errorWrite.write).toHaveBeenCalledWith('bridge\n');
  });
});
