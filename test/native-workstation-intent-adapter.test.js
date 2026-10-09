/**
 * Native workstation intent adapter tests.
 * Copyright © 2026 Lisa's Dungeon.
 */

import {
  buildWorkstationIntentPrompt,
  interpretWorkstationQuestionWithAdapter,
  parseWorkstationIntentResponse,
  WORKSTATION_INTENT_ADAPTER_VERSION
} from '../native/workstation-intent-adapter.js';

describe('workstation intent adapter', () => {
  test('builds bounded prompts and parses object or JSON responses', () => {
    expect(buildWorkstationIntentPrompt(' Why is C: full? ')).toMatchObject({ version: WORKSTATION_INTENT_ADAPTER_VERSION, question: 'Why is C: full?' });
    expect(parseWorkstationIntentResponse({ question: 'Why is C: full?', confidence: 0.9, rationale: 'storage' })).toEqual({ question: 'Why is C: full?', confidence: 0.9, rationale: 'storage' });
    expect(parseWorkstationIntentResponse('{"question":"How hot is it?"}')).toEqual({ question: 'How hot is it?', confidence: null, rationale: null });
  });

  test('rejects malformed, oversized, or unsafe response shapes', () => {
    expect(() => buildWorkstationIntentPrompt('')).toThrow('bounded');
    expect(() => buildWorkstationIntentPrompt('x'.repeat(513))).toThrow('bounded');
    expect(() => parseWorkstationIntentResponse('x'.repeat(4097))).toThrow('too large');
    expect(() => parseWorkstationIntentResponse('{bad')).toThrow('valid JSON');
    expect(() => parseWorkstationIntentResponse([])).toThrow('object');
    expect(() => parseWorkstationIntentResponse({})).toThrow('question');
    expect(() => parseWorkstationIntentResponse({ question: 'x', confidence: 2 })).toThrow('confidence');
    expect(parseWorkstationIntentResponse({ question: 'x', rationale: 'r'.repeat(257) })).toMatchObject({ question: 'x', rationale: null });
  });

  test('delegates only high-confidence canonical questions and fails closed', async () => {
    const facts = { storagePressure: { level: 'warning' } };
    const generator = jest.fn(async (prompt) => ({ question: prompt.question, confidence: 0.8, rationale: 'bounded' }));
    await expect(interpretWorkstationQuestionWithAdapter('Why is storage under pressure?', { generate: generator, facts })).resolves.toMatchObject({ state: 'delegated', delegated: { intent: 'storage', state: 'answered' }, candidate: { confidence: 0.8 } });
    await expect(interpretWorkstationQuestionWithAdapter('Do something', { generate: async () => ({ question: 'clean safe cache', confidence: 0.5 }) })).resolves.toMatchObject({ state: 'refused', evidence: { reason: expect.stringContaining('confidence') } });
    await expect(interpretWorkstationQuestionWithAdapter('Do something', { generate: async () => '{bad' })).resolves.toMatchObject({ state: 'refused', evidence: { reason: expect.stringContaining('valid JSON') } });
    await expect(interpretWorkstationQuestionWithAdapter('Do something', { generate: async () => { throw new Error('generator unavailable'); } })).resolves.toMatchObject({ state: 'refused', evidence: { reason: 'generator unavailable' } });
    await expect(interpretWorkstationQuestionWithAdapter('Do something', { generate: async () => ({ question: '???', confidence: 0.9 }) })).resolves.toMatchObject({ state: 'delegated', delegated: { intent: 'unknown', state: 'refused' } });
    await expect(interpretWorkstationQuestionWithAdapter('Do something')).rejects.toThrow('generator');
  });
});
