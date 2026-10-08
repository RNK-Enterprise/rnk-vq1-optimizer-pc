/**
 * RNK Vortex System Optimizer
 * Contributor: Lisa's Dungeon
 * Media-assistant turbo library.
 */

export const WORKSTATION_STEWARD_MEDIA_ASSISTANT_LIBRARY_ID = 'workstation-steward.media-assistant.library';
export const WORKSTATION_STEWARD_MEDIA_ASSISTANT_LIBRARY_VERSION = 1;
const STATES = Object.freeze(['observation-required', 'review-ready']);
function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function report(value) { if (!record(value)) throw new TypeError('Media-assistant library report must be an object'); if (value.turbo !== 'workstation-steward.media-assistant') throw new Error('Media-assistant library requires a media-assistant report'); if (!STATES.includes(value.state)) throw new Error('Media-assistant library report has an invalid state'); if (!Array.isArray(value.actionHistory)) throw new TypeError('Media-assistant library report requires action history'); return value; }
function reports(values) { if (!Array.isArray(values)) throw new TypeError('Media-assistant library reports must be an array'); if (values.length > 64) throw new RangeError('Media-assistant library accepts at most 64 reports'); return values.map(report); }
function clock(now) { const value = now(); if (!Number.isFinite(value)) throw new TypeError('Media-assistant library clock must return a number'); return value; }
export function mergeWorkstationStewardMediaAssistantReports(values) { const checked = reports(values); return Object.freeze({ library: WORKSTATION_STEWARD_MEDIA_ASSISTANT_LIBRARY_ID, libraryVersion: 1, reportCount: checked.length, state: checked.some((item) => item.state === 'review-ready') ? 'review-ready' : 'observation-required', mediaCount: checked.at(-1)?.mediaCount || 0, actionCount: checked.reduce((sum, item) => sum + item.actionHistory.length, 0), queryIntents: Object.freeze([...new Set(checked.map((item) => item.intent).filter((item) => item && item !== 'unknown'))]) }); }
export function buildWorkstationStewardMediaAssistantPlan(value, environment = 'unknown') { const checked = report(value); const normalized = ['interactive', 'headless'].includes(environment) ? environment : 'unknown'; return Object.freeze({ library: WORKSTATION_STEWARD_MEDIA_ASSISTANT_LIBRARY_ID, environment: normalized, mode: normalized === 'unknown' ? 'profile-required' : checked.state === 'review-ready' ? 'approval-review' : 'catalogue-observation', actions: Object.freeze([]) }); }
export function buildWorkstationStewardMediaAssistantEnvelope(value, { trigger, now = Date.now } = {}) { if (typeof trigger !== 'string' || !trigger) throw new TypeError('Media-assistant library trigger is required'); return Object.freeze({ library: WORKSTATION_STEWARD_MEDIA_ASSISTANT_LIBRARY_ID, libraryVersion: 1, trigger, generatedAt: new Date(clock(now)).toISOString(), report: report(value) }); }
export function createWorkstationStewardMediaAssistantLibrary() { return Object.freeze({ id: WORKSTATION_STEWARD_MEDIA_ASSISTANT_LIBRARY_ID, version: 1, merge: mergeWorkstationStewardMediaAssistantReports, plan: buildWorkstationStewardMediaAssistantPlan, envelope: buildWorkstationStewardMediaAssistantEnvelope }); }
