import {
  DISK_IO_WAIT_BURST_LIBRARY_ID,
  DISK_IO_WAIT_BURST_LIBRARY_VERSION,
  buildDiskIoWaitBurstEnvelope,
  buildDiskIoWaitBurstPlan,
  createDiskIoWaitBurstLibrary,
  mergeDiskIoWaitBurstReports
} from '../pc/engines/disk-io/turbos/wait-burst/library.js';

function report(overrides = {}) { const sampleCount = overrides.sampleCount ?? 4; return { turbo: 'disk-io.wait-burst', state: 'stable-wait', sampleCount, minimumSamples: 2, waitThreshold: 30, persistenceThreshold: 2, diskCount: 2, maximumWaitPercent: 5, observedCount: sampleCount, incompleteCount: 0, noDiskCount: 0, pressureSampleCount: 0, confidence: 1, ...overrides }; }

describe('disk-io wait-burst library', () => {
  test('publishes identity and merges wait evidence', () => {
    const merged = mergeDiskIoWaitBurstReports([report({ sampleCount: 2, maximumWaitPercent: 35, pressureSampleCount: 1 }), report({ state: 'wait-burst-sustained', sampleCount: 6, observedCount: 5, maximumWaitPercent: 40, pressureSampleCount: 3, confidence: 0.8333 })]);
    expect(DISK_IO_WAIT_BURST_LIBRARY_ID).toBe('disk-io.wait-burst.library'); expect(DISK_IO_WAIT_BURST_LIBRARY_VERSION).toBe(1);
    expect(merged).toMatchObject({ reportCount: 2, state: 'wait-burst-sustained', sampleCount: 8, maximumWaitPercent: 40, pressureSampleCount: 4, confidence: 0.875, recommendations: ['protect-services', 'review-disk-contention'] }); expect(Object.isFrozen(merged)).toBe(true);
  });
  test('preserves aggregate states and empty confidence', () => {
    expect(mergeDiskIoWaitBurstReports([])).toMatchObject({ state: 'insufficient-data', confidence: 0 });
    expect(mergeDiskIoWaitBurstReports([report({ state: 'no-disks', sampleCount: 1, diskCount: 0, maximumWaitPercent: null, observedCount: 0, noDiskCount: 1, confidence: 0 })])).toMatchObject({ state: 'no-disks', recommendations: ['no-disk-io-review'] });
    expect(mergeDiskIoWaitBurstReports([report({ state: 'incomplete-wait-evidence', maximumWaitPercent: null, incompleteCount: 1, confidence: 0 })])).toMatchObject({ state: 'incomplete-wait-evidence', recommendations: ['request-disk-io-observation'] });
    expect(mergeDiskIoWaitBurstReports([report({ state: 'wait-burst-observed', maximumWaitPercent: 35, pressureSampleCount: 1 })]).recommendations).toEqual(['observe-next-wait-sample']); expect(mergeDiskIoWaitBurstReports([report()]).recommendations).toEqual(['no-change']);
    expect(mergeDiskIoWaitBurstReports([report({ state: 'insufficient-data', sampleCount: 1, diskCount: 0, maximumWaitPercent: null, observedCount: 0, confidence: 0 })]).state).toBe('insufficient-data'); expect(mergeDiskIoWaitBurstReports([report({ state: 'insufficient-data', sampleCount: 0, diskCount: 0, maximumWaitPercent: null, observedCount: 0, confidence: 0 })]).confidence).toBe(0);
  });
  test('applies safety precedence and builds every state plan', () => {
    expect(mergeDiskIoWaitBurstReports([report({ state: 'wait-burst-sustained' }), report({ state: 'no-disks', sampleCount: 1, diskCount: 0, maximumWaitPercent: null, observedCount: 0, noDiskCount: 1, confidence: 0 })])).toMatchObject({ state: 'no-disks' });
    const states = [['wait-burst-sustained', 'disk-contention-review', 750], ['wait-burst-observed', 'disk-contention-observation', 1000], ['stable-wait', 'stable-wait-observation', 5000], ['no-disks', 'no-disk-observation', 10000], ['incomplete-wait-evidence', 'evidence-bootstrap', 1500], ['insufficient-data', 'sample-bootstrap', 1500]];
    for (const [state, mode, intervalMs] of states) { const empty = state === 'no-disks'; const sampleCount = empty ? 1 : 4; const confidence = empty ? 0 : 1; expect(buildDiskIoWaitBurstPlan(report({ state, sampleCount, diskCount: empty ? 0 : 2, maximumWaitPercent: empty ? null : 5, observedCount: empty ? 0 : sampleCount, noDiskCount: empty ? 1 : 0, confidence }), 'interactive')).toMatchObject({ environment: 'interactive', mode, intervalMs, state, confidence }); }
    expect(buildDiskIoWaitBurstPlan(report(), 'headless')).toMatchObject({ environment: 'headless', intervalMs: 10000 }); expect(buildDiskIoWaitBurstPlan(report({ sampleCount: 0, diskCount: 0, maximumWaitPercent: null, observedCount: 0, confidence: 0 }), 'other')).toMatchObject({ environment: 'unknown', mode: 'profile-required', confidence: 0 });
  });
  test('builds immutable envelopes and factories', () => {
    const envelope = buildDiskIoWaitBurstEnvelope(report(), { trigger: 'health.interval', now: () => 0 }); expect(envelope).toMatchObject({ library: DISK_IO_WAIT_BURST_LIBRARY_ID, libraryVersion: 1, trigger: 'health.interval', generatedAt: '1970-01-01T00:00:00.000Z' }); expect(Object.isFrozen(envelope)).toBe(true);
    const library = createDiskIoWaitBurstLibrary(); expect(Object.isFrozen(library)).toBe(true); expect(library.id).toBe(DISK_IO_WAIT_BURST_LIBRARY_ID); expect(library.merge([])).toMatchObject({ state: 'insufficient-data' }); expect(library.plan(report({ sampleCount: 0, diskCount: 0, maximumWaitPercent: null, observedCount: 0, confidence: 0 }), 'headless')).toMatchObject({ confidence: 0 }); expect(library.envelope(report(), { trigger: 'x', now: () => 1000 }).generatedAt).toBe('1970-01-01T00:00:01.000Z');
  });
  test('rejects malformed reports, bounds, thresholds, triggers, and clocks', () => {
    expect(() => mergeDiskIoWaitBurstReports(null)).toThrow('reports must be an array'); expect(() => mergeDiskIoWaitBurstReports(Array.from({ length: 65 }, () => report()))).toThrow('at most 64 reports'); expect(() => mergeDiskIoWaitBurstReports([null])).toThrow('report must be an object'); expect(() => mergeDiskIoWaitBurstReports([report({ turbo: 'other' })])).toThrow('requires a wait-burst turbo report'); expect(() => mergeDiskIoWaitBurstReports([report({ state: 'other' })])).toThrow('invalid state'); expect(() => mergeDiskIoWaitBurstReports([report({ sampleCount: -1 })])).toThrow('sampleCount must be from 0 to 64'); expect(() => mergeDiskIoWaitBurstReports([report({ minimumSamples: 0 })])).toThrow('minimumSamples must be from 1 to 64'); expect(() => mergeDiskIoWaitBurstReports([report({ waitThreshold: 101 })])).toThrow('waitThreshold must be between 0 and 100'); expect(() => mergeDiskIoWaitBurstReports([report({ persistenceThreshold: 0 })])).toThrow('persistenceThreshold must be from 1 to 64');
    for (const field of ['observedCount', 'incompleteCount', 'noDiskCount', 'pressureSampleCount']) expect(() => mergeDiskIoWaitBurstReports([report({ [field]: 5 })])).toThrow('must fit inside sampleCount'); expect(() => mergeDiskIoWaitBurstReports([report({ diskCount: 4097 })])).toThrow('diskCount must be from 0 to 4096'); expect(() => mergeDiskIoWaitBurstReports([report({ maximumWaitPercent: 101 })])).toThrow('maximumWaitPercent must be null or from 0 to 100'); expect(() => mergeDiskIoWaitBurstReports([report({ confidence: 1.1 })])).toThrow('confidence must be between 0 and 1'); expect(() => buildDiskIoWaitBurstEnvelope(report())).toThrow('trigger is required'); expect(() => buildDiskIoWaitBurstEnvelope(report(), { trigger: 'x', now: () => NaN })).toThrow('clock must return a number');
  });
});
