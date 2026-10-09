import { runDownloadGuardEngine, DOWNLOAD_GUARD_ENGINE_ID, DOWNLOAD_GUARD_TRIGGERS } from '../pc/engines/download-guard/engine.js';
import { mergeDownloadGuardReports, buildDownloadGuardPlan, buildDownloadGuardEnvelope, createDownloadGuardLibrary, DOWNLOAD_GUARD_LIBRARY_ID } from '../pc/engines/download-guard/library.js';
import { runDownloadGuardSpacePreflightTurbo } from '../pc/engines/download-guard/turbos/space-preflight/turbo.js';
import { mergeDownloadGuardSpacePreflightReports, buildDownloadGuardSpacePreflightPlan, buildDownloadGuardSpacePreflightEnvelope, createDownloadGuardSpacePreflightLibrary } from '../pc/engines/download-guard/turbos/space-preflight/library.js';
import { runDownloadGuardDestinationSelectionTurbo } from '../pc/engines/download-guard/turbos/destination-selection/turbo.js';
import { mergeDownloadGuardDestinationSelectionReports, buildDownloadGuardDestinationSelectionPlan, buildDownloadGuardDestinationSelectionEnvelope, createDownloadGuardDestinationSelectionLibrary } from '../pc/engines/download-guard/turbos/destination-selection/library.js';
import { runDownloadGuardDuplicateReviewTurbo } from '../pc/engines/download-guard/turbos/duplicate-review/turbo.js';
import { mergeDownloadGuardDuplicateReviewReports, buildDownloadGuardDuplicateReviewPlan, buildDownloadGuardDuplicateReviewEnvelope, createDownloadGuardDuplicateReviewLibrary } from '../pc/engines/download-guard/turbos/duplicate-review/library.js';
import { runDownloadGuardHashVerificationTurbo } from '../pc/engines/download-guard/turbos/hash-verification/turbo.js';
import { mergeDownloadGuardHashVerificationReports, buildDownloadGuardHashVerificationPlan, buildDownloadGuardHashVerificationEnvelope, createDownloadGuardHashVerificationLibrary } from '../pc/engines/download-guard/turbos/hash-verification/library.js';

const hash = 'a'.repeat(64);
const storage = [{ mount: 'C:', volumeId: 'volume-c', physicalDiskNumber: 0, physicalDevicePath: '\\\\.\\PhysicalDrive0', health: 'healthy', totalBytes: 100, freeBytes: 8, kind: 'ssd', system: true }, { mount: 'E:', volumeId: 'volume-e', physicalDiskNumber: 1, physicalDevicePath: '\\\\.\\PhysicalDrive1', health: 'healthy', totalBytes: 1000, freeBytes: 2 * 1024 ** 3, kind: 'hdd' }];
const drives = [{ diskNumber: 0, physicalDevicePath: '\\\\.\\PhysicalDrive0', health: 'healthy', smart: 'passed' }, { diskNumber: 1, physicalDevicePath: '\\\\.\\PhysicalDrive1', health: 'healthy', smart: 'passed' }];
const facts = { engine: 'system-facts', systemMount: 'C:', storage, drives, download: { name: 'model.zip', path: 'E:/Downloads/model.zip', sizeBytes: 120, destinationMount: 'C:', sha256: hash } };
const report = (state, fields = {}) => ({ engine: 'download-guard', state, recommendations: ['review'], actions: [], targetMount: 'e:', ...fields });
const turboReport = (turbo, state, fields = {}) => ({ turbo, state, ...fields });

describe('download-guard engine and library', () => {
  test('redirects a large download to a volume with headroom', () => {
    expect(DOWNLOAD_GUARD_ENGINE_ID).toBe('download-guard');
    expect(DOWNLOAD_GUARD_TRIGGERS).toEqual(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
    const result = runDownloadGuardEngine(facts, { trigger: 'install.preflight', now: () => 0 });
    expect(result).toMatchObject({ state: 'redirect', systemMount: 'c:', requestedMount: 'c:', targetMount: 'e:', targetKind: 'hdd', redirected: true, hashStatus: 'available', requiredBytes: 120 + 512 * 1024 ** 2 });
    expect(result.actions).toEqual([]);
    expect(result.recommendations).toContain('use-e:-instead');
    expect(runDownloadGuardEngine({ ...facts, hardFailureEvidence: [], download: { ...facts.download, sizeBytes: 1, destinationMount: 'E:' } }, { trigger: 'health.interval' }).state).toBe('allow');
    expect(runDownloadGuardEngine({ engine: 'download-guard-input', storage: [], download: { sizeBytes: 1 } }, { trigger: 'health.interval' }).state).toBe('insufficient-space');
    expect(runDownloadGuardEngine({ ...facts, download: { sizeBytes: 1, destinationMount: 'E:' } }, { trigger: 'health.interval' }).recommendations).toContain('verify-hash-when-available');
    const twoSafeCandidates = runDownloadGuardEngine({ ...facts, storage: [...facts.storage, { mount: 'F:', volumeId: 'volume-f', physicalDiskNumber: 2, physicalDevicePath: '\\\\.\\PhysicalDrive2', health: 'healthy', freeBytes: 3 * 1024 ** 3, kind: 'hdd' }], drives: [...drives, { diskNumber: 2, physicalDevicePath: '\\\\.\\PhysicalDrive2', health: 'healthy', smart: 'passed' }], download: { sizeBytes: 1, destinationMount: 'C:' } }, { trigger: 'health.interval' });
    expect(twoSafeCandidates.targetMount).toBe('f:');
  });

  test('fails closed for protected, duplicate, incomplete, and missing evidence', () => {
    const protectedTarget = runDownloadGuardEngine({ ...facts, targetPath: 'E:/Projects/app/file.zip', protectedPaths: ['E:/Projects'] }, { trigger: 'workload.changed' });
    const duplicate = runDownloadGuardEngine({ ...facts, download: { ...facts.download, destinationMount: 'E:', duplicateCandidates: 2 } }, { trigger: 'health.interval' });
    const incomplete = runDownloadGuardEngine({ ...facts, download: { ...facts.download, partial: true, destinationMount: 'E:' } }, { trigger: 'health.interval' });
    const insufficient = runDownloadGuardEngine({ ...facts, storage: [{ mount: 'C:', freeBytes: 1, totalBytes: 2, system: true }], download: { sizeBytes: 10 } }, { trigger: 'health.interval' });
    const unknown = runDownloadGuardEngine({ engine: 'download-guard-input', storage: [{ mount: 'C:', freeBytes: 10, totalBytes: 20 }], download: { name: 'unknown' } }, { trigger: 'system.facts.request' });
    expect(protectedTarget.state).toBe('protected-target'); expect(duplicate.state).toBe('duplicate-review'); expect(incomplete.state).toBe('incomplete-review'); expect(insufficient.state).toBe('storage-safety-review'); expect(unknown.state).toBe('observation-required');
    expect(unknown.targetMount).toBe(null); expect(unknown.hashStatus).toBe('missing');
    const pressureFallback = runDownloadGuardEngine({ engine: 'system-facts', storagePressure: { mount: '/', freeBytes: 10, totalBytes: 20 }, download: { sizeBytes: 1 } }, { trigger: 'system.facts.request' });
    expect(pressureFallback.systemMount).toBe('/');
    const exactProtected = runDownloadGuardEngine({ engine: 'system-facts', storage: [{ mount: 'E:', freeBytes: 2 * 1024 ** 3, totalBytes: 3 * 1024 ** 3 }], download: { sizeBytes: 1, path: 'E:/Projects' }, protectedPaths: ['E:/Projects'] }, { trigger: 'health.interval' });
    const fallbackSystem = runDownloadGuardEngine({ engine: 'system-facts', storage: [{ mount: 'C:', freeBytes: 2 * 1024 ** 3, totalBytes: 3 * 1024 ** 3 }], download: { sizeBytes: 1 } }, { trigger: 'health.interval' });
    const fallbackNone = runDownloadGuardEngine({ engine: 'system-facts', storage: [{ mount: 'D:', freeBytes: 1, totalBytes: 2 }], download: { sizeBytes: 1 } }, { trigger: 'health.interval' });
    const sortedCandidates = runDownloadGuardEngine({ engine: 'system-facts', storage: [{ mount: 'E:', freeBytes: 2 * 1024 ** 3, totalBytes: 3 * 1024 ** 3 }, { mount: 'F:', freeBytes: 3 * 1024 ** 3, totalBytes: 4 * 1024 ** 3 }], safetyMarginBytes: 0, download: { sizeBytes: 1 } }, { trigger: 'health.interval' });
    const untrustedRows = runDownloadGuardEngine({ engine: 'system-facts', storage: [{}, { mount: 'F:', freeBytes: 2 * 1024 ** 3, totalBytes: 3 * 1024 ** 3, writable: false }, { mount: 'G:', freeBytes: 2 * 1024 ** 3, totalBytes: 3 * 1024 ** 3, protected: true }], safetyMarginBytes: 0, download: { sizeBytes: 1 } }, { trigger: 'health.interval' });
    const allowNoHash = runDownloadGuardEngine({ engine: 'system-facts', storage: [{ mount: 'E:', freeBytes: 10, totalBytes: 20 }], safetyMarginBytes: 0, download: { sizeBytes: 1, destinationMount: 'E:' } }, { trigger: 'health.interval' });
    const redirectNoHash = runDownloadGuardEngine({ engine: 'system-facts', storage: [{ mount: 'C:', freeBytes: 1, totalBytes: 2 }, { mount: 'E:', freeBytes: 10, totalBytes: 20 }], safetyMarginBytes: 0, download: { sizeBytes: 2, destinationMount: 'C:' } }, { trigger: 'health.interval' });
    expect(exactProtected.state).toBe('protected-target'); expect(fallbackSystem.state).toBe('storage-safety-review'); expect(fallbackNone.state).toBe('storage-safety-review'); expect(sortedCandidates.targetMount).toBe(null); expect(untrustedRows.state).toBe('storage-safety-review'); expect(allowNoHash.state).toBe('storage-safety-review'); expect(redirectNoHash.state).toBe('storage-safety-review');
    expect(runDownloadGuardEngine({ engine: 'system-facts', download: {}, safetyMarginBytes: -1 }, { trigger: 'health.interval' }).state).toBe('observation-required');
    expect(runDownloadGuardEngine({ engine: 'system-facts', storage: [], storagePressure: {}, download: {} }, { trigger: 'health.interval' }).state).toBe('observation-required');
    expect(runDownloadGuardEngine({ engine: 'system-facts', storage: [{ mount: 'D:', freeBytes: 2, totalBytes: 4 }] }, { trigger: 'health.interval' }).state).toBe('observation-required');
  });

  test('merges reports and keeps target changes approval-bound', () => {
    const allowed = runDownloadGuardEngine({ ...facts, download: { ...facts.download, destinationMount: 'E:', sizeBytes: 1 } }, { trigger: 'health.interval' });
    const review = runDownloadGuardEngine({ ...facts, download: { ...facts.download, destinationMount: 'E:', duplicateCandidates: 1 } }, { trigger: 'health.interval' });
    expect(DOWNLOAD_GUARD_LIBRARY_ID).toBe('download-guard-library');
    expect(mergeDownloadGuardReports([]).state).toBe('observation-required');
    expect(mergeDownloadGuardReports([allowed, review])).toMatchObject({ state: 'duplicate-review', targetMount: 'e:' });
    expect(mergeDownloadGuardReports([allowed]).state).toBe('allow');
    expect(mergeDownloadGuardReports([{ ...allowed, targetMount: '', recommendations: [] }])).toMatchObject({ targetMount: null, recommendations: [] });
    expect(buildDownloadGuardPlan(allowed, 'interactive')).toMatchObject({ mode: 'approval-ready', targetMount: 'e:' });
    expect(buildDownloadGuardPlan(review, 'interactive').mode).toBe('review-required');
    expect(buildDownloadGuardPlan(allowed).mode).toBe('profile-required');
    expect(buildDownloadGuardPlan(review, 'other').mode).toBe('profile-required');
    expect(buildDownloadGuardEnvelope(allowed, { trigger: 'health.interval', now: () => 0 }).generatedAt).toContain('1970');
    expect(createDownloadGuardLibrary().merge([allowed]).state).toBe('allow');
    expect(() => mergeDownloadGuardReports()).toThrow('reports must be an array');
    expect(() => mergeDownloadGuardReports([null])).toThrow('report must be an object');
    expect(() => mergeDownloadGuardReports([[]])).toThrow('report must be an object');
    try { mergeDownloadGuardReports(null); } catch (error) { expect(error.message).toContain('reports must be an array'); }
    expect(() => mergeDownloadGuardReports([{}])).toThrow('requires a download-guard report');
    expect(() => mergeDownloadGuardReports([report('bad')])).toThrow('invalid state');
    expect(() => mergeDownloadGuardReports([report('allow', { recommendations: null })])).toThrow('recommendations');
    expect(() => mergeDownloadGuardReports(Array.from({ length: 65 }, () => allowed))).toThrow('at most 64');
    try { mergeDownloadGuardReports(Array.from({ length: 65 }, () => allowed)); } catch (error) { expect(error.message).toContain('at most 64'); }
    expect(() => buildDownloadGuardPlan({})).toThrow('requires a download-guard report');
    expect(() => buildDownloadGuardEnvelope(allowed)).toThrow('trigger');
    expect(() => buildDownloadGuardEnvelope(allowed, { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeDownloadGuardReports(Array.from({ length: 65 }, () => allowed))).toThrow('at most 64');
    expect(() => runDownloadGuardEngine(null, { trigger: 'health.interval' })).toThrow('facts must be an object');
    expect(() => runDownloadGuardEngine({ engine: 'wrong' }, { trigger: 'health.interval' })).toThrow('requires system-facts');
    expect(() => runDownloadGuardEngine(facts, { trigger: 'bad' })).toThrow('Unsupported download-guard trigger');
    expect(() => runDownloadGuardEngine()).toThrow('unknown');
    expect(() => runDownloadGuardEngine(facts, { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
  });
});

describe('download-guard turbos and libraries', () => {
  test('preflights space and chooses a destination', () => {
    const enough = runDownloadGuardSpacePreflightTurbo([{ downloadSizeBytes: 5, storage: [{ ...storage[1], freeBytes: 20 }], drives }], { trigger: 'install.preflight', safetyMarginBytes: 1, now: () => 0 });
    const shortfall = runDownloadGuardSpacePreflightTurbo([{ downloadSizeBytes: 50, storage: [{ ...storage[0], freeBytes: 2 }], drives }], { trigger: 'health.interval' });
    const missing = runDownloadGuardSpacePreflightTurbo([{ storage: [] }], { trigger: 'health.interval' });
    const empty = runDownloadGuardSpacePreflightTurbo([], { trigger: 'health.interval' });
    const nested = runDownloadGuardSpacePreflightTurbo([{ download: { sizeBytes: 1 }, storage: [{ ...storage[1], freeBytes: 2 }], drives }], { trigger: 'health.interval', safetyMarginBytes: NaN });
    const noStorageField = runDownloadGuardSpacePreflightTurbo([{ downloadSizeBytes: 1 }], { trigger: 'health.interval' });
    const evidenceProvided = runDownloadGuardSpacePreflightTurbo([{ downloadSizeBytes: 1, hardFailureEvidence: [], drives, storage: [{ ...storage[1], freeBytes: 20, storageSuitability: { admission: 'ALLOW' } }] }], { trigger: 'health.interval', safetyMarginBytes: 0 });
    const noPrecomputedEvidence = runDownloadGuardSpacePreflightTurbo([{ downloadSizeBytes: 1, storage: [{ ...storage[1], freeBytes: 20 }], drives }], { trigger: 'health.interval', safetyMarginBytes: 0 });
    const rejectedStorage = runDownloadGuardSpacePreflightTurbo([{ downloadSizeBytes: 1, storage: [{ ...storage[1], health: 'degraded', freeBytes: 20 }], drives }], { trigger: 'health.interval', safetyMarginBytes: 0 });
    expect(enough.state).toBe('enough-space'); expect(shortfall.state).toBe('space-shortfall'); expect(missing.state).toBe('observation-required'); expect(empty.state).toBe('observation-required'); expect(noStorageField.state).toBe('observation-required');
    expect(nested.state).toBe('enough-space');
    expect(evidenceProvided.state).toBe('enough-space');
    expect(noPrecomputedEvidence.state).toBe('enough-space');
    expect(rejectedStorage.state).toBe('storage-safety-review');
    const spaceReport = (state, eligibleMounts = []) => turboReport('download-guard.space-preflight', state, { eligibleMounts });
    expect(mergeDownloadGuardSpacePreflightReports([]).state).toBe('observation-required');
    expect(mergeDownloadGuardSpacePreflightReports([spaceReport('enough-space', ['E:'])]).eligibleMounts).toEqual(['E:']);
    expect(mergeDownloadGuardSpacePreflightReports([spaceReport('space-shortfall'), spaceReport('enough-space')]).state).toBe('space-shortfall');
    expect(mergeDownloadGuardSpacePreflightReports([spaceReport('storage-safety-review')]).state).toBe('storage-safety-review');
    expect(buildDownloadGuardSpacePreflightPlan(spaceReport('enough-space'), 'interactive').mode).toBe('download-review');
    expect(buildDownloadGuardSpacePreflightPlan(spaceReport('space-shortfall'), 'interactive').mode).toBe('storage-review');
    expect(buildDownloadGuardSpacePreflightPlan(spaceReport('space-shortfall')).mode).toBe('profile-required');
    expect(buildDownloadGuardSpacePreflightPlan(spaceReport('space-shortfall'), 'other').mode).toBe('profile-required');
    expect(buildDownloadGuardSpacePreflightEnvelope(spaceReport('enough-space'), { trigger: 'health.interval', now: () => 0 }).library).toContain('space-preflight');
    expect(createDownloadGuardSpacePreflightLibrary().merge([spaceReport('enough-space')]).state).toBe('enough-space');
    expect(() => runDownloadGuardSpacePreflightTurbo({}, { trigger: 'health.interval' })).toThrow('samples');
    expect(() => runDownloadGuardSpacePreflightTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runDownloadGuardSpacePreflightTurbo()).toThrow('unknown');
    expect(() => runDownloadGuardSpacePreflightTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeDownloadGuardSpacePreflightReports([{}])).toThrow('requires a space-preflight');
    expect(() => mergeDownloadGuardSpacePreflightReports([[]])).toThrow('report must be an object');
    expect(() => mergeDownloadGuardSpacePreflightReports([null])).toThrow('report must be an object');
    try { mergeDownloadGuardSpacePreflightReports(null); } catch (error) { expect(error.message).toContain('reports must be an array'); }
    try { mergeDownloadGuardSpacePreflightReports(Array.from({ length: 65 }, () => spaceReport('enough-space'))); } catch (error) { expect(error.message).toContain('at most 64'); }
    expect(() => mergeDownloadGuardSpacePreflightReports([spaceReport('bad')])).toThrow('invalid state');
    expect(() => mergeDownloadGuardSpacePreflightReports([spaceReport('enough-space', null)])).toThrow('requires eligibleMounts');
    expect(() => buildDownloadGuardSpacePreflightEnvelope(spaceReport('enough-space'))).toThrow('trigger');
    expect(() => buildDownloadGuardSpacePreflightEnvelope(spaceReport('enough-space'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeDownloadGuardSpacePreflightReports(Array.from({ length: 65 }, () => spaceReport('enough-space')))).toThrow('at most 64');
    const selected = runDownloadGuardDestinationSelectionTurbo([{ targetMount: 'E:', redirected: true, targetSuitability: { admission: 'ALLOW' } }], { trigger: 'health.interval', now: () => 0 });
    const none = runDownloadGuardDestinationSelectionTurbo([{ redirected: false }], { trigger: 'system.facts.request' });
    const emptyTarget = runDownloadGuardDestinationSelectionTurbo([], { trigger: 'health.interval' });
    const selectedNoRedirect = runDownloadGuardDestinationSelectionTurbo([{ targetMount: 'C:', redirected: false, targetSuitability: { admission: 'ALLOW' } }], { trigger: 'health.interval' });
    const emptyMount = runDownloadGuardDestinationSelectionTurbo([{ targetMount: '', redirected: false }], { trigger: 'health.interval' });
    const observedWithoutPrecomputedEvidence = runDownloadGuardDestinationSelectionTurbo([{ targetMount: 'E:', redirected: false, storage: [], drives: [], hardFailureEvidence: [] }], { trigger: 'health.interval' });
    const observedWithoutFields = runDownloadGuardDestinationSelectionTurbo([{ targetMount: 'E:', redirected: false }], { trigger: 'health.interval' });
    expect(selected.state).toBe('redirect-required'); expect(none.state).toBe('observation-required'); expect(emptyTarget.state).toBe('observation-required'); expect(emptyMount.state).toBe('observation-required');
    expect(selectedNoRedirect.state).toBe('destination-selected');
    expect(observedWithoutPrecomputedEvidence.state).toBe('storage-safety-review');
    expect(observedWithoutFields.state).toBe('storage-safety-review');
    const destinationReport = (state, finalTarget = null, redirectedCount = 0) => turboReport('download-guard.destination-selection', state, { finalTarget, redirectedCount });
    expect(mergeDownloadGuardDestinationSelectionReports([]).state).toBe('observation-required');
    expect(mergeDownloadGuardDestinationSelectionReports([destinationReport('destination-selected', 'E:')]).finalTarget).toBe('E:');
    expect(mergeDownloadGuardDestinationSelectionReports([destinationReport('redirect-required', 'E:', 1)]).state).toBe('redirect-required');
    expect(mergeDownloadGuardDestinationSelectionReports([destinationReport('storage-safety-review')]).state).toBe('storage-safety-review');
    expect(buildDownloadGuardDestinationSelectionPlan(destinationReport('redirect-required', 'E:'), 'interactive').mode).toBe('approval-required');
    expect(buildDownloadGuardDestinationSelectionPlan(destinationReport('destination-selected', 'E:'), 'interactive').mode).toBe('destination-review');
    expect(buildDownloadGuardDestinationSelectionPlan(destinationReport('destination-selected', 'E:')).mode).toBe('profile-required');
    expect(buildDownloadGuardDestinationSelectionPlan(destinationReport('destination-selected'), 'other').mode).toBe('profile-required');
    expect(buildDownloadGuardDestinationSelectionEnvelope(destinationReport('destination-selected'), { trigger: 'health.interval', now: () => 0 }).library).toContain('destination-selection');
    expect(createDownloadGuardDestinationSelectionLibrary().merge([destinationReport('destination-selected')]).state).toBe('destination-selected');
    expect(() => runDownloadGuardDestinationSelectionTurbo({}, { trigger: 'health.interval' })).toThrow('samples');
    expect(() => runDownloadGuardDestinationSelectionTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runDownloadGuardDestinationSelectionTurbo()).toThrow('unknown');
    expect(() => runDownloadGuardDestinationSelectionTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeDownloadGuardDestinationSelectionReports([{}])).toThrow('requires a destination-selection');
    expect(() => mergeDownloadGuardDestinationSelectionReports([[]])).toThrow('report must be an object');
    expect(() => mergeDownloadGuardDestinationSelectionReports([null])).toThrow('report must be an object');
    try { mergeDownloadGuardDestinationSelectionReports(Array.from({ length: 65 }, () => destinationReport('destination-selected'))); } catch (error) { expect(error.message).toContain('at most 64'); }
    try { mergeDownloadGuardDestinationSelectionReports(null); } catch (error) { expect(error.message).toContain('reports must be an array'); }
    expect(() => mergeDownloadGuardDestinationSelectionReports([destinationReport('bad')])).toThrow('invalid state');
    expect(() => mergeDownloadGuardDestinationSelectionReports([destinationReport('destination-selected', 1)])).toThrow('finalTarget');
    expect(() => buildDownloadGuardDestinationSelectionEnvelope(destinationReport('destination-selected'))).toThrow('trigger');
    expect(() => buildDownloadGuardDestinationSelectionEnvelope(destinationReport('destination-selected'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeDownloadGuardDestinationSelectionReports(Array.from({ length: 65 }, () => destinationReport('destination-selected')))).toThrow('at most 64');
  });

  test('reviews duplicates and verifies hashes without destructive action', () => {
    const duplicates = runDownloadGuardDuplicateReviewTurbo([{ duplicateCandidates: 2 }], { trigger: 'health.interval', now: () => 0 });
    const hashReview = runDownloadGuardDuplicateReviewTurbo([{ duplicateCandidates: 0, hashStatus: 'missing' }], { trigger: 'system.facts.request' });
    const none = runDownloadGuardDuplicateReviewTurbo([{ duplicateCandidates: 0, hashStatus: 'available' }], { trigger: 'health.interval' });
    const empty = runDownloadGuardDuplicateReviewTurbo([], { trigger: 'health.interval' });
    const invalidSample = runDownloadGuardDuplicateReviewTurbo([null, { duplicateCandidates: 0 }], { trigger: 'health.interval' });
    const invalidCount = runDownloadGuardDuplicateReviewTurbo([{ duplicateCandidates: -1 }], { trigger: 'health.interval' });
    expect(duplicates.state).toBe('duplicates-found'); expect(hashReview.state).toBe('hash-review'); expect(none.state).toBe('no-duplicates'); expect(empty.state).toBe('insufficient-data');
    expect(invalidSample.state).toBe('no-duplicates'); expect(invalidCount.state).toBe('no-duplicates');
    const duplicateReport = (state, duplicateCount) => turboReport('download-guard.duplicate-review', state, { duplicateCount });
    expect(mergeDownloadGuardDuplicateReviewReports([]).state).toBe('insufficient-data');
    expect(mergeDownloadGuardDuplicateReviewReports([duplicateReport('no-duplicates', 0)]).state).toBe('no-duplicates');
    expect(mergeDownloadGuardDuplicateReviewReports([duplicateReport('hash-review', 0)]).state).toBe('hash-review');
    expect(mergeDownloadGuardDuplicateReviewReports([duplicateReport('duplicates-found', 2)]).duplicateCount).toBe(2);
    expect(buildDownloadGuardDuplicateReviewPlan(duplicateReport('duplicates-found', 1), 'interactive').mode).toBe('duplicate-review');
    expect(buildDownloadGuardDuplicateReviewPlan(duplicateReport('no-duplicates', 0), 'interactive').mode).toBe('observation-only');
    expect(buildDownloadGuardDuplicateReviewPlan(duplicateReport('no-duplicates', 0)).mode).toBe('profile-required');
    expect(buildDownloadGuardDuplicateReviewPlan(duplicateReport('no-duplicates', 0), 'other').mode).toBe('profile-required');
    expect(buildDownloadGuardDuplicateReviewEnvelope(duplicateReport('no-duplicates', 0), { trigger: 'health.interval', now: () => 0 }).library).toContain('duplicate-review');
    expect(createDownloadGuardDuplicateReviewLibrary().merge([duplicateReport('no-duplicates', 0)]).state).toBe('no-duplicates');
    expect(() => runDownloadGuardDuplicateReviewTurbo({}, { trigger: 'health.interval' })).toThrow('samples');
    expect(() => runDownloadGuardDuplicateReviewTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runDownloadGuardDuplicateReviewTurbo()).toThrow('unknown');
    expect(() => runDownloadGuardDuplicateReviewTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeDownloadGuardDuplicateReviewReports([{}])).toThrow('requires a duplicate-review');
    expect(() => mergeDownloadGuardDuplicateReviewReports([[]])).toThrow('report must be an object');
    expect(() => mergeDownloadGuardDuplicateReviewReports([null])).toThrow('report must be an object');
    try { mergeDownloadGuardDuplicateReviewReports(null); } catch (error) { expect(error.message).toContain('reports must be an array'); }
    try { mergeDownloadGuardDuplicateReviewReports(Array.from({ length: 65 }, () => duplicateReport('no-duplicates', 0))); } catch (error) { expect(error.message).toContain('at most 64'); }
    expect(() => mergeDownloadGuardDuplicateReviewReports([duplicateReport('bad', 0)])).toThrow('invalid state');
    expect(() => mergeDownloadGuardDuplicateReviewReports([duplicateReport('no-duplicates', -1)])).toThrow('duplicateCount');
    expect(() => buildDownloadGuardDuplicateReviewEnvelope(duplicateReport('no-duplicates', 0))).toThrow('trigger');
    expect(() => buildDownloadGuardDuplicateReviewEnvelope(duplicateReport('no-duplicates', 0), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeDownloadGuardDuplicateReviewReports(Array.from({ length: 65 }, () => duplicateReport('no-duplicates', 0)))).toThrow('at most 64');
    const verified = runDownloadGuardHashVerificationTurbo([{ expectedSha256: hash, observedSha256: hash }], { trigger: 'health.interval', now: () => 0 });
    const mismatch = runDownloadGuardHashVerificationTurbo([{ expectedSha256: hash, observedSha256: 'b'.repeat(64) }], { trigger: 'workload.changed' });
    const unavailable = runDownloadGuardHashVerificationTurbo([{ expectedSha256: 'bad' }], { trigger: 'system.facts.request' });
    const invalidObserved = runDownloadGuardHashVerificationTurbo([{ expectedSha256: hash, observedSha256: 'bad' }], { trigger: 'system.facts.request' });
    const noHash = runDownloadGuardHashVerificationTurbo([], { trigger: 'health.interval' });
    const caseInsensitive = runDownloadGuardHashVerificationTurbo([{ expectedSha256: hash.toUpperCase(), observedSha256: hash }], { trigger: 'health.interval' });
    expect(verified.state).toBe('verified'); expect(mismatch.state).toBe('mismatch'); expect(unavailable.state).toBe('unavailable'); expect(invalidObserved.state).toBe('unavailable'); expect(noHash.state).toBe('insufficient-data');
    expect(caseInsensitive.state).toBe('verified');
    const hashReport = (state, mismatchCount) => turboReport('download-guard.hash-verification', state, { mismatchCount });
    expect(mergeDownloadGuardHashVerificationReports([]).state).toBe('insufficient-data');
    expect(mergeDownloadGuardHashVerificationReports([hashReport('unavailable', 0)]).state).toBe('unavailable');
    expect(mergeDownloadGuardHashVerificationReports([hashReport('verified', 0)]).state).toBe('verified');
    expect(mergeDownloadGuardHashVerificationReports([hashReport('mismatch', 1)]).state).toBe('mismatch');
    expect(buildDownloadGuardHashVerificationPlan(hashReport('mismatch', 1), 'interactive').mode).toBe('refuse-download');
    expect(buildDownloadGuardHashVerificationPlan(hashReport('verified', 0), 'interactive').mode).toBe('integrity-review');
    expect(buildDownloadGuardHashVerificationPlan(hashReport('verified', 0)).mode).toBe('profile-required');
    expect(buildDownloadGuardHashVerificationPlan(hashReport('verified', 0), 'other').mode).toBe('profile-required');
    expect(buildDownloadGuardHashVerificationEnvelope(hashReport('verified', 0), { trigger: 'health.interval', now: () => 0 }).library).toContain('hash-verification');
    expect(createDownloadGuardHashVerificationLibrary().merge([hashReport('verified', 0)]).state).toBe('verified');
    expect(() => runDownloadGuardHashVerificationTurbo({}, { trigger: 'health.interval' })).toThrow('samples');
    expect(() => runDownloadGuardHashVerificationTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runDownloadGuardHashVerificationTurbo()).toThrow('unknown');
    expect(() => runDownloadGuardHashVerificationTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeDownloadGuardHashVerificationReports([{}])).toThrow('requires a hash-verification');
    expect(() => mergeDownloadGuardHashVerificationReports([[]])).toThrow('report must be an object');
    expect(() => mergeDownloadGuardHashVerificationReports([null])).toThrow('report must be an object');
    try { mergeDownloadGuardHashVerificationReports(null); } catch (error) { expect(error.message).toContain('reports must be an array'); }
    try { mergeDownloadGuardHashVerificationReports(Array.from({ length: 65 }, () => hashReport('verified', 0))); } catch (error) { expect(error.message).toContain('at most 64'); }
    expect(() => mergeDownloadGuardHashVerificationReports([hashReport('bad', 0)])).toThrow('invalid state');
    expect(() => mergeDownloadGuardHashVerificationReports([hashReport('verified', -1)])).toThrow('mismatchCount');
    expect(() => buildDownloadGuardHashVerificationEnvelope(hashReport('verified', 0))).toThrow('trigger');
    expect(() => buildDownloadGuardHashVerificationEnvelope(hashReport('verified', 0), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeDownloadGuardHashVerificationReports(Array.from({ length: 65 }, () => hashReport('verified', 0)))).toThrow('at most 64');
  });
});
