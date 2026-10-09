import path from 'path';
import {
  assessStorageSuitability,
  assessStorageTarget,
  storageSuitabilityForPath,
  STORAGE_SUITABILITY_STATES,
  STORAGE_SUITABILITY_VERSION
} from '../native/storage-suitability.js';

const healthyDrive = { diskNumber: 2, physicalDevicePath: '\\\\.\\PhysicalDrive2', health: 'healthy', smart: 'passed', source: 'test-smart' };
const healthyVolume = { mount: 'E:', volumeId: 'volume-e', physicalDiskNumber: 2, physicalDevicePath: '\\\\.\\PhysicalDrive2', health: 'healthy', writable: true, source: 'test-volume' };

describe('canonical physical-storage suitability', () => {
  test('admits only a fully identified healthy writable volume', () => {
    expect(STORAGE_SUITABILITY_STATES).toEqual(['HEALTHY', 'DEGRADED', 'FAILED', 'UNKNOWN']);
    expect(assessStorageSuitability({ volume: healthyVolume, drives: [healthyDrive] })).toMatchObject({ version: STORAGE_SUITABILITY_VERSION, state: 'HEALTHY', eligible: true, admission: 'ALLOW', mount: 'E:', health: { volume: 'HEALTHY', disk: 'HEALTHY', smart: 'HEALTHY' } });
    expect(assessStorageTarget({ targetMount: 'e:', volumes: [healthyVolume], drives: [healthyDrive] }).admission).toBe('ALLOW');
    expect(storageSuitabilityForPath('E:\\archive\\file.zip', { volumes: [healthyVolume], drives: [healthyDrive] }).admission).toBe('ALLOW');
    expect(storageSuitabilityForPath('/archive/file.zip', { pathImpl: path.posix, volumes: [{ mount: '/', volumeId: 'root', physicalDiskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy' }], drives: [{ diskNumber: 0, physicalDevicePath: 'disk0', health: 'healthy', smart: 'passed' }], }).mount).toBe('/');
  });

  test('fails closed for health, identity, write, and hard-failure conditions', () => {
    expect(assessStorageSuitability({ volume: { ...healthyVolume, health: 'warning' }, drives: [healthyDrive] }).state).toBe('DEGRADED');
    expect(assessStorageSuitability({ volume: { ...healthyVolume, health: 'failed' }, drives: [healthyDrive] }).state).toBe('FAILED');
    expect(assessStorageSuitability({ volume: { ...healthyVolume, writable: false }, drives: [healthyDrive] })).toMatchObject({ state: 'HEALTHY', eligible: false, admission: 'DENY' });
    expect(assessStorageSuitability({ volume: healthyVolume, drives: [{ ...healthyDrive, smart: 'unknown' }] }).state).toBe('UNKNOWN');
    expect(assessStorageSuitability({ volume: { ...healthyVolume, volumeId: null }, drives: [healthyDrive] }).reasons).toContain('VOLUME_IDENTITY_UNRESOLVED');
    expect(assessStorageSuitability({ volume: { ...healthyVolume, physicalDiskNumber: null, physicalDevicePath: null }, drives: [healthyDrive] }).reasons).toContain('PHYSICAL_DISK_IDENTITY_UNRESOLVED');
    expect(assessStorageSuitability({ volume: healthyVolume, drives: [{ ...healthyDrive, diskNumber: 8, physicalDevicePath: '\\\\.\\PhysicalDrive8' }] }).reasons).toContain('PHYSICAL_DISK_NOT_FOUND');
    expect(assessStorageSuitability({ volume: healthyVolume, drives: [], hardFailureEvidence: [{ recentBadBlocks: true }] })).toMatchObject({ state: 'FAILED', admission: 'DENY', reasons: expect.arrayContaining(['HARD_FAILURE_RECENTBADBLOCKS']) });
    expect(assessStorageSuitability({ volume: { ...healthyVolume, hardFailureEvidence: [{ failure: true }] }, physicalDisk: { ...healthyDrive, hardFailureEvidence: [{ controllerReset: true }] } }).state).toBe('FAILED');
  });

  test('reports missing target evidence and accepts explicit disk or aliases', () => {
    expect(assessStorageTarget({ targetMount: 'Z:', volumes: [healthyVolume], drives: [healthyDrive] })).toMatchObject({ state: 'UNKNOWN', admission: 'DENY', reasons: ['VOLUME_NOT_OBSERVED'] });
    expect(assessStorageSuitability({ volume: { driveLetter: 'F:', uniqueId: 'f', diskNumber: 3, physicalDevice: 'PhysicalDrive3', healthStatus: 'online', readOnly: false }, physicalDisk: { Number: 3, physicalDisk: 'PhysicalDrive3', operationalStatus: 'online', smart: { status: 'passed' } } })).toMatchObject({ state: 'HEALTHY', admission: 'ALLOW', mount: 'F:' });
    expect(assessStorageSuitability({ volume: null, physicalDisk: null, drives: null })).toMatchObject({ state: 'UNKNOWN', admission: 'DENY' });
    expect(storageSuitabilityForPath(null)).toMatchObject({ state: 'UNKNOWN', admission: 'DENY' });
    expect(assessStorageSuitability({ volume: { ...healthyVolume, diskHealth: 'healthy', diskOperationalStatus: 'online', smart: 'passed' } })).toMatchObject({ state: 'HEALTHY', admission: 'ALLOW' });
    expect(assessStorageSuitability()).toMatchObject({ state: 'UNKNOWN', admission: 'DENY' });
    expect(assessStorageSuitability({ volume: { mount: '\\', volumeId: 'slash' } })).toMatchObject({ mount: null, state: 'UNKNOWN' });
    expect(assessStorageSuitability({ volume: { mount: 'F:', volumeId: 'f', physicalDevicePath: 'PhysicalDrive3', health: 'healthy' }, drives: [{ physicalDevicePath: '\\\\.\\PhysicalDrive3', health: 'healthy', smart: 'passed' }] })).toMatchObject({ state: 'HEALTHY', admission: 'ALLOW' });
    expect(assessStorageSuitability({ volume: { mount: 'F:', volumeId: 'f', physicalDiskNumber: 3, health: 'healthy' }, physicalDisk: { health: 'healthy', smart: 'passed' } })).toMatchObject({ state: 'UNKNOWN', reasons: ['PHYSICAL_DISK_IDENTITY_UNRESOLVED'] });
    expect(assessStorageTarget({ targetMount: 'E:', volumes: [null, healthyVolume], drives: [healthyDrive] }).admission).toBe('ALLOW');
    expect(storageSuitabilityForPath('/archive/file.zip', { pathImpl: {}, volumes: [] })).toMatchObject({ state: 'UNKNOWN', mount: null });
    expect(assessStorageTarget()).toMatchObject({ state: 'UNKNOWN', admission: 'DENY' });
    expect(assessStorageTarget({ targetMount: 'E:', volumes: null, drives: null, hardFailureEvidence: null })).toMatchObject({ state: 'UNKNOWN', admission: 'DENY' });
    expect(assessStorageTarget({ targetMount: 'E:', volumes: [{}] })).toMatchObject({ state: 'UNKNOWN', reasons: ['VOLUME_NOT_OBSERVED'] });
    expect(assessStorageSuitability({ volume: { mount: 'G:', volumeId: 'g', physicalDevicePath: 'disk3', health: 'healthy' }, drives: [{ physicalDevicePath: 'disk3', health: 'healthy', smart: 'passed' }] })).toMatchObject({ state: 'HEALTHY', admission: 'ALLOW' });
    expect(assessStorageSuitability({ volume: { mount: 'H:', volumeId: 'h', physicalDiskNumber: 3, health: 'healthy' }, drives: [{ diskNumber: 3, health: 'healthy', smart: 'passed' }] })).toMatchObject({ state: 'HEALTHY', admission: 'ALLOW' });
    expect(storageSuitabilityForPath('/archive/file.zip', { pathImpl: { parse: () => ({ root: '' }) } })).toMatchObject({ state: 'UNKNOWN', mount: null });
    expect(storageSuitabilityForPath('', { pathImpl: { parse: () => ({ root: '/' }) }, volumes: [{ mount: '/', volumeId: 'root', physicalDiskNumber: 0, health: 'healthy' }], drives: [{ diskNumber: 0, health: 'healthy', smart: 'passed' }] })).toMatchObject({ mount: '/', state: 'HEALTHY' });
  });
});
