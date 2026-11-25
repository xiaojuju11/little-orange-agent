import { streamText, type LanguageModel, type ModelMessage, type ToolSet } from "ai";
import { detect, recordCall, recordResult, resetHistory } from './loop-detection'

/** 默认最大循环步数：一步 = 一次「模型输出 + 工具执行」 */
export const DEFAULT_MAX_STEPS = 10

/** 本轮循环为什么结束 */
export type AgentStopReason =
  /** 模型没有再要工具，正常说完话 */
  | 'no-tool-call'
  /** 步数用完了，模型还想继续 */
  | 'max-steps'
  /** 死循环检测熔断：工具反复空转，提前停住 */
  | 'circuit-breaker'

export interface AgentLoopOptions {
  /** 最大步数，默认 DEFAULT_MAX_STEPS */
  maxSteps?: number
  /** 过程日志（调用工具、工具返回等），默认 console；测试里传静默 logger */
  logger?: Pick<Console, 'log'>
  /** 模型正文输出到哪里，默认 process.stdout.write */
  write?: (text: string) => void
}

export interface AgentLoopResult {
  /** 本轮所有步骤产生的正文（流式已经输出过一遍，这里给调用方做断言/记录） */
  text: string
  /** 实际走了几步 */
  steps: number
  /** 实际发起了多少次工具调用 */
  toolCalls: number
  stopReason: AgentStopReason
}

export async function agentLoop(
  model: LanguageModel,
  tools: ToolSet,
  messages: ModelMessage[],
  system: string,
  options: AgentLoopOptions = {},
): Promise<AgentLoopResult> {
  const maxSteps = Math.max(1, Math.trunc(options.maxSteps ?? DEFAULT_MAX_STEPS))
  const log = options.logger ?? console
  const write = options.write ?? ((text: string) => process.stdout.write(text))

  // 每轮对话从空历史开始，上一轮的调用记录不该影响这一轮
  resetHistory()

  let step = 0
  let toolCalls = 0
  let text = ''
  let stopReason: AgentStopReason = 'max-steps'
  /** 本轮要回灌给模型的警告；等工具结果进上下文后再注入 */
  let pendingWarning: string | undefined
  /** 熔断原因；等本轮流式跑完、消息回灌后再停，免得留下半截工具调用 */
  let breakerMessage: string | undefined
  /** toolCallId -> 调用参数，给 tool-result 补记结果用 */
  const callsById = new Map<string, { name: string; input: unknown }>()

  while (step < maxSteps) {
    step++
    log.log(`\n--- Step ${step} ---`)

    const result = streamText({
      model,
      tools,
      messages,
      system,
      // 不配置 stopWhen，就只会跑一次；多轮由下面的 while 循环自己控制
      // SDK 默认会把错误对象整个打到 stderr（几百行），这里关掉：
      // 错误由下面 fullStream 的 error part 统一抛给上层，由 errors.ts 翻成人话
      onError: () => {},
    })

    let hasToolCall = false
    let stepText = ''

    for await (const part of result.fullStream) {
      switch (part.type) {
        case 'text-delta':
          write(part.text)
          stepText += part.text
          break
        case 'tool-call': {
          hasToolCall = true
          toolCalls++
          log.log(`\n  [调用: ${part.toolName}(${JSON.stringify(part.input)})]`)
          callsById.set(part.toolCallId, { name: part.toolName, input: part.input })
          // 先记这次调用再检测：检测里的计数包含当前这次
          recordCall(part.toolName, part.input)
          const verdict = detect(part.toolName, part.input)
          if (verdict.stuck) {
            log.log(`  ${verdict.message}`)
            if (verdict.level === 'critical') breakerMessage = verdict.message
            else pendingWarning = verdict.message
          }
          break
        }
        case 'tool-result': {
          // 把结果回填到刚才那次调用，「同参同结果」才能算无进展
          const call = callsById.get(part.toolCallId)
          if (call) {
            recordResult(call.name, call.input, part.output)
            callsById.delete(part.toolCallId)
          }
          log.log(`  [结果: ${JSON.stringify(part.output)}]`)
          break
        }
        case 'tool-error':
          // 工具自己抛错：SDK 把错误当作 tool-result 回灌给模型，
          // 循环照常继续，让模型自己决定怎么补救；这里只补一条可观测日志
          log.log(`  [工具异常: ${part.toolName}] ${describe(part.error)}`)
          break
        case 'error':
          // 模型/网络层错误：继续循环只会拿到空回复，直接抛给上层去提示用户
          throw toError(part.error)
        case 'finish':
          if (part.finishReason === 'length') {
            log.log('\n  [提示: 达到模型输出上限，本轮回复被截断]')
          }
          break
      }
    }

    text += stepText
    if (stepText) write('\n')

    // response.messages 里既有 assistant 的工具调用，也有对应的 tool 结果，
    // 整段回灌给 messages，下一轮模型才看得到工具返回了什么
    const stepMessages = await result.response
    messages.push(...stepMessages.messages)

    // 警告放在工具结果之后回灌，模型下一轮才看得到完整上下文
    if (pendingWarning) {
      messages.push({ role: 'user', content: `[系统提示] ${pendingWarning}` })
      pendingWarning = undefined
    }

    // 熔断等整轮流式跑完再生效，免得留下「有 tool-call 没 tool 结果」的半截消息
    if (breakerMessage) {
      stopReason = 'circuit-breaker'
      break
    }

    // 退出条件：模型这次没有再要工具
    if (!hasToolCall) {
      stopReason = 'no-tool-call'
      break
    }

    // 还有工具调用，继续循环
    if (step < maxSteps) log.log(' --> 模型还在工作，继续下一步...')
  }

  // 只有「步数用满、模型还想继续」才算 max-steps。
  // 原实现用 step >= MAX_STEPS 判断，正常在最后一步说完话也会误报「超过最大限制」
  if (stopReason === 'max-steps') {
    log.log(`\n已达到最大步数 ${maxSteps}，本轮提前结束（可用 --max-steps 调大上限）。`)
  }

  return { text, steps: step, toolCalls, stopReason }
}

function toError(value: unknown): Error {
  if (value instanceof Error) return value
  return new Error(typeof value === 'string' ? value : JSON.stringify(value))
}

function describe(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
