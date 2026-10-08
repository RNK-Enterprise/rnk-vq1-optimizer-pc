import {
  PC_ENGINE_CATALOG_ID,
  PC_ENGINE_CATALOG_VERSION,
  PC_ENGINE_IDS,
  PC_ENGINE_TRIGGERS,
  createPcEngineCatalog,
  getPcEngineDefinition,
  requirePcEngineDefinition
} from '../pc/engines/catalog.js';

describe('PC optimizer engine catalog', () => {
  test('publishes the canonical 35-engine inventory', () => {
    expect(PC_ENGINE_IDS).toHaveLength(35);
    expect(new Set(PC_ENGINE_IDS).size).toBe(35);
    expect(PC_ENGINE_IDS[0]).toBe('system-facts');
    expect(PC_ENGINE_IDS.at(-1)).toBe('workstation-health');
    expect(PC_ENGINE_TRIGGERS).toEqual([
      'install.preflight',
      'system.facts.request',
      'workload.changed',
      'health.interval'
    ]);
    expect(Object.isFrozen(PC_ENGINE_IDS)).toBe(true);
    expect(Object.isFrozen(PC_ENGINE_TRIGGERS)).toBe(true);
  });

  test('creates a frozen catalog with ordered definitions', () => {
    const catalog = createPcEngineCatalog();
    expect(catalog.id).toBe(PC_ENGINE_CATALOG_ID);
    expect(catalog.version).toBe(PC_ENGINE_CATALOG_VERSION);
    expect(catalog.count).toBe(35);
    expect(catalog.engines[0]).toMatchObject({ id: 'system-facts', ordinal: 1 });
    expect(catalog.engines.at(-1)).toMatchObject({ id: 'workstation-health', ordinal: 35 });
    expect(catalog.engines.every((item) => item.execution === 'analysis-only-until-approved')).toBe(true);
    expect(Object.isFrozen(catalog)).toBe(true);
  });

  test('resolves known engines and refuses unknown engines', () => {
    expect(getPcEngineDefinition('gpu-policy')).toMatchObject({ id: 'gpu-policy', ordinal: 10 });
    expect(getPcEngineDefinition('missing')).toBe(null);
    expect(requirePcEngineDefinition('thermal').id).toBe('thermal');
    expect(() => requirePcEngineDefinition('missing'))
      .toThrow('Unknown PC optimizer engine: missing');
    expect(() => requirePcEngineDefinition())
      .toThrow('Unknown PC optimizer engine: unknown');
  });
});
