/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 * Resource-governance turbo library.
 */

export const WORKSTATION_STEWARD_RESOURCE_GOVERNANCE_LIBRARY_ID = 'workstation-steward.resource-governance.library';
export const WORKSTATION_STEWARD_RESOURCE_GOVERNANCE_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['insufficient-data', 'observation-required', 'stable', 'game-observed', 'budget-review', 'enforcement-review']);
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function report(value) { if (!record(value)) throw new TypeError('Resource-governance library report must be an object'); if (value.turbo !== 'workstation-steward.resource-governance') throw new Error('Resource-governance library requires a resource-governance report'); if (!STATES.includes(value.state)) throw new Error('Resource-governance library report has an invalid state'); if (!Array.isArray(value.actions)) throw new TypeError('Resource-governance library report requires actions'); return value; }
function reports(values) { if (!Array.isArray(values)) throw new TypeError('Resource-governance library reports must be an array'); if (values.length > 64) throw new RangeError('Resource-governance library accepts at most 64 reports'); return values.map(report); }
function priority(state) { return { 'enforcement-review': 6, 'budget-review': 5, 'game-observed': 4, 'observation-required': 3, 'stable': 2, 'insufficient-data': 1 }[state]; }
function clock(now) { const value = now(); if (!Number.isFinite(value)) throw new TypeError('Resource-governance library clock must return a number'); return value; }
export function mergeWorkstationStewardResourceGovernanceReports(values) { const checked = reports(values); const state = checked.reduce((winner, item) => priority(item.state) > priority(winner) ? item.state : winner, 'insufficient-data'); return Object.freeze({ library: WORKSTATION_STEWARD_RESOURCE_GOVERNANCE_LIBRARY_ID, libraryVersion: 1, reportCount: checked.length, state, pressuredProcessIds: Object.freeze([...new Set(checked.flatMap((item) => item.pressuredProcessIds || []))]), gameDetected: checked.map((item) => item.gameDetected).includes(true), actionCount: checked.reduce((sum, item) => sum + item.actions.length, 0) }); }
export function buildWorkstationStewardResourceGovernancePlan(value, environment = 'unknown') { const checked = report(value); const normalized = ['interactive', 'headless'].includes(environment) ? environment : 'unknown'; return Object.freeze({ library: WORKSTATION_STEWARD_RESOURCE_GOVERNANCE_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : checked.state === 'enforcement-review' ? 'approval-required' : 'observation-review', actions: Object.freeze([]) }); }
export function buildWorkstationStewardResourceGovernanceEnvelope(value, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('Resource-governance library trigger is required'); return Object.freeze({ library: WORKSTATION_STEWARD_RESOURCE_GOVERNANCE_LIBRARY_ID, libraryVersion: 1, trigger, generatedAt: new Date(clock(now)).toISOString(), report: report(value) }); }
export function createWorkstationStewardResourceGovernanceLibrary() { return Object.freeze({ id: WORKSTATION_STEWARD_RESOURCE_GOVERNANCE_LIBRARY_ID, version: 1, merge: mergeWorkstationStewardResourceGovernanceReports, plan: buildWorkstationStewardResourceGovernancePlan, envelope: buildWorkstationStewardResourceGovernanceEnvelope }); }
