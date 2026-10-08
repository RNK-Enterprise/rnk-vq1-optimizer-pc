import { runWorkloadPolicyEngine, WORKLOAD_POLICY_ENGINE_ID, WORKLOAD_POLICY_TRIGGERS } from '../pc/engines/workload-policy/engine.js';
import { mergeWorkloadPolicyReports, buildWorkloadPolicyPlan, buildWorkloadPolicyEnvelope, createWorkloadPolicyLibrary, WORKLOAD_POLICY_LIBRARY_ID } from '../pc/engines/workload-policy/library.js';
import { runWorkloadPolicyModeSelectionTurbo } from '../pc/engines/workload-policy/turbos/mode-selection/turbo.js';
import { mergeWorkloadPolicyModeSelectionReports, buildWorkloadPolicyModeSelectionPlan, buildWorkloadPolicyModeSelectionEnvelope, createWorkloadPolicyModeSelectionLibrary } from '../pc/engines/workload-policy/turbos/mode-selection/library.js';
import { runWorkloadPolicyResourceBudgetTurbo } from '../pc/engines/workload-policy/turbos/resource-budget/turbo.js';
import { mergeWorkloadPolicyResourceBudgetReports, buildWorkloadPolicyResourceBudgetPlan, buildWorkloadPolicyResourceBudgetEnvelope, createWorkloadPolicyResourceBudgetLibrary } from '../pc/engines/workload-policy/turbos/resource-budget/library.js';
import { runWorkloadPolicyForegroundProtectionTurbo } from '../pc/engines/workload-policy/turbos/foreground-protection/turbo.js';
import { mergeWorkloadPolicyForegroundProtectionReports, buildWorkloadPolicyForegroundProtectionPlan, buildWorkloadPolicyForegroundProtectionEnvelope, createWorkloadPolicyForegroundProtectionLibrary } from '../pc/engines/workload-policy/turbos/foreground-protection/library.js';
import { runWorkloadPolicyRestorePlanTurbo } from '../pc/engines/workload-policy/turbos/restore-plan/turbo.js';
import { mergeWorkloadPolicyRestorePlanReports, buildWorkloadPolicyRestorePlan, buildWorkloadPolicyRestorePlanEnvelope, createWorkloadPolicyRestorePlanLibrary } from '../pc/engines/workload-policy/turbos/restore-plan/library.js';

const base = { engine: 'system-facts', environment: 'interactive', workload: { activeClasses: ['gaming', 'development'], foregroundClass: 'game', latencySensitive: true } };
const report = (turbo, state, fields = {}) => ({ turbo, state, ...fields });
const modeReport = (state, finalMode = 'developer') => report('workload-policy.mode-selection', state, { finalMode, confidence: 1 });
const budgetReport = (state, violations = []) => report('workload-policy.resource-budget', state, { violations });
const foregroundReport = (state, gamingCount = 1, protectedCount = 1) => report('workload-policy.foreground-protection', state, { gamingCount, protectedCount });
const restoreReport = (state, restoreActions = []) => report('workload-policy.restore-plan', state, { restoreActions });

describe('workload-policy engine and library', () => {
  test('builds developer, gaming-build, and idle plans with safe defaults', () => {
    expect(WORKLOAD_POLICY_ENGINE_ID).toBe('workload-policy');
    expect(WORKLOAD_POLICY_TRIGGERS).toEqual(['install.preflight', 'system.facts.request', 'workload.changed', 'health.interval']);
    const hybrid = runWorkloadPolicyEngine({ ...base, budget: { cpuPercent: 60, memoryBytes: 1024, ioBytesPerSecond: -1, gpuPercent: 120 }, protectedWorkloads: ['WSL', 'models'] }, { trigger: 'workload.changed', now: () => 0 });
    expect(hybrid).toMatchObject({ mode: 'gaming-build', state: 'plan-ready', foregroundClass: 'game', latencySensitive: true, budget: { source: 'user' }, foregroundProtection: { foreground: 'latency-sensitive', restore: 'on-game-exit' } });
    expect(hybrid.budget.requested).toMatchObject({ cpuPercent: 60, memoryBytes: 1024, ioBytesPerSecond: null, gpuPercent: 100 });
    const developer = runWorkloadPolicyEngine({ engine: 'workload-policy-input', workload: { activeClasses: ['AI'] } }, { trigger: 'system.facts.request' });
    expect(developer).toMatchObject({ mode: 'developer', state: 'plan-ready', foregroundProtection: { background: 'cooperative' } });
    const gaming = runWorkloadPolicyEngine({ ...base, mode: 'gaming', workload: { activeClasses: [], foregroundClass: 'game' } }, { trigger: 'health.interval' });
    expect(gaming).toMatchObject({ mode: 'gaming', budget: { recommended: { cpuPercent: 20 } }, foregroundProtection: { restore: 'on-game-exit' } });
    const idle = runWorkloadPolicyEngine({ ...base, workload: { activeClasses: ['media'] } }, { trigger: 'install.preflight' });
    expect(idle).toMatchObject({ mode: 'idle', foregroundProtection: { background: 'observe' } });
    const inferredGaming = runWorkloadPolicyEngine({ engine: 'system-facts', workload: { activeClasses: ['gaming'] } }, { trigger: 'health.interval' });
    const resourceBudget = runWorkloadPolicyEngine({ engine: 'system-facts', workload: { activeClasses: ['development'] }, resourceBudget: { cpuPercent: 20, memoryBytes: -1, ioBytesPerSecond: 3, gpuPercent: NaN } }, { trigger: 'health.interval' });
    expect(inferredGaming.mode).toBe('gaming'); expect(resourceBudget.budget.source).toBe('user');
  });

  test('fails closed for unknown or incomplete workload context', () => {
    const unknown = runWorkloadPolicyEngine({ engine: 'system-facts' }, { trigger: 'health.interval', now: () => 1 });
    expect(unknown).toMatchObject({ mode: 'unknown', state: 'observation-required', foregroundProtection: { restore: 'manual-review' }, recommendations: ['collect-workload-context'] });
    expect(() => runWorkloadPolicyEngine(null, { trigger: 'health.interval' })).toThrow('facts must be an object');
    expect(() => runWorkloadPolicyEngine({ engine: 'wrong' }, { trigger: 'health.interval' })).toThrow('requires system-facts');
    expect(() => runWorkloadPolicyEngine(base, { trigger: 'bad' })).toThrow('Unsupported workload-policy trigger');
    expect(() => runWorkloadPolicyEngine(base, { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => runWorkloadPolicyEngine(base)).toThrow('Unsupported workload-policy trigger: unknown');
  });

  test('merges reports and creates approval-bound envelopes', () => {
    const hybrid = runWorkloadPolicyEngine(base, { trigger: 'health.interval' });
    const unknown = runWorkloadPolicyEngine({ engine: 'workload-policy-input' }, { trigger: 'health.interval' });
    expect(WORKLOAD_POLICY_LIBRARY_ID).toBe('workload-policy-library');
    expect(mergeWorkloadPolicyReports([])).toMatchObject({ reportCount: 0, mode: 'unknown', state: 'observation-required' });
    expect(mergeWorkloadPolicyReports([unknown, hybrid])).toMatchObject({ mode: 'gaming-build', state: 'observation-required' });
    expect(mergeWorkloadPolicyReports([hybrid])).toMatchObject({ mode: 'gaming-build', state: 'plan-ready' });
    expect(mergeWorkloadPolicyReports([{ ...hybrid, foregroundClass: '', activeClasses: null }])).toMatchObject({ foregroundClass: null, activeClasses: [] });
    expect(buildWorkloadPolicyPlan(hybrid, 'interactive')).toMatchObject({ mode: 'gaming-build', requiresApproval: true });
    expect(buildWorkloadPolicyPlan(unknown, 'interactive').requiresApproval).toBe(false);
    expect(buildWorkloadPolicyPlan(hybrid).mode).toBe('profile-required');
    expect(buildWorkloadPolicyPlan(hybrid, 'other').mode).toBe('profile-required');
    const envelope = buildWorkloadPolicyEnvelope(hybrid, { trigger: 'health.interval', now: () => 0 });
    expect(envelope.generatedAt).toBe('1970-01-01T00:00:00.000Z');
    expect(createWorkloadPolicyLibrary().merge([hybrid]).mode).toBe('gaming-build');
    expect(() => mergeWorkloadPolicyReports()).toThrow('reports must be an array');
    expect(() => mergeWorkloadPolicyReports([null])).toThrow('report must be an object');
    expect(() => mergeWorkloadPolicyReports([[]])).toThrow('report must be an object');
    expect(() => mergeWorkloadPolicyReports([{}])).toThrow('requires a workload-policy report');
    expect(() => mergeWorkloadPolicyReports([hybrid, { ...hybrid, mode: 'bad' }])).toThrow('invalid mode');
    expect(() => mergeWorkloadPolicyReports([hybrid, { ...hybrid, state: 'bad' }])).toThrow('invalid state');
    expect(() => mergeWorkloadPolicyReports([hybrid, { ...hybrid, recommendations: null }])).toThrow('recommendations');
    expect(() => mergeWorkloadPolicyReports(Array.from({ length: 65 }, () => hybrid))).toThrow('at most 64');
    expect(() => buildWorkloadPolicyPlan({})).toThrow('requires a workload-policy report');
    expect(() => buildWorkloadPolicyEnvelope(hybrid)).toThrow('trigger is required');
    expect(() => buildWorkloadPolicyEnvelope(hybrid, { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
  });
});

describe('workload-policy turbos and libraries', () => {
  test('selects modes and merges mode evidence', () => {
    const stable = runWorkloadPolicyModeSelectionTurbo([{ mode: 'developer' }, { mode: 'developer' }], { trigger: 'health.interval', now: () => 0 });
    const changed = runWorkloadPolicyModeSelectionTurbo([{ mode: 'developer' }, { mode: 'gaming' }], { trigger: 'workload.changed' });
    const unknown = runWorkloadPolicyModeSelectionTurbo([{ mode: 'bad' }], { trigger: 'system.facts.request' });
    const empty = runWorkloadPolicyModeSelectionTurbo([], { trigger: 'health.interval' });
    const nested = runWorkloadPolicyModeSelectionTurbo(['developer', { workload: { mode: 'gaming' } }], { trigger: 'health.interval', windowSize: 2 });
    const nonObject = runWorkloadPolicyModeSelectionTurbo([null], { trigger: 'health.interval' });
    const invalidString = runWorkloadPolicyModeSelectionTurbo(['bad'], { trigger: 'health.interval' });
    expect(stable.state).toBe('stable-mode'); expect(changed.state).toBe('mode-changed'); expect(unknown.state).toBe('observation-required'); expect(empty.state).toBe('insufficient-data');
    expect(nested.finalMode).toBe('gaming'); expect(nonObject.state).toBe('observation-required'); expect(invalidString.state).toBe('observation-required');
    expect(mergeWorkloadPolicyModeSelectionReports([]).state).toBe('insufficient-data');
    expect(mergeWorkloadPolicyModeSelectionReports([modeReport('stable-mode')]).mode).toBe('developer');
    expect(mergeWorkloadPolicyModeSelectionReports([modeReport('mode-changed', 'gaming'), modeReport('stable-mode', 'gaming-build')]).mode).toBe('gaming-build');
    expect(mergeWorkloadPolicyModeSelectionReports([modeReport('observation-required', 'unknown')]).state).toBe('observation-required');
    expect(buildWorkloadPolicyModeSelectionPlan(changed, 'interactive').intervalMs).toBe(300000);
    expect(buildWorkloadPolicyModeSelectionPlan(stable, 'interactive').intervalMs).toBe(900000);
    expect(buildWorkloadPolicyModeSelectionPlan(stable).mode).toBe('profile-required');
    expect(buildWorkloadPolicyModeSelectionPlan(stable, 'other').mode).toBe('profile-required');
    expect(buildWorkloadPolicyModeSelectionEnvelope(stable, { trigger: 'health.interval', now: () => 0 }).generatedAt).toContain('1970');
    expect(createWorkloadPolicyModeSelectionLibrary().merge([stable]).state).toBe('stable-mode');
    expect(() => runWorkloadPolicyModeSelectionTurbo({}, { trigger: 'health.interval' })).toThrow('samples');
    expect(() => runWorkloadPolicyModeSelectionTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runWorkloadPolicyModeSelectionTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow('windowSize');
    expect(() => runWorkloadPolicyModeSelectionTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize');
    expect(() => runWorkloadPolicyModeSelectionTurbo()).toThrow('unknown');
    expect(() => runWorkloadPolicyModeSelectionTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeWorkloadPolicyModeSelectionReports([{}])).toThrow('requires a mode-selection');
    expect(() => mergeWorkloadPolicyModeSelectionReports([[]])).toThrow('report must be an object');
    expect(() => mergeWorkloadPolicyModeSelectionReports([null])).toThrow('report must be an object');
    try { mergeWorkloadPolicyModeSelectionReports(null); } catch (error) { expect(error.message).toContain('reports must be an array'); }
    try { mergeWorkloadPolicyModeSelectionReports(Array.from({ length: 65 }, () => modeReport('stable-mode'))); } catch (error) { expect(error.message).toContain('at most 64'); }
    expect(() => mergeWorkloadPolicyModeSelectionReports([modeReport('bad')])).toThrow('invalid state');
    expect(() => mergeWorkloadPolicyModeSelectionReports([modeReport('stable-mode', 'bad')])).toThrow('finalMode');
    expect(() => mergeWorkloadPolicyModeSelectionReports([modeReport('stable-mode', 'developer'), { ...modeReport('stable-mode'), confidence: 2 }])).toThrow('confidence');
    expect(() => buildWorkloadPolicyModeSelectionEnvelope(stable)).toThrow('trigger');
    expect(() => buildWorkloadPolicyModeSelectionEnvelope(stable, { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeWorkloadPolicyModeSelectionReports(Array.from({ length: 65 }, () => modeReport('stable-mode')))).toThrow('at most 64');
  });

  test('reports resource budget violations and safe merge plans', () => {
    const withinSample = { budget: { requested: { cpuPercent: 10 }, recommended: { cpuPercent: 20 } } };
    const exceededSample = { budget: { requested: { cpuPercent: 30 }, recommended: { cpuPercent: 20 } } };
    const within = runWorkloadPolicyResourceBudgetTurbo([withinSample], { trigger: 'health.interval', now: () => 0 });
    const exceeded = runWorkloadPolicyResourceBudgetTurbo([exceededSample], { trigger: 'workload.changed' });
    const observation = runWorkloadPolicyResourceBudgetTurbo([{ budget: {} }], { trigger: 'system.facts.request' });
    const empty = runWorkloadPolicyResourceBudgetTurbo([], { trigger: 'health.interval' });
    const invalidSample = runWorkloadPolicyResourceBudgetTurbo([null, { budget: { requested: { cpuPercent: 1 }, recommended: { cpuPercent: 2 } } }], { trigger: 'health.interval' });
    expect(within.state).toBe('within-budget'); expect(exceeded.state).toBe('budget-exceeded'); expect(observation.state).toBe('observation-required'); expect(empty.state).toBe('insufficient-data');
    expect(invalidSample.state).toBe('within-budget');
    expect(mergeWorkloadPolicyResourceBudgetReports([]).state).toBe('insufficient-data');
    expect(mergeWorkloadPolicyResourceBudgetReports([budgetReport('within-budget')]).state).toBe('within-budget');
    expect(mergeWorkloadPolicyResourceBudgetReports([budgetReport('budget-exceeded', ['cpuPercent'])])).toMatchObject({ state: 'budget-exceeded', violations: ['cpuPercent'] });
    expect(mergeWorkloadPolicyResourceBudgetReports([budgetReport('observation-required')]).state).toBe('observation-required');
    expect(buildWorkloadPolicyResourceBudgetPlan(budgetReport('budget-exceeded'), 'interactive').mode).toBe('approval-required');
    expect(buildWorkloadPolicyResourceBudgetPlan(budgetReport('within-budget'), 'interactive').mode).toBe('budget-observation');
    expect(buildWorkloadPolicyResourceBudgetPlan(budgetReport('within-budget')).mode).toBe('profile-required');
    expect(buildWorkloadPolicyResourceBudgetPlan(budgetReport('within-budget'), 'other').mode).toBe('profile-required');
    expect(buildWorkloadPolicyResourceBudgetEnvelope(budgetReport('within-budget'), { trigger: 'health.interval', now: () => 0 }).library).toContain('resource-budget');
    expect(createWorkloadPolicyResourceBudgetLibrary().merge([budgetReport('within-budget')]).state).toBe('within-budget');
    expect(() => runWorkloadPolicyResourceBudgetTurbo({}, { trigger: 'health.interval' })).toThrow('samples');
    expect(() => runWorkloadPolicyResourceBudgetTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runWorkloadPolicyResourceBudgetTurbo([], { trigger: 'health.interval', windowSize: 0 })).toThrow('windowSize');
    expect(() => runWorkloadPolicyResourceBudgetTurbo([], { trigger: 'health.interval', windowSize: 65 })).toThrow('windowSize');
    expect(() => runWorkloadPolicyResourceBudgetTurbo()).toThrow('unknown');
    expect(() => runWorkloadPolicyResourceBudgetTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeWorkloadPolicyResourceBudgetReports([{}])).toThrow('requires a resource-budget');
    expect(() => mergeWorkloadPolicyResourceBudgetReports([[]])).toThrow('report must be an object');
    expect(() => mergeWorkloadPolicyResourceBudgetReports([null])).toThrow('report must be an object');
    try { mergeWorkloadPolicyResourceBudgetReports(null); } catch (error) { expect(error.message).toContain('reports must be an array'); }
    try { mergeWorkloadPolicyResourceBudgetReports(Array.from({ length: 65 }, () => budgetReport('within-budget'))); } catch (error) { expect(error.message).toContain('at most 64'); }
    expect(() => mergeWorkloadPolicyResourceBudgetReports([budgetReport('bad')])).toThrow('invalid state');
    expect(() => mergeWorkloadPolicyResourceBudgetReports([budgetReport('within-budget', null)])).toThrow('requires violations');
    expect(() => buildWorkloadPolicyResourceBudgetEnvelope(budgetReport('within-budget'))).toThrow('trigger');
    expect(() => buildWorkloadPolicyResourceBudgetEnvelope(budgetReport('within-budget'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeWorkloadPolicyResourceBudgetReports(Array.from({ length: 65 }, () => budgetReport('within-budget')))).toThrow('at most 64');
  });

  test('protects game foreground and records reversible restore intent', () => {
    const protectedForeground = runWorkloadPolicyForegroundProtectionTurbo([{ mode: 'gaming', foregroundClass: 'game' }], { trigger: 'workload.changed', now: () => 0 });
    const missingForeground = runWorkloadPolicyForegroundProtectionTurbo([{ mode: 'gaming' }], { trigger: 'health.interval' });
    const notApplicable = runWorkloadPolicyForegroundProtectionTurbo([{ mode: 'developer', foregroundClass: 'editor' }], { trigger: 'system.facts.request' });
    const nullSample = runWorkloadPolicyForegroundProtectionTurbo([{ mode: 'developer' }, null], { trigger: 'system.facts.request' });
    const empty = runWorkloadPolicyForegroundProtectionTurbo([], { trigger: 'health.interval' });
    const nested = runWorkloadPolicyForegroundProtectionTurbo([{ workload: { mode: 'gaming', foregroundClass: 'game' } }], { trigger: 'health.interval' });
    expect(protectedForeground.state).toBe('foreground-protected'); expect(missingForeground.state).toBe('observation-required'); expect(notApplicable.state).toBe('not-applicable'); expect(nullSample.state).toBe('not-applicable'); expect(empty.state).toBe('insufficient-data');
    expect(nested.state).toBe('foreground-protected');
    expect(mergeWorkloadPolicyForegroundProtectionReports([]).state).toBe('insufficient-data');
    expect(mergeWorkloadPolicyForegroundProtectionReports([foregroundReport('foreground-protected')]).state).toBe('foreground-protected');
    expect(mergeWorkloadPolicyForegroundProtectionReports([foregroundReport('observation-required', 1, 0)]).state).toBe('observation-required');
    expect(mergeWorkloadPolicyForegroundProtectionReports([foregroundReport('not-applicable', 0, 0)]).gamingCount).toBe(0);
    expect(buildWorkloadPolicyForegroundProtectionPlan(foregroundReport('foreground-protected'), 'interactive').mode).toBe('foreground-guard');
    expect(buildWorkloadPolicyForegroundProtectionPlan(foregroundReport('not-applicable'), 'interactive').mode).toBe('observation-only');
    expect(buildWorkloadPolicyForegroundProtectionPlan(foregroundReport('not-applicable')).mode).toBe('profile-required');
    expect(buildWorkloadPolicyForegroundProtectionPlan(foregroundReport('not-applicable'), 'other').mode).toBe('profile-required');
    expect(buildWorkloadPolicyForegroundProtectionEnvelope(foregroundReport('foreground-protected'), { trigger: 'health.interval', now: () => 0 }).library).toContain('foreground-protection');
    expect(createWorkloadPolicyForegroundProtectionLibrary().merge([foregroundReport('foreground-protected')]).state).toBe('foreground-protected');
    expect(() => runWorkloadPolicyForegroundProtectionTurbo({}, { trigger: 'health.interval' })).toThrow('samples');
    expect(() => runWorkloadPolicyForegroundProtectionTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runWorkloadPolicyForegroundProtectionTurbo()).toThrow('unknown');
    expect(() => runWorkloadPolicyForegroundProtectionTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeWorkloadPolicyForegroundProtectionReports([{}])).toThrow('requires a foreground-protection');
    expect(() => mergeWorkloadPolicyForegroundProtectionReports([[]])).toThrow('report must be an object');
    expect(() => mergeWorkloadPolicyForegroundProtectionReports([null])).toThrow('report must be an object');
    try { mergeWorkloadPolicyForegroundProtectionReports(null); } catch (error) { expect(error.message).toContain('reports must be an array'); }
    try { mergeWorkloadPolicyForegroundProtectionReports(Array.from({ length: 65 }, () => foregroundReport('foreground-protected'))); } catch (error) { expect(error.message).toContain('at most 64'); }
    expect(() => mergeWorkloadPolicyForegroundProtectionReports([foregroundReport('bad')])).toThrow('invalid state');
    expect(() => mergeWorkloadPolicyForegroundProtectionReports([foregroundReport('foreground-protected', 'x')])).toThrow('requires counts');
    expect(() => buildWorkloadPolicyForegroundProtectionEnvelope(foregroundReport('foreground-protected'))).toThrow('trigger');
    expect(() => buildWorkloadPolicyForegroundProtectionEnvelope(foregroundReport('foreground-protected'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeWorkloadPolicyForegroundProtectionReports(Array.from({ length: 65 }, () => foregroundReport('foreground-protected')))).toThrow('at most 64');
  });

  test('records game-exit restoration while refusing unknown context', () => {
    const planned = runWorkloadPolicyRestorePlanTurbo([{ mode: 'gaming-build' }], { trigger: 'workload.changed', now: () => 0 });
    const none = runWorkloadPolicyRestorePlanTurbo([{ mode: 'developer' }], { trigger: 'health.interval' });
    const unknown = runWorkloadPolicyRestorePlanTurbo([{ mode: 'unknown' }], { trigger: 'system.facts.request' });
    const empty = runWorkloadPolicyRestorePlanTurbo([], { trigger: 'health.interval' });
    const nested = runWorkloadPolicyRestorePlanTurbo([{ workload: { mode: 'gaming' } }], { trigger: 'health.interval' });
    const missingMode = runWorkloadPolicyRestorePlanTurbo([null, { workload: {} }], { trigger: 'health.interval' });
    expect(planned).toMatchObject({ state: 'restore-planned', restoreActions: expect.arrayContaining(['verify-foreground-exit']) }); expect(none.state).toBe('no-restore-needed'); expect(unknown.state).toBe('observation-required'); expect(empty.state).toBe('insufficient-data');
    expect(nested.state).toBe('restore-planned');
    expect(missingMode.state).toBe('observation-required');
    expect(mergeWorkloadPolicyRestorePlanReports([]).state).toBe('insufficient-data');
    expect(mergeWorkloadPolicyRestorePlanReports([restoreReport('restore-planned', ['restore-background-budget'])]).state).toBe('restore-planned');
    expect(mergeWorkloadPolicyRestorePlanReports([restoreReport('observation-required')]).state).toBe('observation-required');
    expect(mergeWorkloadPolicyRestorePlanReports([restoreReport('no-restore-needed')]).state).toBe('no-restore-needed');
    expect(buildWorkloadPolicyRestorePlan(restoreReport('restore-planned'), 'interactive').mode).toBe('restore-after-exit');
    expect(buildWorkloadPolicyRestorePlan(restoreReport('no-restore-needed'), 'interactive').mode).toBe('no-restore');
    expect(buildWorkloadPolicyRestorePlan(restoreReport('no-restore-needed')).mode).toBe('profile-required');
    expect(buildWorkloadPolicyRestorePlan(restoreReport('no-restore-needed'), 'other').mode).toBe('profile-required');
    expect(buildWorkloadPolicyRestorePlanEnvelope(restoreReport('restore-planned'), { trigger: 'health.interval', now: () => 0 }).library).toContain('restore-plan');
    expect(createWorkloadPolicyRestorePlanLibrary().merge([restoreReport('restore-planned')]).state).toBe('restore-planned');
    expect(() => runWorkloadPolicyRestorePlanTurbo({}, { trigger: 'health.interval' })).toThrow('samples');
    expect(() => runWorkloadPolicyRestorePlanTurbo([], { trigger: 'bad' })).toThrow('Unsupported');
    expect(() => runWorkloadPolicyRestorePlanTurbo()).toThrow('unknown');
    expect(() => runWorkloadPolicyRestorePlanTurbo([], { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeWorkloadPolicyRestorePlanReports([{}])).toThrow('requires a restore-plan');
    expect(() => mergeWorkloadPolicyRestorePlanReports([[]])).toThrow('report must be an object');
    expect(() => mergeWorkloadPolicyRestorePlanReports([null])).toThrow('report must be an object');
    try { mergeWorkloadPolicyRestorePlanReports(null); } catch (error) { expect(error.message).toContain('reports must be an array'); }
    try { mergeWorkloadPolicyRestorePlanReports(Array.from({ length: 65 }, () => restoreReport('restore-planned'))); } catch (error) { expect(error.message).toContain('at most 64'); }
    expect(() => mergeWorkloadPolicyRestorePlanReports([restoreReport('bad')])).toThrow('invalid state');
    expect(() => mergeWorkloadPolicyRestorePlanReports([restoreReport('restore-planned', null)])).toThrow('requires restoreActions');
    expect(() => buildWorkloadPolicyRestorePlanEnvelope(restoreReport('restore-planned'))).toThrow('trigger');
    expect(() => buildWorkloadPolicyRestorePlanEnvelope(restoreReport('restore-planned'), { trigger: 'health.interval', now: () => NaN })).toThrow('clock');
    expect(() => mergeWorkloadPolicyRestorePlanReports(Array.from({ length: 65 }, () => restoreReport('restore-planned')))).toThrow('at most 64');
  });
});
