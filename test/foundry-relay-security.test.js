import {
  RELAY_ACTION_LIMIT,
  RELAY_PLAN_TTL_MS,
  RelayAuditLog,
  RelayRateLimiter,
  RelayReplayGuard,
  createOpaqueClientId,
  sanitizeTelemetry,
  validateRelayPlan
} from '../foundry-relay-security.js';

const safeAction = { type: 'set-fps-cap', key: 'fps.cap', value: 60 };
const basePlan = (extra = {}) => ({
  protocolVersion: 1,
  planId: 'plan-1',
  profile: 'balanced',
  scope: 'self',
  actions: [safeAction],
  expiresAt: new Date(1000 + RELAY_PLAN_TTL_MS).toISOString(),
  ...extra
});

describe('Foundry relay security primitives', () => {
  test('keeps only bounded performance telemetry and drops content fields', () => {
    expect(sanitizeTelemetry(null)).toEqual({});
    const result = sanitizeTelemetry({
      chat: 'private message',
      document: { name: 'secret' },
      fps: { average: 60, low1Percent: -2, frameTimeMs: 16, varianceMs: Number.POSITIVE_INFINITY, extra: 9 },
      memory: { usedMB: 2, limitMB: 8 },
      network: { latencyMs: 20, jitterMs: -1, effectiveType: 'invalid', saveData: 1 },
      workload: { longTasks: 3, activeEffects: 4, activeAnimations: 5, pendingTasks: 6, tickerFPS: 60 },
      runtime: { mobile: true, cores: 4, deviceMemoryGB: 8, webgpu: true, wasm: false }
    });
    expect(result).toEqual(expect.objectContaining({
      fps: expect.objectContaining({ average: 60, low1Percent: 0, varianceMs: null }),
      network: expect.objectContaining({ effectiveType: null, saveData: false }),
      runtime: expect.objectContaining({ mobile: true, webgpu: true })
    }));
    expect(result.chat).toBeUndefined();
    expect(result.document).toBeUndefined();
    expect(sanitizeTelemetry({ network: { effectiveType: '4g' } }).network.effectiveType).toBe('4g');
    expect(sanitizeTelemetry({ network: { effectiveType: 3 } }).network.effectiveType).toBeNull();
    expect(sanitizeTelemetry({ fps: {} }, { maxBytes: 1 })).toEqual({ truncated: true });
    expect(sanitizeTelemetry({ fps: 'not-an-object', memory: [], network: null, workload: 1, runtime: false })).toEqual({ fps: {}, memory: {}, network: {}, workload: {}, runtime: {} });
  });

  test('validates plans, actions, expiration, and safe output shape', () => {
    const plan = validateRelayPlan(basePlan({
      actions: [
        safeAction,
        { type: 'set-quality', key: 'render.distance', value: 10 },
        { type: 'set-cache-size', key: 'cache.size', value: 256 },
        { type: 'set-batch-size', key: 'batch.size', value: 8 },
        { type: 'set-effect-budget', key: 'effects.budget', value: 50 },
        { type: 'set-animation-budget', key: 'animation.budget', value: 50 },
        { type: 'set-network-batch', key: 'network.batch', value: 8 },
        { type: 'set-runtime-variant', key: 'lite' },
        { type: 'disable-component', key: 'heavy-effects' },
        { type: 'enable-component', key: 'heavy-effects' }
      ],
      recommendations: ['review', 2],
      sourceUnits: ['VQ-1', 2]
    }), { now: () => 1000, request: { profile: 'power', scope: 'selected', targetClientIds: ['client_a'] } });
    expect(plan).toMatchObject({ profile: 'balanced', scope: 'self', targetClientIds: ['client_a'] });
    expect(plan.actions).toHaveLength(10);
    expect(plan.recommendations).toEqual(['review']);
    expect(plan.sourceUnits).toEqual(['VQ-1']);
    expect(Object.isFrozen(plan)).toBe(true);
    const fallback = validateRelayPlan({ protocolVersion: 1, actions: [], expiresAt: undefined }, { now: () => 1000, request: { profile: 'power', scope: 'all' } });
    expect(fallback.profile).toBe('power');
    expect(fallback.scope).toBe('all');
    expect(fallback.expiresAt).toBe(new Date(1000 + RELAY_PLAN_TTL_MS).toISOString());
    expect(fallback.planId).toMatch(/^relay-/);
  });

  test('rejects malformed plans and unsafe action shapes', () => {
    expect(() => validateRelayPlan(null)).toThrow('protocol');
    expect(() => validateRelayPlan(basePlan({ protocolVersion: 2 }))).toThrow('protocol');
    expect(() => validateRelayPlan(basePlan({ profile: 'bad' }))).toThrow('profile');
    expect(() => validateRelayPlan(basePlan({ scope: 'bad' }))).toThrow('scope');
    expect(() => validateRelayPlan(basePlan({ actions: Array(RELAY_ACTION_LIMIT + 1).fill(safeAction) }))).toThrow('0-24');
    expect(() => validateRelayPlan(basePlan({ expiresAt: 'bad' }))).toThrow('expiration');
    expect(() => validateRelayPlan(basePlan({ expiresAt: new Date(999).toISOString() }), { now: () => 1000 })).toThrow('expiration');
    expect(() => validateRelayPlan(basePlan({ expiresAt: new Date(1000 + RELAY_PLAN_TTL_MS + 1).toISOString() }), { now: () => 1000 })).toThrow('expiration');
    expect(() => validateRelayPlan(basePlan({ actions: [{ type: 'set-fps-cap', key: 'cache.size', value: 60 }] }), { now: () => 1000 })).toThrow('not allowed');
    expect(() => validateRelayPlan(basePlan({ actions: [{ type: 'disable-component', key: 'bad/path' }] }), { now: () => 1000 })).toThrow('Component key');
    expect(() => validateRelayPlan(basePlan({ actions: [{ ...safeAction, path: '/tmp' }] }), { now: () => 1000 })).toThrow('extra fields');
    expect(() => validateRelayPlan(basePlan({ actions: [{ type: 'run-code' }] }), { now: () => 1000 })).toThrow('Unsupported optimizer action');
    expect(() => validateRelayPlan(basePlan(), { now: () => Number.NaN })).toThrow('clock');
  });

  test('creates opaque client IDs and enforces rate limits', () => {
    const clientId = createOpaqueClientId();
    expect(clientId).toMatch(/^client_[A-Za-z0-9_-]{20,}$/);
    expect(new RelayRateLimiter()).toBeInstanceOf(RelayRateLimiter);
    expect(() => new RelayRateLimiter({ now: 1 })).toThrow('clock');
    expect(() => new RelayRateLimiter({ windowMs: 999 })).toThrow('window');
    expect(() => new RelayRateLimiter({ maxRequests: 0 })).toThrow('maximum');
    let now = 1000;
    const limiter = new RelayRateLimiter({ now: () => now, windowMs: 1000, maxRequests: 2 });
    expect(limiter.check('client')).toMatchObject({ allowed: true, remaining: 1 });
    expect(limiter.check('client')).toMatchObject({ allowed: true, remaining: 0 });
    expect(limiter.check('client').allowed).toBe(false);
    now = 2000;
    expect(limiter.check('client')).toMatchObject({ allowed: true, remaining: 1 });
  });

  test('issues, expires, and consumes plan IDs exactly once', () => {
    let now = 1000;
    expect(new RelayReplayGuard()).toBeInstanceOf(RelayReplayGuard);
    expect(() => new RelayReplayGuard({ now: 1 })).toThrow('clock');
    expect(() => new RelayReplayGuard({ maxEntries: 0 })).toThrow('maximum');
    const guard = new RelayReplayGuard({ now: () => now, maxEntries: 1 });
    const plan = validateRelayPlan(basePlan(), { now: () => 1000 });
    guard.issue(plan, 'client_a');
    expect(guard.consume(plan.planId, 'client_a')).toBe(true);
    expect(() => guard.consume(plan.planId, 'client_a')).toThrow('already');
    const second = validateRelayPlan(basePlan({ planId: 'plan-2' }), { now: () => 1000 });
    guard.issue(second, 'client_b');
    expect(() => guard.consume(plan.planId, 'client_a')).toThrow('Unknown');
    expect(() => guard.consume(second.planId, 'client_a')).toThrow('belong');
    expect(() => guard.consume(second.planId, 'client_b', { scope: 'all' })).toThrow('scope');
    expect(() => guard.consume(second.planId, 'client_b', { actionCount: 2 })).toThrow('action count');
    now = 40000;
    expect(() => guard.consume(second.planId, 'client_b')).toThrow('Unknown');
  });

  test('bounds the GM audit log and returns copies', () => {
    expect(new RelayAuditLog()).toBeInstanceOf(RelayAuditLog);
    expect(() => new RelayAuditLog({ maxEntries: 0 })).toThrow('maximum');
    const log = new RelayAuditLog({ maxEntries: 2 });
    log.append({ action: 'one' });
    log.append({ action: 'two' });
    log.append({ action: 'three' });
    const entries = log.list();
    expect(entries).toEqual([{ action: 'two' }, { action: 'three' }]);
    entries[0].action = 'changed';
    expect(log.list()[0].action).toBe('two');
  });
});
