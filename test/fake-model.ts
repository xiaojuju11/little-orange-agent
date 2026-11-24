import type { LanguageModel } from 'ai'
import type { MockPlan } from '../src/mock-model'

export type ScriptedPlan = MockPlan | { kind: 'error'; error: Error }

const USAGE = {
  inputTokens: { total: 1, noCache: 1, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 1, text: 1, reasoning: undefined },
}

export function streamOf(chunks: any[]): ReadableStream<any> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

export function textChunks(text: string): any[] {
  return [
    { type: 'text-start', id: 't1' },
    ...text.split('').map((char) => ({ type: 'text-delta', id: 't1', delta: char })),
    { type: 'text-end', id: 't1' },
    { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
  ]
}

export function toolCallChunks(toolName: string, input: Record<string, unknown>, id = 'call-1'): any[] {
  const json = JSON.stringify(input)
  return [
    { type: 'tool-input-start', id, toolName },
    { type: 'tool-input-delta', id, delta: json },
    { type: 'tool-input-end', id },
    { type: 'tool-call', toolCallId: id, toolName, input: json },
    { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: USAGE },
  ]
}

/**
 * 按剧本逐轮回复的假模型：第 n 次调用 doStream 用 plans[n]，
 * 剧本用完后一直重复最后一条（方便测「永不收敛」）。
 */
export function scriptedModel(plans: ScriptedPlan[]) {
  let calls = 0
  const model = {
    specificationVersion: 'v4' as const,
    provider: 'scripted',
    modelId: 'scripted',
    async doStream() {
      const plan = plans[Math.min(calls, plans.length - 1)]
      calls++
      if (plan.kind === 'error') {
        return { stream: streamOf([{ type: 'error', error: plan.error }]) }
      }
      if (plan.kind === 'tool-call') {
        return { stream: streamOf(toolCallChunks(plan.toolName, plan.input)) }
      }
      return { stream: streamOf(textChunks(plan.text)) }
    },
  }
  return { model: model as unknown as LanguageModel, calls: () => calls }
}

export function collectingLogger() {
  const lines: string[] = []
  return {
    lines,
    logger: { log: (...args: unknown[]) => lines.push(args.map((a) => String(a)).join(' ')) },
    has: (keyword: string) => lines.some((line) => line.includes(keyword)),
  }
}

export const silentLogger = { log: () => {} }
export const noWrite = () => {}
