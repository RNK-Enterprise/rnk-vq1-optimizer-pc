import {
  SYSTEM_FACTS_MESH_ID,
  SYSTEM_FACTS_MESH_TRIGGERS,
  SYSTEM_FACTS_MESH_VERSION,
  createSystemFactsMesh
} from '../pc/engines/system-facts/mesh.js';

function rawFacts() {
  return {
    environment: 'headless',
    hostname: 'test-host',
    cpu: {
      model: 'test-cpu',
      architecture: 'x86_64',
      physicalCpus: 4,
      logicalCpus: 8,
      utilizationPercent: 20
    },
    memory: {
      totalBytes: 100,
      availableBytes: 80,
      swapTotalBytes: 20,
      swapFreeBytes: 20
    },
    storage: [{
      mount: '/',
      type: 'ext4',
      totalBytes: 100,
      freeBytes: 80,
      readOnly: false
    }],
    gpus: [],
    network: [{ name: 'mesh0', kind: 'wireguard', mesh: true }],
    capabilities: {
      thermalObservation: true,
      powerProfileControl: true,
      processPriorityControl: true,
      ioPriorityControl: true,
      cacheCleanup: true,
      networkObservation: true
    }
  };
}

describe('system-facts standalone mesh', () => {
  test('publishes paired nodes and typed local bridges without loading modules', () => {
    const mesh = createSystemFactsMesh({ now: () => 0 });
    expect(SYSTEM_FACTS_MESH_ID).toBe('optimizer.system-facts.mesh');
    expect(SYSTEM_FACTS_MESH_VERSION).toBe(1);
    expect(SYSTEM_FACTS_MESH_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(mesh.listNodes()).toHaveLength(20);
    expect(mesh.listNodes()).toContain('optimizer.authority.engine.system-facts');
    expect(mesh.listNodes()).toContain('optimizer.dispatch.turbo.system-facts-cadence');
    expect(mesh.listBridges()).toHaveLength(18);
    expect(mesh.listBridges().filter((bridge) => bridge.type === 'command')).toHaveLength(9);
    expect(mesh.listBridges().filter((bridge) => bridge.type === 'event')).toHaveLength(9);
    expect(mesh.resolveNode('optimizer.authority.engine.system-facts').id).toBe('engine');
    expect(mesh.resolveNode('missing.node')).toBe(null);
    expect(mesh.loadedComponents()).toEqual([]);
    expect(createSystemFactsMesh().loadedComponents()).toEqual([]);
  });

  test('lazy-loads only the preflight engine, selected turbos, and libraries', async () => {
    const mesh = createSystemFactsMesh({ now: () => 0 });
    const result = await mesh.dispatch(rawFacts(), { trigger: 'install.preflight' });
    expect(result.mesh).toBe(SYSTEM_FACTS_MESH_ID);
    expect(result.trigger).toBe('install.preflight');
    expect(Object.keys(result.turbos)).toEqual(['capability', 'cadence']);
    expect(result.turbos.capability.plan.mode).toBe('headless-observation');
    expect(result.turbos.cadence.plan.mode).toBe('balanced-observation');
    expect(result.envelope.trigger).toBe('install.preflight');
    expect(mesh.loadedComponents()).toEqual([
      'engine',
      'engine-library',
      'capability-turbo',
      'capability-library',
      'cadence-turbo',
      'cadence-library'
    ]);
    expect(result.loadedNodes).toHaveLength(12);
    expect(result.actions).toEqual([]);
  });

  test('fires all four turbo paths on a facts request and reuses lazy modules', async () => {
    const mesh = createSystemFactsMesh({ now: () => 0 });
    const first = await mesh.dispatch(rawFacts(), { trigger: 'install.preflight' });
    const result = await mesh.dispatch(rawFacts(), {
      trigger: 'system.facts.request',
      history: [first.engine.facts]
    });
    expect(Object.keys(result.turbos)).toEqual([
      'stability',
      'pressure',
      'capability',
      'cadence'
    ]);
    expect(result.turbos.stability.report.state).toBe('insufficient-data');
    expect(result.turbos.pressure.plan.mode).toBe('observe');
    expect(result.turbos.capability.plan.mode).toBe('headless-observation');
    expect(result.turbos.cadence.report.samples).toBe(1);
    expect(mesh.loadedComponents()).toHaveLength(10);
  });

  test('routes workload and health triggers through their declared selections', async () => {
    const mesh = createSystemFactsMesh({ now: () => 0 });
    const workload = await mesh.dispatch(rawFacts(), { trigger: 'workload.changed' });
    expect(Object.keys(workload.turbos)).toEqual(['stability', 'pressure', 'cadence']);
    const health = await mesh.dispatch(rawFacts(), { trigger: 'health.interval' });
    expect(Object.keys(health.turbos)).toEqual([
      'stability',
      'pressure',
      'capability',
      'cadence'
    ]);
  });

  test('refuses invalid mesh triggers, history, and clocks', async () => {
    const mesh = createSystemFactsMesh({ now: () => 0 });
    await expect(mesh.dispatch(rawFacts(), { trigger: 'bad' }))
      .rejects.toThrow('Unsupported system-facts mesh trigger: bad');
    await expect(mesh.dispatch(rawFacts(), { trigger: 'system.facts.request', history: {} }))
      .rejects.toThrow('history must be an array');
    await expect(mesh.dispatch(rawFacts(), {}))
      .rejects.toThrow('Unsupported system-facts mesh trigger: unknown');
    await expect(mesh.dispatch())
      .rejects.toThrow('Unsupported system-facts mesh trigger: unknown');
    expect(() => createSystemFactsMesh({ now: 0 }))
      .toThrow('mesh clock must be a function');
  });
});
