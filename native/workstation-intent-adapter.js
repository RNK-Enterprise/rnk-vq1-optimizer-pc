/**
 * RNK Vortex System Optimizer
 * Copyright © 2026 Lisa's Dungeon
 * Contributor: Lisa's Dungeon
 *
 * Optional local-language boundary. A caller-owned generator may translate a
 * question into one canonical question; deterministic routing remains the
 * only authority and model output never executes an operation.
 */

import { interpretWorkstationQuestion, WORKSTATION_ASSISTANT_VERSION } from './workstation-assistant.js';

export const WORKSTATION_INTENT_ADAPTER_VERSION = 1;
const MAX_INPUT = 512;
const MAX_RESPONSE = 4096;
const MIN_CONFIDENCE = 0.75;

function record(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function text(value, limit = MAX_INPUT) { return typeof value === 'string' && value.trim() && value.trim().length <= limit ? value.trim() : null; }
function confidence(value) { return value === undefined ? null : Number.isFinite(value) && value >= 0 && value <= 1 ? value : null; }

export function buildWorkstationIntentPrompt(question) {
  const input = text(question);
  if (!input) throw new TypeError('Intent adapter question is required and bounded');
  return Object.freeze({
    version: WORKSTATION_INTENT_ADAPTER_VERSION,
    question: input,
    instruction: 'Return JSON only with question, confidence, and optional rationale. Translate the request into one plain workstation question. Do not return commands, paths, credentials, tool calls, or plans.'
  });
}

export function parseWorkstationIntentResponse(response) {
  const raw = typeof response === 'string' ? response : response;
  if (typeof raw === 'string' && raw.length > MAX_RESPONSE) throw new RangeError('Intent adapter response is too large');
  let parsed = raw;
  if (typeof raw === 'string') {
    try { parsed = JSON.parse(raw); } catch { throw new TypeError('Intent adapter response must be valid JSON'); }
  }
  if (!record(parsed)) throw new TypeError('Intent adapter response must be an object');
  const question = text(parsed.question);
  if (!question) throw new TypeError('Intent adapter response needs a bounded question');
  if (parsed.confidence !== undefined && confidence(parsed.confidence) === null) throw new TypeError('Intent adapter confidence is invalid');
  return Object.freeze({ question, confidence: confidence(parsed.confidence), rationale: text(parsed.rationale, 256) });
}

function refused(reason) {
  return Object.freeze({ version: WORKSTATION_INTENT_ADAPTER_VERSION, assistantVersion: WORKSTATION_ASSISTANT_VERSION, intent: 'adapter', state: 'refused', answer: 'The optional language adapter did not produce a safe canonical question.', evidence: Object.freeze({ reason }), recommendations: Object.freeze(['use-deterministic-assistant']) });
}

export async function interpretWorkstationQuestionWithAdapter(question, { generate, facts = {}, report = null } = {}) {
  if (typeof generate !== 'function') throw new TypeError('Intent adapter requires a caller-owned generator');
  const prompt = buildWorkstationIntentPrompt(question);
  let candidate;
  try { candidate = parseWorkstationIntentResponse(await generate(prompt)); } catch (error) { return refused(error.message); }
  if (candidate.confidence !== null && candidate.confidence < MIN_CONFIDENCE) return refused('Intent adapter confidence is below the review boundary');
  const delegated = interpretWorkstationQuestion(candidate.question, facts, { report });
  return Object.freeze({ version: WORKSTATION_INTENT_ADAPTER_VERSION, assistantVersion: WORKSTATION_ASSISTANT_VERSION, intent: 'adapter', state: 'delegated', candidate, delegated });
}
