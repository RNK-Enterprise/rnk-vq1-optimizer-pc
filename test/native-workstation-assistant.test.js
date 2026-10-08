/**
 * Native workstation assistant tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import { interpretWorkstationQuestion, WORKSTATION_ASSISTANT_VERSION } from '../native/workstation-assistant.js';

const facts = {
  storage: [{ mount: 'C:', freeBytes: 4, totalBytes: 100 }],
  storagePressure: { level: 'critical' },
  memory: { usedPercent: 92 },
  pagefile: { pressure: true },
  processes: [{ pid: 2, name: 'model', memoryBytes: 900, role: 'ai' }, { pid: 1, name: 'game', memoryBytes: 100, role: 'game' }],
  thermals: { maxTemperatureC: 91 },
  gpu: { temperatureC: 88 },
  battery: { batteries: [{ capacityPercent: 12, status: 'charging' }] },
  game: { detected: true, name: 'game.exe' }
};

describe('workstation assistant', () => {
  test('answers storage, memory, thermal, battery, history, and workload questions from facts', () => {
    expect(interpretWorkstationQuestion('Why is my C: drive full?', facts)).toMatchObject({ version: WORKSTATION_ASSISTANT_VERSION, intent: 'storage', state: 'answered', evidence: { pressure: { level: 'critical' } } });
    expect(interpretWorkstationQuestion('What is eating my RAM?', facts)).toMatchObject({ intent: 'memory', evidence: { topProcesses: expect.arrayContaining([expect.objectContaining({ name: 'model' })]), pagefile: { pressure: true } } });
    expect(interpretWorkstationQuestion('Why did the laptop get hot?', facts)).toMatchObject({ intent: 'thermals', state: 'answered', recommendations: ['reduce-sustained-load', 'check-cooling'] });
    expect(interpretWorkstationQuestion('How healthy is my battery?', facts)).toMatchObject({ intent: 'battery', state: 'answered' });
    expect(interpretWorkstationQuestion('What changed since yesterday?', facts, { report: { trend: 'storage-growing' } })).toMatchObject({ intent: 'history', state: 'answered', evidence: { report: { trend: 'storage-growing' } } });
    expect(interpretWorkstationQuestion('Can I run this game while my build finishes?', facts)).toMatchObject({ intent: 'workload', state: 'answered', recommendations: ['preview-gaming-build-policy', 'preserve-foreground-latency'] });
  });

  test('returns safe preview plans and refuses unsupported or missing evidence', () => {
    expect(interpretWorkstationQuestion('Clean what is already safe', { storagePressure: { level: 'warning' } })).toMatchObject({ intent: 'cleanup', state: 'preview-required', plan: { mutation: 'none', requiresApproval: true } });
    expect(interpretWorkstationQuestion('Move completed downloads to E:', {})).toMatchObject({ intent: 'placement', state: 'explicit-input-required', plan: { operation: 'placement-preview' } });
    expect(interpretWorkstationQuestion('Why is my C drive full?', {})).toMatchObject({ intent: 'storage', state: 'observation-required' });
    expect(interpretWorkstationQuestion('What is eating RAM?', {})).toMatchObject({ intent: 'memory', state: 'observation-required' });
    expect(interpretWorkstationQuestion('Why is it hot?', {})).toMatchObject({ intent: 'thermals', state: 'observation-required' });
    expect(interpretWorkstationQuestion('How is the battery?', {})).toMatchObject({ intent: 'battery', state: 'observation-required' });
    expect(interpretWorkstationQuestion('What changed?', {})).toMatchObject({ intent: 'history', state: 'observation-required' });
    expect(interpretWorkstationQuestion('Can I run the game?', {})).toMatchObject({ intent: 'workload', state: 'observation-required' });
    expect(interpretWorkstationQuestion('Do something mysterious', {})).toMatchObject({ intent: 'unknown', state: 'refused' });
    expect(() => interpretWorkstationQuestion('', {})).toThrow('question');
    expect(() => interpretWorkstationQuestion('Why?', null)).toThrow('facts');
  });

  test('covers degraded evidence and normalization branches', () => {
    const sparse = { storage: [{ mount: '', freeBytes: 'bad', totalBytes: -1, usedBytes: 2 }], processes: [{ name: '', pid: 0, memoryBytes: -1, cpuPercent: 'bad', protected: true }, { role: 'compiler' }], thermals: { maxTemperatureC: 'bad' }, battery: { batteries: [{}] }, game: { detected: false } };
    expect(interpretWorkstationQuestion('Why is disk space changing?', sparse)).toMatchObject({ intent: 'storage', state: 'answered', evidence: { storage: [{ mount: 'unknown', freeBytes: null }] } });
    expect(interpretWorkstationQuestion('What is eating memory?', { processes: [{}] })).toMatchObject({ intent: 'memory', state: 'answered', recommendations: ['review-top-memory-processes'] });
    expect(interpretWorkstationQuestion('How hot is it?', { gpu: {} })).toMatchObject({ intent: 'thermals', state: 'answered', answer: 'Thermal evidence is unavailable.' });
    expect(interpretWorkstationQuestion('How is the battery?', sparse)).toMatchObject({ intent: 'battery', state: 'answered' });
    expect(interpretWorkstationQuestion('Can I game?', { processes: [{ role: 'background' }] })).toMatchObject({ intent: 'workload', state: 'observation-required' });
    expect(interpretWorkstationQuestion('Clean the safe cache', {})).toMatchObject({ intent: 'cleanup', state: 'observation-required' });
    expect(interpretWorkstationQuestion('What changed?', {})).toMatchObject({ intent: 'history', state: 'observation-required' });
    expect(interpretWorkstationQuestion('What is on disk?', { storagePressure: {} })).toMatchObject({ intent: 'storage', answer: 'System storage pressure is unknown.' });
    expect(interpretWorkstationQuestion('What is eating memory?', { memory: { usedPercent: 'bad' }, pagefile: {}, processes: [{ memoryBytes: 10 }, { memoryBytes: null }, { memoryBytes: 20 }, { memoryBytes: null }] })).toMatchObject({ intent: 'memory', answer: 'Memory usage is unknown percent.', recommendations: ['review-top-memory-processes'] });
    expect(interpretWorkstationQuestion('Unknown request')).toMatchObject({ intent: 'unknown' });
  });
});
