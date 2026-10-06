import { PC_MESH_ID, PC_MESH_VERSION, PC_MESH_TRIGGERS, createPcMesh } from '../pc/mesh.js';

describe('PC-wide local mesh', () => {
  test('registers every engine, library, turbo, and turbo library', () => {
    const mesh = createPcMesh({ now: () => 0 });
    expect(createPcMesh().id).toBe(PC_MESH_ID);
    const nodes = mesh.listNodes();
    const bridges = mesh.listBridges();
    expect(PC_MESH_ID).toBe('optimizer.pc.mesh');
    expect(PC_MESH_VERSION).toBe(1);
    expect(PC_MESH_TRIGGERS).toEqual(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
    expect(nodes).toHaveLength(340);
    expect(nodes.filter((node) => node.kind === 'engine')).toHaveLength(34);
    expect(nodes.filter((node) => node.kind === 'library')).toHaveLength(34);
    expect(nodes.filter((node) => node.kind === 'turbo')).toHaveLength(136);
    expect(nodes.filter((node) => node.kind === 'turbo-library')).toHaveLength(136);
    expect(bridges).toHaveLength(2856);
    expect(bridges.filter((bridge) => bridge.type === 'command')).toHaveLength(1428);
    expect(bridges.filter((bridge) => bridge.type === 'event')).toHaveLength(1428);
    expect(nodes.every((node) => node.lazy && node.triggers === PC_MESH_TRIGGERS)).toBe(true);
  });

  test('resolves nodes and lazy-loads modules only when requested', async () => {
    const mesh = createPcMesh({ now: () => 0 });
    expect(mesh.loadedNodes()).toEqual([]);
    expect(mesh.resolveNode('workload-profile.intensity-trend.turbo')).toMatchObject({ kind: 'turbo', engine: 'workload-profile' });
    expect(mesh.resolveNode('optimizer.authority.safety-audit.engine')).toMatchObject({ kind: 'engine' });
    expect(mesh.resolveNode('missing')).toBe(null);
    expect(mesh.resolveNode(null)).toBe(null);
    const first = await mesh.loadNode('system-facts.engine');
    const same = await mesh.loadNode('optimizer.authority.system-facts.engine');
    const turbo = await mesh.loadNode('workload-profile.intensity-trend.turbo');
    const library = await mesh.loadNode('workload-profile.intensity-trend.turbo-library');
    expect(first).toBe(same);
    expect(typeof first.runSystemFactsEngine).toBe('function');
    expect(typeof turbo.runWorkloadIntensityTrendTurbo).toBe('function');
    expect(typeof library.mergeWorkloadIntensityTrendReports).toBe('function');
    expect(mesh.loadedNodes()).toEqual(['system-facts.engine', 'workload-profile.intensity-trend.turbo', 'workload-profile.intensity-trend.turbo-library']);
    await expect(mesh.loadNode('missing')).rejects.toThrow('Unknown PC mesh node: missing');
    await expect(mesh.loadNode()).rejects.toThrow('Unknown PC mesh node: unknown');
  });

  test('dispatches typed local commands and events without transport', () => {
    const mesh = createPcMesh({ now: () => 42 });
    const command = mesh.dispatch({ type: 'command', from: 'optimizer.dispatch.system-facts.engine', to: 'optimizer.authority.cpu-utilization.engine', trigger: 'system.facts.request', payload: { facts: true }, requestId: 'req-1' });
    expect(command).toMatchObject({ mesh: PC_MESH_ID, type: 'command', trigger: 'system.facts.request', requestId: 'req-1', from: 'optimizer.dispatch.system-facts.engine', to: 'optimizer.authority.cpu-utilization.engine', payload: { facts: true }, actions: [] });
    const event = mesh.dispatch({ type: 'event', from: 'cpu-utilization.engine', to: 'system-facts.engine', trigger: 'health.interval', payload: { state: 'stable' } });
    expect(event).toMatchObject({ type: 'event', requestId: 'pc-mesh-42', from: 'optimizer.dispatch.cpu-utilization.engine', to: 'optimizer.authority.system-facts.engine' });
    expect(Object.isFrozen(command)).toBe(true);
    expect(Object.isFrozen(command.payload)).toBe(true);
  });

  test('rejects unknown routes, invalid payloads, triggers, bridges, clocks, and options', () => {
    const mesh = createPcMesh({ now: () => 0 });
    expect(() => mesh.dispatch({ type: 'command', from: 'system-facts.engine', to: 'cpu-utilization.engine', trigger: 'bad' })).toThrow('Unsupported PC mesh trigger: bad');
    expect(() => mesh.dispatch()).toThrow('Unsupported PC mesh trigger: unknown');
    expect(() => mesh.dispatch({ from: 'system-facts.engine', to: 'cpu-utilization.engine', trigger: 'health.interval' })).toThrow('Unsupported PC mesh bridge type: unknown');
    expect(() => mesh.dispatch({ type: 'command', from: 'system-facts.engine', to: 'cpu-utilization.engine', trigger: 'health.interval', payload: [] })).toThrow('payload must be an object');
    expect(() => mesh.dispatch({ type: 'other', from: 'system-facts.engine', to: 'cpu-utilization.engine', trigger: 'health.interval' })).toThrow('Unsupported PC mesh bridge type: other');
    expect(() => mesh.dispatch({ type: 'command', from: 'missing', to: 'cpu-utilization.engine', trigger: 'health.interval' })).toThrow('unknown node');
    expect(() => mesh.dispatch({ type: 'command', from: 'system-facts.engine', to: 'missing', trigger: 'health.interval' })).toThrow('unknown node');
    expect(() => mesh.dispatch({ type: 'command', from: 'system-facts.engine', to: 'cpu-utilization.burst-window.turbo', trigger: 'health.interval' })).toThrow('route is not registered');
    const broken = createPcMesh({ now: () => NaN });
    expect(() => broken.dispatch({ type: 'command', from: 'system-facts.engine', to: 'cpu-utilization.engine', trigger: 'health.interval' })).toThrow('clock must return a number');
    expect(() => createPcMesh({ now: 0 })).toThrow('mesh clock must be a function');
  });
});
