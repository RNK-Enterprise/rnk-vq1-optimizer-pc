/**
 * Native workstation steward daemon tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { createStewardDaemon, STEWARD_DAEMON_VERSION } from '../native/steward-daemon.js';

function harness() {
  const entries = [];
  const timers = [];
  const reports = [];
  const store = {
    append: async (entry) => { entries.push(entry); return entry; },
    read: async () => entries
  };
  const adapter = { collectFacts: async () => ({ platform: 'linux', storage: [{ mount: '/', freeBytes: 100, totalBytes: 200 }], memory: { totalBytes: 200, availableBytes: 100 } }) };
  return { entries, timers, reports, store, adapter, now: () => Date.parse('2026-01-01T12:00:00.000Z') };
}

describe('native steward daemon', () => {
  test('coordinates observation and daily-report loops with explicit lifecycle', async () => {
    const h = harness();
    const daemon = createStewardDaemon({
      adapter: h.adapter,
      store: h.store,
      observationIntervalMs: 1000,
      reportIntervalMs: 2000,
      now: h.now,
      deliver: async (report) => h.reports.push(report),
      setIntervalImpl: (callback, delay) => { h.timers.push({ callback, delay }); return h.timers.length; },
      clearIntervalImpl: (timer) => h.timers.push({ timer })
    });
    expect(daemon).toMatchObject({ version: STEWARD_DAEMON_VERSION, observationIntervalMs: 1000, reportIntervalMs: 2000 });
    expect(daemon.isRunning()).toBe(false);
    expect(daemon.stop()).toMatchObject({ stopped: false });
    const collected = await daemon.collect();
    expect(collected).toMatchObject({ observation: { report: { engine: 'workstation-steward' }, entry: { event: 'report' } }, dailyReport: { delivered: true } });
    expect(h.entries).toHaveLength(1);
    expect(h.reports).toHaveLength(1);
    await expect(daemon.collect({ forceReport: true })).resolves.toMatchObject({ dailyReport: { delivered: true } });
    expect(daemon.start()).toMatchObject({ started: true, observationIntervalMs: 1000, reportIntervalMs: 2000 });
    expect(daemon.start()).toMatchObject({ started: false });
    expect(h.timers).toEqual(expect.arrayContaining([expect.objectContaining({ delay: 1000 }), expect.objectContaining({ delay: 2000 })]));
    h.timers[0].callback();
    h.timers[1].callback();
    await new Promise((resolve) => setImmediate(resolve));
    expect(daemon.stop()).toEqual({ stopped: true });
    expect(daemon.stop()).toMatchObject({ stopped: false });
    expect(daemon.isRunning()).toBe(false);
    const defaults = createStewardDaemon({ adapter: h.adapter, store: h.store, now: h.now });
    await defaults.collect();
    const failing = createStewardDaemon({
      adapter: { collectFacts: async () => { throw new Error('ignored'); } },
      store: h.store,
      now: h.now,
      setIntervalImpl: (callback) => { callback(); return 'timer'; },
      clearIntervalImpl: () => {}
    });
    failing.start();
    await new Promise((resolve) => setImmediate(resolve));
    failing.stop();
  });

  test('fails closed on missing dependencies and invalid bounds', () => {
    const h = harness();
    expect(() => createStewardDaemon()).toThrow('facts adapter');
    expect(() => createStewardDaemon({ adapter: h.adapter })).toThrow('history store');
    expect(() => createStewardDaemon({ adapter: h.adapter, store: { append: jest.fn() } })).toThrow('append/read');
    expect(() => createStewardDaemon({ adapter: h.adapter, store: h.store, now: 1 })).toThrow('clock');
    expect(() => createStewardDaemon({ adapter: h.adapter, store: h.store, onObservation: null })).toThrow('observation callback');
    expect(() => createStewardDaemon({ adapter: h.adapter, store: h.store, deliver: null })).toThrow('report callback');
    expect(() => createStewardDaemon({ adapter: h.adapter, store: h.store, onError: null })).toThrow('error callback');
    expect(() => createStewardDaemon({ adapter: h.adapter, store: h.store, setIntervalImpl: null })).toThrow('setInterval');
    expect(() => createStewardDaemon({ adapter: h.adapter, store: h.store, clearIntervalImpl: null })).toThrow('clearInterval');
    expect(() => createStewardDaemon({ adapter: h.adapter, store: h.store, observationIntervalMs: 999 })).toThrow('observation');
    expect(() => createStewardDaemon({ adapter: h.adapter, store: h.store, reportIntervalMs: 86400001 })).toThrow('report');
    expect(() => createStewardDaemon({ adapter: { collectFacts: null }, store: h.store })).toThrow('facts adapter');
  });
});
