/** Decision logic for the two Laya hook points, free of Cordis wiring so it tests in isolation. */

import type { NoulOutcome, NoulQuestion } from './client.ts'
import type { LayaDecision } from './types.ts'

/** Ask one yes/no question, or undefined when the sidecar is not running. */
export type Ask = (state: string, question: NoulQuestion) => Promise<NoulOutcome | undefined>

export const DONE_QUESTION: NoulQuestion = {
  type: 'noul',
  instructions: 'Is the user\'s request fully done, with nothing left to implement, run or verify?',
}

export const SUCCESS_QUESTION: NoulQuestion = {
  type: 'noul',
  instructions: 'Did this command succeed without errors?',
}

/** Steering text when Laya judges the turn unfinished. */
export const VERIFY_NUDGE = 'Before you finish, check the request again. If anything is left to implement, run '
  + 'or verify, do it now. If everything is done, reply with a one-line summary.'

/** Context added after a command Laya judges failed. */
export const FAILURE_NOTE = 'The last command output looks like it failed. Read the error and fix it before moving on.'

/** Tool names whose output is a command result worth judging. */
const COMMAND_TOOL = /bash|shell|terminal|exec|command|run/i

/**
 * Whether a tool's output should be judged for success.
 * @param name - the tool name.
 * @returns true for shell-like tools.
 */
export function isCommandTool(name: string): boolean {
  return COMMAND_TOOL.test(name)
}

/** Build the state Laya reads for the stop decision. */
export function stopState(request: string, reply: string): string {
  return `User request:\n${request.slice(-4000)}\n\nAssistant's final reply:\n${reply.slice(-4000)}`
}

/**
 * Decide whether to continue a turn that is about to stop.
 * @param ask - Laya question function.
 * @param state - request plus final reply.
 * @param threshold - continue when the done-probability is below this.
 * @param alreadyNudged - this turn was already continued once.
 * @returns the decision; `action` is `continue` when the caller should steer.
 */
export async function decideStop(
  ask: Ask,
  state: string,
  threshold: number,
  alreadyNudged: boolean,
): Promise<Omit<LayaDecision, 'time' | 'sessionId'> | undefined> {
  if (alreadyNudged) return undefined
  const outcome = await ask(state, DONE_QUESTION)
  if (outcome === undefined) return undefined
  const base = { hook: 'turn-stopping', question: DONE_QUESTION.instructions, latencyMs: outcome.latencyMs }
  if (outcome.probability === undefined) return { ...base, action: 'abstain' }
  return {
    ...base,
    probability: outcome.probability,
    action: outcome.probability < threshold ? 'continue' : 'stop',
  }
}

/**
 * Decide whether a finished command looks like a failure.
 * @param ask - Laya question function.
 * @param command - the tool name and arguments.
 * @param output - the tool's text output.
 * @param threshold - flag a failure when the success-probability is below this.
 * @returns the decision; `action` is `flag-failure` when the caller should add a note.
 */
export async function decideCommand(
  ask: Ask,
  command: string,
  output: string,
  threshold: number,
): Promise<Omit<LayaDecision, 'time' | 'sessionId'> | undefined> {
  const state = `Command:\n${command.slice(0, 2000)}\n\nOutput:\n${output.slice(-6000)}`
  const outcome = await ask(state, SUCCESS_QUESTION)
  if (outcome === undefined) return undefined
  const base = { hook: 'post-execute', question: SUCCESS_QUESTION.instructions, latencyMs: outcome.latencyMs }
  if (outcome.probability === undefined) return { ...base, action: 'abstain' }
  return {
    ...base,
    probability: outcome.probability,
    action: outcome.probability < threshold ? 'flag-failure' : 'pass',
  }
}

/**
 * Concatenate the text blocks of a message-like value, ignoring other blocks.
 * @param content - a message `content` array.
 * @returns the joined text.
 */
export function textOf(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : ''
  return content
    .map(block => (block !== null && typeof block === 'object' && (block as { type?: unknown }).type === 'text'
      ? String((block as { text?: unknown }).text ?? '')
      : ''))
    .filter(Boolean)
    .join('\n')
}
