/**
 * Native workstation policy tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { approveWorkstationPolicy, buildWorkstationPolicyPlan, WORKSTATION_POLICY_VERSION } from '../native/workstation-policy.js';

const facts = {
  storagePressure: { level: 'critical', belowTargetFreeFloor: true },
  memory: { usedPercent: 96 },
  pagefile: { pressurePercent: 90 },
  thermals: { maxTemperatureC: 96, throttling: true },
  battery: { batteries: [{ capacityPercent: 20, healthPercent: 70 }] },
  game: { detected: true, name: 'Game.exe' },
  processes: [
    { pid: 11, name: 'builder', role: 'build' },
    { pid: 12, name: 'bad', state: 'crashed' },
    { pid: 13, name: 'model', role: 'model', protected: true }
  ]
};

describe('native workstation policy', () => {
  test('detects pressure and emits bounded delegated recommendations', () => {
    const plan = buildWorkstationPolicyPlan(facts, { report: { period: 'daily' } });
    expect(plan).toMatchObject({ version: WORKSTATION_POLICY_VERSION, phase: 'recommend', state: 'recommendations-ready', execution: expect.stringContaining('no host mutation'), observed: { backgroundWorkloadCount: 1, abnormalProcessCount: 1, game: { detected: true, name: 'Game.exe' } } });
    expect(plan.recommendations).toEqual(['storage-pressure-review', 'memory-pressure-review', 'thermal-workload-review', 'gaming-build-review', 'abnormal-process-review', 'battery-health-review']);
    expect(plan.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'storage-pressure-review', operation: 'storage-preview', requiresApproval: true, mutation: 'none' }),
      expect.objectContaining({ id: 'abnormal-process-review', operation: 'process-overview', requiresApproval: false })
    ]));
    expect(plan.report).toEqual({ period: 'daily' });
  });

  test('bounds actions and fails closed when observations do not warrant action', () => {
    const bounded = buildWorkstationPolicyPlan(facts, { maxActions: 2 });
    expect(bounded.actions).toHaveLength(2);
    const quiet = buildWorkstationPolicyPlan({ storagePressure: { level: 'normal' }, memory: { usedPercent: 10 }, pagefile: { pressurePercent: 10 }, thermals: { maxTemperatureC: 50 }, battery: { available: false }, game: { detected: false }, processes: [] });
    expect(quiet).toMatchObject({ state: 'no-change', actions: [], recommendations: [], observed: { storage: { level: 'normal' }, memory: { pressure: 'normal' }, pagefile: { pressure: 'normal' }, thermal: { temperatureC: 50, throttling: false }, game: { detected: false } } });
    expect(buildWorkstationPolicyPlan()).toMatchObject({ state: 'no-change', observed: { storage: { level: 'unknown' }, memory: { pressure: 'unknown' }, pagefile: { pressure: 'unknown' }, thermal: { temperatureC: null, throttling: false }, battery: { healthPercent: null } } });
    expect(buildWorkstationPolicyPlan({ battery: { healthPercent: 90 }, thermal: { maxTemperatureC: 91 }, processes: [{ pid: 1, role: 'other', state: 'running' }] }).recommendations).toEqual(['thermal-workload-review']);
    expect(() => buildWorkstationPolicyPlan(null)).toThrow('facts');
    expect(() => buildWorkstationPolicyPlan({}, { maxActions: 0 })).toThrow('bound');
    expect(() => buildWorkstationPolicyPlan({}, { maxActions: 17 })).toThrow('bound');
  });

  test('approves exact recommendation ids without executing them', () => {
    const plan = buildWorkstationPolicyPlan(facts);
    const approved = approveWorkstationPolicy(plan, { approvedIds: ['storage-pressure-review', 'missing', 'storage-pressure-review', 4] });
    expect(approved).toMatchObject({ phase: 'approved', approvedIds: ['storage-pressure-review', 'missing'], execution: expect.stringContaining('delegated') });
    expect(approved.actions.find((item) => item.id === 'storage-pressure-review')).toMatchObject({ approved: true });
    expect(approved.actions.find((item) => item.id === 'memory-pressure-review')).toMatchObject({ approved: false });
    expect(() => approveWorkstationPolicy(plan, { approvedIds: null })).toThrow('id list');
    expect(() => approveWorkstationPolicy(plan, { approvedIds: Array.from({ length: 17 }, (_, index) => String(index)) })).toThrow('id list');
    expect(() => approveWorkstationPolicy({ ...plan, phase: 'approved' }, { approvedIds: [] })).toThrow('invalid');
    expect(() => approveWorkstationPolicy()).toThrow('invalid');
  });
});
