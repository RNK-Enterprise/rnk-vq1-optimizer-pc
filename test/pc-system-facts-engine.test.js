import {
  SYSTEM_ENVIRONMENTS,
  SYSTEM_FACTS_ENGINE_ID,
  SYSTEM_FACTS_ENGINE_VERSION,
  SYSTEM_FACTS_PROTOCOL_VERSION,
  SYSTEM_FACTS_TRIGGERS,
  normalizeSystemFacts,
  runSystemFactsEngine
} from '../pc/engines/system-facts/engine.js';

describe('system-facts engine', () => {
  test('publishes immutable identifiers and trigger contracts', () => {
    expect(SYSTEM_FACTS_ENGINE_ID).toBe('system-facts');
    expect(SYSTEM_FACTS_ENGINE_VERSION).toBe(1);
    expect(SYSTEM_FACTS_PROTOCOL_VERSION).toBe(1);
    expect(SYSTEM_ENVIRONMENTS).toEqual(['interactive', 'headless', 'unknown']);
    expect(SYSTEM_FACTS_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(SYSTEM_ENVIRONMENTS)).toBe(true);
    expect(Object.isFrozen(SYSTEM_FACTS_TRIGGERS)).toBe(true);
  });

  test('normalizes missing and malformed input conservatively', () => {
    expect(normalizeSystemFacts().environment).toBe('unknown');
    const facts = normalizeSystemFacts(null);
    expect(facts.environment).toBe('unknown');
    expect(facts.hostname).toBeNull();
    expect(facts.os.family).toBe('unknown');
    expect(facts.cpu.sockets).toBe(1);
    expect(facts.cpu.logicalCpus).toBeNull();
    expect(facts.memory.totalBytes).toBeNull();
    expect(facts.memory.availableBytes).toBeNull();
    expect(facts.memory.usedPercent).toBeNull();
    expect(facts.memory.swapUsedPercent).toBeNull();
    expect(facts.gpus).toEqual([]);
    expect(facts.storage).toEqual([]);
    expect(facts.network).toEqual([]);
    expect(facts.storagePressure).toEqual({
      level: 'unknown',
      totalBytes: null,
      freeBytes: null,
      freePercent: null,
      targetFreeBytes: null,
      belowTargetFreeFloor: false,
      reclaimableBytesNeeded: null,
      policyVersion: null
    });
    expect(facts.pressure).toEqual({
      cpu: 'unknown',
      memory: 'unknown',
      swap: 'unknown',
      storage: 'unknown'
    });
    expect(facts.capabilities).toEqual({
      gpuObservation: false,
      displayObservation: false,
      batteryObservation: false,
      thermalObservation: false,
      powerProfileControl: false,
      processPriorityControl: false,
      ioPriorityControl: false,
      cacheCleanup: false,
      networkObservation: true,
      organizationPreview: false
    });
  });

  test('normalizes a complete interactive workstation snapshot', () => {
    const facts = normalizeSystemFacts({
      environment: 'interactive',
      observedAt: '  2026-10-05T12:00:00Z  ',
      hostname: ' phoenix ',
      os: { family: ' linux ', version: ' 7.0 ', kernel: ' 7.0.0 ' },
      displayPresent: true,
      cpu: {
        model: ' AMD Ryzen ',
        architecture: ' x64 ',
        sockets: 1,
        physicalCpus: 8,
        logicalCpus: 16,
        utilizationPercent: 120,
        governor: ' performance ',
        driver: ' amd-pstate-epp '
      },
      memory: {
        totalBytes: 1000,
        availableBytes: 2000,
        swapTotalBytes: 1000,
        swapFreeBytes: 2500
      },
      gpus: [null, {
        vendor: ' NVIDIA ',
        model: ' GTX ',
        driver: ' 610 ',
        vramBytes: 4000,
        utilizationPercent: -10,
        temperatureCelsius: 80
      }],
      storage: [null, {
        mount: ' / ',
        device: ' /dev/nvme0n1 ',
        type: ' nvme ',
        totalBytes: 1000,
        freeBytes: 100,
        readOnly: false
      }],
      storagePressure: {
        level: 'critical',
        totalBytes: 1000,
        freeBytes: 20,
        freePercent: 2,
        targetFreeBytes: 100,
        belowTargetFreeFloor: true,
        reclaimableBytesNeeded: 80,
        policyVersion: 1
      },
      network: [null, {
        name: ' tailscale0 ',
        kind: ' mesh ',
        state: ' up ',
        mesh: true,
        defaultRoute: false
      }, {
        name: ' wlo1 ',
        kind: ' wifi ',
        state: ' up ',
        mesh: false,
        defaultRoute: true
      }],
      capabilities: {
        gpuObservation: true,
        displayObservation: true,
        batteryObservation: true,
        thermalObservation: true,
        powerProfileControl: true,
        processPriorityControl: true,
        ioPriorityControl: true,
        cacheCleanup: true,
        networkObservation: false,
        organizationPreview: true
      }
    });

    expect(facts.environment).toBe('interactive');
    expect(facts.hostname).toBe('phoenix');
    expect(facts.cpu.utilizationPercent).toBe(100);
    expect(facts.memory.availableBytes).toBe(1000);
    expect(facts.memory.usedBytes).toBe(0);
    expect(facts.memory.swapFreeBytes).toBe(1000);
    expect(facts.gpus).toHaveLength(1);
    expect(facts.gpus[0].utilizationPercent).toBe(0);
    expect(facts.storage[0].freeBytes).toBe(100);
    expect(facts.storage[0].usedPercent).toBe(90);
    expect(facts.storagePressure).toMatchObject({ level: 'critical', freeBytes: 20, belowTargetFreeFloor: true, policyVersion: 1 });
    expect(facts.network).toHaveLength(2);
    expect(facts.capabilities).toEqual({
      gpuObservation: true,
      displayObservation: true,
      batteryObservation: true,
      thermalObservation: true,
      powerProfileControl: true,
      processPriorityControl: true,
      ioPriorityControl: true,
      cacheCleanup: true,
      networkObservation: false,
      organizationPreview: true
    });
  });

  test('infers environment from headless and display declarations', () => {
    expect(normalizeSystemFacts({ headless: true }).environment).toBe('headless');
    expect(normalizeSystemFacts({ headless: false }).environment).toBe('interactive');
    expect(normalizeSystemFacts({ displayPresent: true }).environment).toBe('interactive');
    expect(normalizeSystemFacts({ displayPresent: false }).environment).toBe('headless');
    expect(normalizeSystemFacts({ environment: 'invalid', displayPresent: false }).environment)
      .toBe('headless');
    expect(normalizeSystemFacts({ environment: 'headless', displayPresent: true }).environment)
      .toBe('headless');
  });

  test('bounds malformed storage pressure evidence', () => {
    expect(normalizeSystemFacts({ storagePressure: {
      level: 'not-a-level', totalBytes: -1, freeBytes: 'bad', freePercent: 120,
      targetFreeBytes: -1, belowTargetFreeFloor: 'yes', reclaimableBytesNeeded: -1, policyVersion: 0
    } }).storagePressure).toEqual({
      level: 'unknown', totalBytes: null, freeBytes: null, freePercent: 100,
      targetFreeBytes: null, belowTargetFreeFloor: false, reclaimableBytesNeeded: null, policyVersion: null
    });
  });

  test('derives capability defaults from hardware and storage', () => {
    const gpuFacts = normalizeSystemFacts({
      environment: 'headless',
      gpus: [{ model: 'GTX 1650' }],
      storage: [{ totalBytes: 100, freeBytes: 50, readOnly: false }]
    });
    expect(gpuFacts.capabilities.gpuObservation).toBe(true);
    expect(gpuFacts.capabilities.displayObservation).toBe(false);
    expect(gpuFacts.capabilities.cacheCleanup).toBe(false);

    const readOnlyFacts = normalizeSystemFacts({
      capabilities: { cacheCleanup: true },
      storage: [{ totalBytes: 100, freeBytes: 50, readOnly: true }]
    });
    expect(readOnlyFacts.capabilities.cacheCleanup).toBe(false);
    expect(readOnlyFacts.capabilities.networkObservation).toBe(true);

    const unknownStorage = normalizeSystemFacts({ storage: [{ freeBytes: 20 }] });
    expect(unknownStorage.storage[0].usedBytes).toBeNull();
    expect(unknownStorage.storage[0].freeBytes).toBe(20);
  });

  test('classifies normal, elevated, and high pressure', () => {
    const normal = normalizeSystemFacts({
      cpu: { utilizationPercent: 10 },
      memory: { totalBytes: 100, availableBytes: 50, swapTotalBytes: 100, swapFreeBytes: 90 },
      storage: [{ totalBytes: 100, freeBytes: 50 }]
    });
    expect(normal.pressure).toEqual({ cpu: 'normal', memory: 'normal', swap: 'normal', storage: 'normal' });

    const elevated = normalizeSystemFacts({
      cpu: { utilizationPercent: 65 },
      memory: { totalBytes: 100, availableBytes: 25, swapTotalBytes: 100, swapFreeBytes: 60 },
      storage: [{ totalBytes: 100, freeBytes: 20 }]
    });
    expect(elevated.pressure).toEqual({
      cpu: 'elevated', memory: 'elevated', swap: 'elevated', storage: 'elevated'
    });

    const high = normalizeSystemFacts({
      cpu: { utilizationPercent: 85 },
      memory: { totalBytes: 100, availableBytes: 10, swapTotalBytes: 100, swapFreeBytes: 25 },
      storage: [{ totalBytes: 100, freeBytes: 10 }]
    });
    expect(high.pressure).toEqual({ cpu: 'high', memory: 'high', swap: 'high', storage: 'high' });
  });

  test('returns a data-only result for every supported trigger', () => {
    for (const trigger of SYSTEM_FACTS_TRIGGERS) {
      const result = runSystemFactsEngine({
        environment: 'headless',
        hostname: 'ex-1',
        network: [{ name: 'tailscale0', mesh: true }]
      }, { trigger, now: () => 0 });
      expect(result.protocolVersion).toBe(1);
      expect(result.engine).toBe('system-facts');
      expect(result.trigger).toBe(trigger);
      expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
      expect(result.observations.meshInterfaces).toEqual(['tailscale0']);
      expect(result.actions).toEqual([]);
      expect(result.limitations).toContain('gpu-unavailable');
      expect(result.limitations).toContain('cache-cleanup-not-authorized');
    }
  });

  test('reports no limitations for a fully capable host', () => {
    const result = runSystemFactsEngine({
      environment: 'interactive',
      displayPresent: true,
      gpus: [{ model: 'Radeon' }],
      storage: [{ totalBytes: 100, freeBytes: 50, readOnly: false }],
      capabilities: {
        thermalObservation: true,
        powerProfileControl: true,
        cacheCleanup: true
      }
    }, { trigger: 'install.preflight' });
    expect(result.limitations).toEqual([]);
  });

  test('rejects unsupported triggers and invalid clocks', () => {
    expect(() => runSystemFactsEngine({}, { trigger: 'timer' }))
      .toThrow('Unsupported system-facts trigger: timer');
    expect(() => runSystemFactsEngine({}, {}))
      .toThrow('Unsupported system-facts trigger: unknown');
    expect(() => runSystemFactsEngine())
      .toThrow('Unsupported system-facts trigger: unknown');
    expect(() => runSystemFactsEngine({}, { trigger: 'health.interval', now: () => NaN }))
      .toThrow('System-facts clock must return a number');
  });

  test('uses default input, option clock, and reports unknown environment', () => {
    const result = runSystemFactsEngine(undefined, {
      trigger: 'health.interval',
      now: () => 0
    });
    expect(result.facts.environment).toBe('unknown');
    expect(result.limitations).toContain('environment-selection-required');

    const defaultClock = runSystemFactsEngine({}, { trigger: 'health.interval' });
    expect(defaultClock.generatedAt).toEqual(expect.any(String));
  });
});
