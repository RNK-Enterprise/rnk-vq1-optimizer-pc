import {
  SYSTEM_FACTS_CAPABILITY_TRIGGERS,
  SYSTEM_FACTS_CAPABILITY_TURBO_ID,
  SYSTEM_FACTS_CAPABILITY_TURBO_VERSION,
  runCapabilityTurbo
} from '../pc/engines/system-facts/turbos/capability/turbo.js';

function snapshot(overrides = {}) {
  return {
    engine: 'system-facts',
    environment: 'headless',
    cpu: {},
    memory: { swapTotalBytes: 8 },
    gpus: [{ model: 'GTX' }],
    network: [],
    capabilities: {
      gpuObservation: true,
      displayObservation: false,
      batteryObservation: false,
      thermalObservation: true,
      powerProfileControl: true,
      processPriorityControl: true,
      ioPriorityControl: true,
      cacheCleanup: true,
      networkObservation: true
    },
    ...overrides
  };
}

describe('system-facts capability turbo', () => {
  test('publishes identity and triggers', () => {
    expect(SYSTEM_FACTS_CAPABILITY_TURBO_ID).toBe('system-facts.capability');
    expect(SYSTEM_FACTS_CAPABILITY_TURBO_VERSION).toBe(1);
    expect(SYSTEM_FACTS_CAPABILITY_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(SYSTEM_FACTS_CAPABILITY_TRIGGERS)).toBe(true);
  });

  test('reports a ready headless host with explicit capabilities', () => {
    const result = runCapabilityTurbo(snapshot(), {
      trigger: 'install.preflight',
      now: () => 0
    });
    expect(result.protocolVersion).toBe(1);
    expect(result.turbo).toBe(SYSTEM_FACTS_CAPABILITY_TURBO_ID);
    expect(result.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(result.environment).toBe('headless');
    expect(result.state).toBe('ready');
    expect(result.boundary).toBe('headless-safe-observation');
    expect(result.summary.supported).toBe(9);
    expect(result.adminRequired).toEqual([]);
    expect(result.unsupported).toEqual([]);
    expect(result.requiredFailures).toEqual([]);
    expect(result.recommendations).toEqual(['use-capability-selected-plan']);
    expect(result.capabilities).toHaveLength(12);
    expect(result.capabilities.find((item) => item.name === 'display-observation').status)
      .toBe('not-applicable');
    expect(Object.isFrozen(result)).toBe(true);
  });

  test('reports an interactive host and unsupported controls explicitly', () => {
    const result = runCapabilityTurbo(snapshot({
      environment: 'interactive',
      capabilities: {
        gpuObservation: true,
        displayObservation: true,
        batteryObservation: true,
        thermalObservation: false,
        powerProfileControl: false,
        processPriorityControl: false,
        ioPriorityControl: false,
        cacheCleanup: false,
        networkObservation: false
      }
    }), { trigger: 'system.facts.request', now: () => 0 });
    expect(result.state).toBe('partial');
    expect(result.boundary).toBe('interactive-safe-observation');
    expect(result.requiredFailures).toEqual([]);
    expect(result.recommendations).toEqual(['keep-unsupported-controls-disabled']);
    expect(result.capabilities.find((item) => item.name === 'display-observation').status)
      .toBe('supported');
    expect(result.capabilities.find((item) => item.name === 'power-profile-control').status)
      .toBe('admin-required');
    expect(result.capabilities.find((item) => item.name === 'network-observation').status)
      .toBe('unavailable');
  });

  test('blocks an interactive host missing its required display capability', () => {
    const result = runCapabilityTurbo(snapshot({
      environment: 'interactive',
      capabilities: { displayObservation: false }
    }), { trigger: 'workload.changed', now: () => 0 });
    expect(result.state).toBe('blocked');
    expect(result.boundary).toBe('manual-review-required');
    expect(result.requiredFailures).toEqual(['display-observation']);
    expect(result.recommendations).toEqual(['resolve-required-capabilities']);
  });

  test('reports unknown environment and missing hardware', () => {
    const result = runCapabilityTurbo(snapshot({
      environment: 'unknown',
      memory: { swapTotalBytes: null },
      gpus: [],
      capabilities: {
        gpuObservation: false,
        displayObservation: false,
        batteryObservation: false,
        thermalObservation: false,
        powerProfileControl: false,
        processPriorityControl: false,
        ioPriorityControl: false,
        cacheCleanup: false,
        networkObservation: true
      }
    }), { trigger: 'system.facts.request', now: () => 0 });
    expect(result.state).toBe('partial');
    expect(result.boundary).toBe('profile-selection-required');
    expect(result.adminRequired).toEqual([
      'power-profile-control',
      'process-priority-control',
      'io-priority-control',
      'cache-cleanup'
    ]);
    expect(result.recommendations).toEqual(['request-environment-profile']);
    expect(result.capabilities.find((item) => item.name === 'gpu-observation').status)
      .toBe('unavailable');
    expect(result.capabilities.find((item) => item.name === 'swap-observation').status)
      .toBe('unavailable');
    expect(result.capabilities.find((item) => item.name === 'display-observation').status)
      .toBe('unknown');
  });

  test('rejects malformed inputs, triggers, and clocks', () => {
    expect(() => runCapabilityTurbo(null, { trigger: 'system.facts.request' }))
      .toThrow('Capability turbo snapshot must be an object');
    expect(() => runCapabilityTurbo({ engine: 'other' }, { trigger: 'system.facts.request' }))
      .toThrow('requires a system-facts snapshot');
    expect(() => runCapabilityTurbo({ engine: 'system-facts' }, { trigger: 'system.facts.request' }))
      .toThrow('missing normalized sections');
    expect(() => runCapabilityTurbo(snapshot(), { trigger: 'bad' }))
      .toThrow('Unsupported capability turbo trigger: bad');
    expect(() => runCapabilityTurbo(snapshot(), {}))
      .toThrow('Unsupported capability turbo trigger: unknown');
    expect(() => runCapabilityTurbo())
      .toThrow('Unsupported capability turbo trigger: unknown');
    expect(() => runCapabilityTurbo(snapshot(), { trigger: 'system.facts.request', now: () => NaN }))
      .toThrow('Capability turbo clock must return a number');
  });
});
