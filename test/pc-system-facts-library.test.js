import {
  SYSTEM_FACTS_LIBRARY_ID,
  SYSTEM_FACTS_LIBRARY_VERSION,
  buildFactEnvelope,
  compareFactSnapshots,
  createSystemFactsLibrary,
  fingerprintFacts,
  recommendSamplingInterval
} from '../pc/engines/system-facts/library.js';

function facts(overrides = {}) {
  return {
    protocolVersion: 1,
    engine: 'system-facts',
    environment: 'headless',
    os: { family: 'linux', version: '24.04' },
    cpu: { architecture: 'x64', physicalCpus: 4, logicalCpus: 8, sockets: 1 },
    memory: { totalBytes: 1000 },
    pressure: { cpu: 'normal', memory: 'normal', swap: 'normal', storage: 'normal' },
    gpus: [{ vendor: 'NVIDIA', model: 'GTX 1650', vramBytes: 4000 }],
    storage: [{ mount: '/', type: 'nvme', readOnly: false }],
    network: [{ name: 'tailscale0', kind: 'mesh', mesh: true }],
    ...overrides
  };
}

describe('system-facts library', () => {
  test('builds deterministic fingerprints and handles sparse component fields', () => {
    const first = fingerprintFacts(facts({
      gpus: [{ vendor: 'A', model: 'B', vramBytes: 10 }, {}],
      storage: [{}, { mount: '/data', type: 'hdd', readOnly: true }],
      network: [{}, { name: 'eth0', kind: 'ethernet', mesh: false }]
    }));
    const second = fingerprintFacts(facts({
      gpus: [{}, { vendor: 'A', model: 'B', vramBytes: 10 }],
      storage: [{ mount: '/data', type: 'hdd', readOnly: true }, {}],
      network: [{ name: 'eth0', kind: 'ethernet', mesh: false }, {}]
    }));
    expect(first).toBe(second);
    expect(first).toContain('headless');
    expect(first).toContain('A:B:10');
  });

  test('rejects malformed fact snapshots', () => {
    const invalid = [
      null,
      [],
      {},
      { protocolVersion: 2 },
      { protocolVersion: 1, engine: 'other' },
      { protocolVersion: 1, engine: 'system-facts', environment: 'bad' },
      { protocolVersion: 1, engine: 'system-facts', environment: 'unknown' },
      { ...facts(), cpu: null },
      { ...facts(), memory: null },
      { ...facts(), pressure: null },
      { ...facts(), gpus: null },
      { ...facts(), storage: null },
      { ...facts(), network: null }
    ];
    for (const value of invalid) {
      expect(() => fingerprintFacts(value)).toThrow('Normalized system facts are required');
      expect(() => recommendSamplingInterval(value)).toThrow('Normalized system facts are required');
    }
  });

  test('compares every snapshot dimension', () => {
    const baseline = facts();
    expect(compareFactSnapshots(baseline, baseline)).toEqual({
      changed: false,
      environmentChanged: false,
      cpuChanged: false,
      memoryChanged: false,
      gpuChanged: false,
      storageChanged: false,
      networkChanged: false,
      pressureChanged: false
    });

    const current = facts({
      environment: 'interactive',
      cpu: { architecture: 'arm64', physicalCpus: 8, logicalCpus: 8, sockets: 2 },
      memory: { totalBytes: 2000 },
      pressure: { cpu: 'high', memory: 'elevated', swap: 'high', storage: 'elevated' },
      gpus: [{ vendor: 'AMD', model: 'Radeon', vramBytes: 2000 }],
      storage: [{ mount: '/', type: 'hdd', readOnly: true }],
      network: [{ name: 'eth0', kind: 'ethernet', mesh: false }]
    });
    expect(compareFactSnapshots(baseline, current)).toEqual({
      changed: true,
      environmentChanged: true,
      cpuChanged: true,
      memoryChanged: true,
      gpuChanged: true,
      storageChanged: true,
      networkChanged: true,
      pressureChanged: true
    });
  });

  test('chooses adaptive intervals for pressure and environment', () => {
    expect(recommendSamplingInterval(facts({ pressure: {
      cpu: 'high', memory: 'normal', swap: 'normal', storage: 'normal'
    } }))).toBe(500);
    expect(recommendSamplingInterval(facts({ pressure: {
      cpu: 'normal', memory: 'elevated', swap: 'normal', storage: 'normal'
    } }))).toBe(1000);
    expect(recommendSamplingInterval(facts({ environment: 'interactive' }))).toBe(1000);
    expect(recommendSamplingInterval(facts({ environment: 'headless' }))).toBe(5000);
    expect(recommendSamplingInterval(facts({ environment: 'unknown' }))).toBe(2000);
    expect(recommendSamplingInterval(facts({ pressure: {
      cpu: 'not-a-pressure', memory: 'normal', swap: 'normal', storage: 'normal'
    } }))).toBe(5000);
  });

  test('builds bounded envelopes with sequence and trigger validation', () => {
    const envelope = buildFactEnvelope(facts(), {
      trigger: 'system.facts.request',
      sequence: 3,
      now: () => 0
    });
    expect(envelope).toEqual({
      library: SYSTEM_FACTS_LIBRARY_ID,
      libraryVersion: SYSTEM_FACTS_LIBRARY_VERSION,
      trigger: 'system.facts.request',
      sequence: 3,
      generatedAt: '1970-01-01T00:00:00.000Z',
      fingerprint: fingerprintFacts(facts()),
      samplingIntervalMs: 5000
    });
    expect(Object.isFrozen(envelope)).toBe(true);
    expect(() => buildFactEnvelope(facts(), { trigger: '' }))
      .toThrow('System-facts envelope trigger is required');
    expect(() => buildFactEnvelope(facts(), { trigger: 'x', sequence: 0 }))
      .toThrow('System-facts envelope sequence must be positive');
    expect(() => buildFactEnvelope(facts(), { trigger: 'x', sequence: 1, now: () => NaN }))
      .toThrow('System-facts envelope clock must return a number');
    expect(() => buildFactEnvelope(facts()))
      .toThrow('System-facts envelope trigger is required');
  });

  test('creates an independent library facade with its own clock', () => {
    const library = createSystemFactsLibrary({ now: () => 1000 });
    expect(library.id).toBe(SYSTEM_FACTS_LIBRARY_ID);
    expect(library.version).toBe(SYSTEM_FACTS_LIBRARY_VERSION);
    expect(library.fingerprint(facts())).toBe(fingerprintFacts(facts()));
    expect(library.compare(facts(), facts())).toEqual(compareFactSnapshots(facts(), facts()));
    expect(library.samplingInterval(facts())).toBe(5000);
    expect(library.envelope(facts(), { trigger: 'health.interval' }).generatedAt)
      .toBe('1970-01-01T00:00:01.000Z');
    expect(() => library.envelope(facts()))
      .toThrow('System-facts envelope trigger is required');
    expect(Object.isFrozen(library)).toBe(true);
    expect(() => createSystemFactsLibrary(null))
      .toThrow('System-facts library options must be an object');
    expect(createSystemFactsLibrary().envelope(facts(), { trigger: 'health.interval' }))
      .toEqual(expect.objectContaining({ trigger: 'health.interval' }));
  });
});
