/**
 * Native workstation trends tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { buildWorkstationTrends, WORKSTATION_TRENDS_VERSION } from '../native/workstation-trends.js';

const DAY = 24 * 60 * 60 * 1000;
const facts = (timestamp, freeBytes, healthPercent, thermal, memory, failed = 0, fanRpm = null) => ({ event: 'report', timestamp, facts: { storagePressure: { freeBytes }, battery: { batteries: [{ healthPercent }] }, thermals: { maxTemperatureC: thermal }, fans: fanRpm === null ? undefined : { fans: [{ rpm: fanRpm }] }, memory: { usedPercent: memory }, drives: { drives: Array.from({ length: failed }, () => ({ health: 'failed' })) } } });

describe('workstation trends', () => {
  test('reduces multi-day storage, battery, thermal, memory, and drive trends', () => {
    const first = facts(0, 100, 95, 60, 50, 0, 1200);
    first.facts.fans = { fans: [{ currentSpeed: 1200 }] };
    const result = buildWorkstationTrends([first, facts(DAY, 80, 90, 66, 57, 1, 1800)], { now: () => DAY, windowMs: 2 * DAY });
    expect(result).toMatchObject({ version: WORKSTATION_TRENDS_VERSION, period: 'multi-day', sampleCount: 2, storage: { delta: -20, direction: 'falling' }, battery: { delta: -5 }, thermals: { delta: 6 }, fans: { delta: 600, direction: 'rising' }, memory: { delta: 7 }, drives: { latest: 1 }, recommendations: ['storage-is-filling', 'battery-health-is-declining', 'thermal-readings-are-rising', 'fan-speed-is-rising', 'memory-pressure-is-rising', 'drive-failure-evidence-present'] });
    expect(result.window.windowMs).toBe(2 * DAY);
  });

  test('tracks pagefile growth and GPU thermal drift independently', () => {
    const first = facts(0, 100, 95, 60, 50);
    first.facts.pagefile = { currentBytes: 100 };
    first.facts.gpu = { temperatureC: 60, thermalThrottling: false };
    const second = facts(DAY, 80, 90, 60, 50);
    second.facts.pagefile = { currentBytes: 200 };
    second.facts.gpu = { temperature: 72, thermalThrottling: true };
    const result = buildWorkstationTrends([first, second], { now: () => DAY, windowMs: 2 * DAY });
    expect(result).toMatchObject({ pagefile: { delta: 100, direction: 'rising' }, gpuThermals: { delta: 12, direction: 'rising' }, gpuThrottleEvents: 1 });
    expect(result.recommendations).toEqual(expect.arrayContaining(['gpu-thermal-readings-are-rising', 'gpu-thermal-throttle-observed', 'pagefile-usage-is-rising']));
  });

  test('separates battery charge movement from battery health and filters drain samples', () => {
    const first = facts(0, 100, 95, 60, 50);
    first.facts.battery.batteries[0].capacityPercent = 80;
    first.facts.battery.batteries[0].status = 'Discharging';
    const second = facts(DAY, 100, 95, 60, 50);
    second.facts.battery.batteries[0].capacityPercent = 55;
    second.facts.battery.batteries[0].status = 'discharging';
    const result = buildWorkstationTrends([first, second], { now: () => DAY, windowMs: 2 * DAY });
    expect(result).toMatchObject({ battery: { direction: 'stable' }, batteryCharge: { delta: -25, direction: 'falling' }, batteryDischarge: { delta: -25, direction: 'falling' }, recommendations: ['battery-drain-observed'] });
  });

  test('preserves missing evidence and validates bounds', () => {
    expect(buildWorkstationTrends([{ event: 'other', timestamp: 1, facts: {} }, { event: 'report', timestamp: DAY, facts: null }], { now: () => DAY })).toMatchObject({ sampleCount: 1, storage: { direction: 'unknown' }, recommendations: ['no-material-change-observed'] });
    expect(buildWorkstationTrends([{ event: 'other', timestamp: 1, facts: {} }], { now: () => DAY })).toMatchObject({ sampleCount: 0, recommendations: ['collect-workstation-evidence'] });
    expect(buildWorkstationTrends([facts(0, 10, 90, 50, 50), facts(DAY, 10, 90, 50, 50)], { now: () => DAY, windowMs: 2 * DAY })).toMatchObject({ recommendations: ['no-material-change-observed'], storage: { direction: 'stable' }, battery: { direction: 'stable' } });
    expect(() => buildWorkstationTrends(null)).toThrow('entries');
    expect(() => buildWorkstationTrends(Array.from({ length: 4097 }, () => ({})))).toThrow('exceed');
    expect(() => buildWorkstationTrends([], { now: 1 })).toThrow('clock');
    expect(() => buildWorkstationTrends([], { now: () => NaN })).toThrow('return');
    expect(() => buildWorkstationTrends([], { now: () => DAY, windowMs: DAY - 1 })).toThrow('window');
    expect(() => buildWorkstationTrends([], { now: () => DAY, windowMs: DAY, maxEntries: 0 })).toThrow('maxEntries');
  });
});
