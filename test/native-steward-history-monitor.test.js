import fs from 'fs/promises';
import os from 'os';
import path from 'path';
import { createStewardHistoryStore } from '../native/steward-history.js';
import { createStewardMonitor } from '../native/steward-monitor.js';

describe('native workstation steward history', () => {
  let root;
  beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), 'rnk-steward-')); });
  afterEach(async () => { await fs.rm(root, { recursive: true, force: true }); });

  test('appends bounded entries, reads latest, and creates rollback/quarantine previews', async () => {
    const store = createStewardHistoryStore({ filePath: path.join(root, 'nested', 'history.jsonl'), maxEntries: 2 });
    expect(await store.read()).toEqual([]);
    expect(await store.latest()).toBeNull();
    const first = await store.append({ id: 'a', event: 'apply', timestamp: 1, reversible: true, undo: { operation: 'restore' }, path: path.join(root, 'file.bin') });
    expect(first.version).toBe(1);
    expect((await store.latest()).id).toBe('a');
    expect(store.rollbackPlan(first)).toMatchObject({ state: 'preview', requiresApproval: true, action: { id: 'a' } });
    expect(store.rollbackPlan({ ...first, reversible: false })).toMatchObject({ state: 'refused' });
    expect(store.rollbackPlan({ ...first, undo: null })).toMatchObject({ state: 'refused' });
    expect(store.quarantinePlan(first, [path.join(root, 'protected'), 2])).toMatchObject({ state: 'preview', action: { type: 'quarantine' } });
    expect(store.quarantinePlan({ ...first, path: path.join(root, 'protected', 'secret') }, [path.join(root, 'protected')])).toMatchObject({ state: 'refused', reason: 'source path is protected' });
    expect(store.quarantinePlan({ ...first, path: '' })).toMatchObject({ state: 'refused', reason: 'history entry has no source path' });
    await store.append({ id: 'b', event: 'report', timestamp: 2 });
    await expect(store.append({ id: 'c', event: 'report', timestamp: 3 })).rejects.toThrow('full');
    await expect(store.append({ id: '', event: 'report', timestamp: 3 })).rejects.toThrow('short id');
    await expect(store.append({ id: 'x'.repeat(129), event: 'report', timestamp: 3 })).rejects.toThrow('short id');
    await expect(store.append(null)).rejects.toThrow('must be an object');
    await expect(store.append({ id: 'bad', event: 'nope', timestamp: 3 })).rejects.toThrow('unsupported event');
    await expect(store.append({ id: 'bad', event: 'report', timestamp: NaN })).rejects.toThrow('timestamp');
    expect(() => createStewardHistoryStore({ filePath: '' })).toThrow('filePath');
    expect(() => createStewardHistoryStore({ filePath: 1 })).toThrow('filePath');
    expect(() => createStewardHistoryStore()).toThrow('filePath');
    expect(() => createStewardHistoryStore({ filePath: path.join(root, 'x'), maxEntries: 0 })).toThrow('out of range');
  });

  test('fails closed on malformed and oversized history files', async () => {
    const filePath = path.join(root, 'history.jsonl');
    await fs.writeFile(filePath, '{bad}\n');
    const store = createStewardHistoryStore({ filePath });
    await expect(store.read()).rejects.toThrow('invalid JSON');
    await fs.writeFile(filePath, `${JSON.stringify({ id: 'a', event: 'report', timestamp: 1 })}\n${JSON.stringify({ id: 'b', event: 'report', timestamp: 2 })}\n`);
    const limited = createStewardHistoryStore({ filePath, maxEntries: 1 });
    await expect(limited.read()).rejects.toThrow('exceeds');
    const huge = createStewardHistoryStore({ filePath: path.join(root, 'huge') });
    await expect(huge.append({ id: 'huge', event: 'report', timestamp: 1, payload: 'x'.repeat(128 * 1024) })).rejects.toThrow('too large');
    const failing = createStewardHistoryStore({ filePath, fsImpl: { readFile: async () => { throw { code: 'EACCES' }; } } });
    await expect(failing.read()).rejects.toMatchObject({ code: 'EACCES' });
  });
});

describe('native workstation steward monitor', () => {
  test('collects, persists, delivers, and controls a cross-platform observation loop', async () => {
    let nextId = 0;
    const entries = [];
    const timerCalls = [];
    const reports = [];
    const errors = [];
    const monitor = createStewardMonitor({ adapter: { collectFacts: async () => ({ platform: 'linux', storage: [{ mount: '/', freeBytes: 10, totalBytes: 20 }] }) }, store: { append: async (entry) => { entries.push(entry); return { ...entry, id: `${entry.id}-${++nextId}` }; } }, intervalMs: 1000, now: () => 10, onReport: async (report) => reports.push(report), onError: (error) => errors.push(error), setIntervalImpl: (callback, delay) => { timerCalls.push({ callback, delay }); return 'timer'; }, clearIntervalImpl: (timer) => timerCalls.push({ timer }) });
    expect(monitor.isRunning()).toBe(false);
    expect(monitor.stop()).toMatchObject({ stopped: false });
    expect(monitor.start()).toMatchObject({ started: true, intervalMs: 1000 });
    expect(monitor.start()).toMatchObject({ started: false });
    const collected = await monitor.collect();
    expect(collected.report).toMatchObject({ engine: 'workstation-steward', platform: 'linux' });
    expect(entries[0]).toMatchObject({ event: 'report', platform: 'linux' });
    expect(reports).toHaveLength(1);
    timerCalls[0].callback();
    await new Promise((resolve) => setImmediate(resolve));
    expect(entries).toHaveLength(2);
    expect(monitor.stop()).toEqual({ stopped: true });
    expect(monitor.stop()).toMatchObject({ stopped: false });
    expect(errors).toEqual([]);
  });

  test('validates monitor dependencies and reports interval failures', async () => {
    const adapter = { collectFacts: async () => ({ engine: 'system-facts' }) };
    const store = { append: async () => ({}) };
    expect(() => createStewardMonitor()).toThrow('facts adapter');
    expect(() => createStewardMonitor({ adapter })).toThrow('history store');
    expect(() => createStewardMonitor({ adapter, store, intervalMs: 999 })).toThrow('interval');
    expect(() => createStewardMonitor({ adapter, store, trigger: 'bad' })).toThrow('Unsupported');
    expect(() => createStewardMonitor({ adapter, store, now: 1 })).toThrow('clock must be a function');
    expect(() => createStewardMonitor({ adapter, store, onReport: null })).toThrow('callbacks');
    expect(() => createStewardMonitor({ adapter, store, setIntervalImpl: null })).toThrow('timer functions');
    expect(() => createStewardMonitor({ adapter, store, trigger: '' })).toThrow('unknown');
    const defaults = createStewardMonitor({ adapter, store, now: () => 1, setIntervalImpl: () => 1, clearIntervalImpl: () => {} });
    await expect(defaults.collect()).resolves.toMatchObject({ report: { engine: 'workstation-steward' } });
    const emptyFacts = createStewardMonitor({ adapter: { collectFacts: async () => null }, store, now: () => 2 });
    await expect(emptyFacts.collect()).resolves.toMatchObject({ report: { engine: 'workstation-steward' } });
    const errors = [];
    const monitor = createStewardMonitor({ adapter: { collectFacts: async () => { throw new Error('facts failed'); } }, store, now: () => 1, onError: (error) => errors.push(error), setIntervalImpl: (callback) => { callback(); return 1; }, clearIntervalImpl: () => {} });
    monitor.start();
    await new Promise((resolve) => setImmediate(resolve));
    expect(errors[0].message).toBe('facts failed');
    await expect(monitor.collect()).rejects.toThrow('facts failed');
    const invalidClock = createStewardMonitor({ adapter: { collectFacts: async () => ({ engine: 'system-facts' }) }, store, now: () => NaN });
    await expect(invalidClock.collect()).rejects.toThrow('clock must return a number');
    const defaultError = createStewardMonitor({ adapter: { collectFacts: async () => { throw new Error('ignored'); } }, store, now: () => 1, setIntervalImpl: (callback) => { callback(); return 1; }, clearIntervalImpl: () => {} });
    defaultError.start();
    await new Promise((resolve) => setImmediate(resolve));
  });
});
