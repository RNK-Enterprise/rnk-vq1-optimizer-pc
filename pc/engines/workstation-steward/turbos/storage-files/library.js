/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 * Storage-files turbo library.
 */

export const WORKSTATION_STEWARD_STORAGE_FILES_LIBRARY_ID = 'workstation-steward.storage-files.library';
export const WORKSTATION_STEWARD_STORAGE_FILES_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['observation-required', 'observation-review', 'evidence-ready', 'placement-review', 'duplicate-review', 'incomplete-review']);
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function report(value) { if (!record(value)) throw new TypeError('Storage-files library report must be an object'); if (value.turbo !== 'workstation-steward.storage-files') throw new Error('Storage-files library requires a storage-files report'); if (!STATES.includes(value.state)) throw new Error('Storage-files library report has an invalid state'); if (!Array.isArray(value.placements)) throw new TypeError('Storage-files library report requires placements'); return value; }
function reports(values) { if (!Array.isArray(values)) throw new TypeError('Storage-files library reports must be an array'); if (values.length > 64) throw new RangeError('Storage-files library accepts at most 64 reports'); return values.map(report); }
function priority(state) { return { 'incomplete-review': 6, 'duplicate-review': 5, 'placement-review': 4, 'evidence-ready': 3, 'observation-review': 2, 'observation-required': 1 }[state]; }
function clock(now) { const value = now(); if (!Number.isFinite(value)) throw new TypeError('Storage-files library clock must return a number'); return value; }
export function mergeWorkstationStewardStorageFilesReports(values) { const checked = reports(values); const state = checked.reduce((winner, item) => priority(item.state) > priority(winner) ? item.state : winner, 'observation-required'); return Object.freeze({ library: WORKSTATION_STEWARD_STORAGE_FILES_LIBRARY_ID, libraryVersion: 1, reportCount: checked.length, state, duplicateGroupCount: checked.reduce((sum, item) => sum + item.duplicates.length, 0), incompleteCount: checked.reduce((sum, item) => sum + item.incomplete.length, 0), placementCount: checked.reduce((sum, item) => sum + item.placements.length, 0), benchmarked: checked.some((item) => item.benchmarked === true) }); }
export function buildWorkstationStewardStorageFilesPlan(value, environment = 'unknown') { const checked = report(value); const normalized = ['interactive', 'headless'].includes(environment) ? environment : 'unknown'; return Object.freeze({ library: WORKSTATION_STEWARD_STORAGE_FILES_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : checked.state === 'observation-required' ? 'evidence-collection' : 'review-before-file-change', actions: Object.freeze([]) }); }
export function buildWorkstationStewardStorageFilesEnvelope(value, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('Storage-files library trigger is required'); return Object.freeze({ library: WORKSTATION_STEWARD_STORAGE_FILES_LIBRARY_ID, libraryVersion: 1, trigger, generatedAt: new Date(clock(now)).toISOString(), report: report(value) }); }
export function createWorkstationStewardStorageFilesLibrary() { return Object.freeze({ id: WORKSTATION_STEWARD_STORAGE_FILES_LIBRARY_ID, version: 1, merge: mergeWorkstationStewardStorageFilesReports, plan: buildWorkstationStewardStorageFilesPlan, envelope: buildWorkstationStewardStorageFilesEnvelope }); }
