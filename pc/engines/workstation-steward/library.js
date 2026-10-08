/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 *
 * Workstation-steward library. It combines bounded reports and exposes an
 * approval plan without applying any operating-system or file action.
 */

export const WORKSTATION_STEWARD_LIBRARY_ID = 'workstation-steward-library';
export const WORKSTATION_STEWARD_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['plan-ready', 'observation-required']);
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function requireReport(report) { if (!record(report)) throw new TypeError('Workstation-steward library report must be an object'); if (report.engine !== 'workstation-steward') throw new Error('Workstation-steward library requires a workstation-steward report'); if (!STATES.includes(report.state)) throw new Error('Workstation-steward library report has an invalid state'); if (!Array.isArray(report.actions)) throw new TypeError('Workstation-steward library report requires actions'); return report; }
function requireReports(reports) { if (!Array.isArray(reports)) throw new TypeError('Workstation-steward library reports must be an array'); if (reports.length > 64) throw new RangeError('Workstation-steward library accepts at most 64 reports'); return Object.freeze(reports.map(requireReport)); }
function requireClock(now) { const timestamp = now(); if (!Number.isFinite(timestamp)) throw new TypeError('Workstation-steward library clock must return a number'); return timestamp; }
export function mergeWorkstationStewardReports(reports) { const validated = requireReports(reports); const latest = validated.at(-1) || null; const state = validated.some((item) => item.state === 'plan-ready') ? 'plan-ready' : 'observation-required'; const games = validated.filter((item) => item.game?.detected).length; const recovered = validated.reduce((sum, item) => sum + (Number.isFinite(item.cleanup?.recoveredBytes) ? item.cleanup.recoveredBytes : 0), 0); return Object.freeze({ library: WORKSTATION_STEWARD_LIBRARY_ID, libraryVersion: WORKSTATION_STEWARD_LIBRARY_VERSION, reportCount: validated.length, state, gameReports: games, cleanupRecoveredBytes: recovered, latestGeneratedAt: latest?.generatedAt || null, protectedPaths: Object.freeze([...new Set(validated.flatMap((item) => item.protectedPaths || []))]) }); }
export function buildWorkstationStewardPlan(report, environment = 'unknown') { const validated = requireReport(report); const normalized = ['interactive', 'headless'].includes(environment) ? environment : 'unknown'; return Object.freeze({ library: WORKSTATION_STEWARD_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : validated.state === 'plan-ready' ? 'approval-review' : 'evidence-collection', enforcement: 'native-capability-review', actions: Object.freeze([]) }); }
export function buildWorkstationStewardEnvelope(report, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('Workstation-steward library trigger is required'); return Object.freeze({ library: WORKSTATION_STEWARD_LIBRARY_ID, libraryVersion: WORKSTATION_STEWARD_LIBRARY_VERSION, trigger, generatedAt: new Date(requireClock(now)).toISOString(), report: requireReport(report) }); }
export function createWorkstationStewardLibrary() { return Object.freeze({ id: WORKSTATION_STEWARD_LIBRARY_ID, version: WORKSTATION_STEWARD_LIBRARY_VERSION, merge: mergeWorkstationStewardReports, plan: buildWorkstationStewardPlan, envelope: buildWorkstationStewardEnvelope }); }
