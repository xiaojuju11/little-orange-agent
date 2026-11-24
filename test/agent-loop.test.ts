import test from 'node:test'
import assert from 'node:assert/strict'
import { jsonSchema, type ModelMessage, type ToolSet } from 'ai'
import { agentLoop, DEFAULT_MAX_STEPS } from '../src/agent/loop'
import { createMockModel } from '../src/mock-model'
import { weatherTool } from '../src/tools/utility-tools'
import { collectingLogger, noWrite, scriptedModel, silentLogger } from './fake-model'

const tools: ToolSet = { get_weather: weatherTool }

const boomTool = {
  description: '永远抛错的工具，用来验证工具异常不会打断循环',
  inputSchema: jsonSchema({
    type: 'object',
    properties: { city: { type: 'string' } },
    required: ['city'],
    additionalProperties: false,
  }),
  execute: async () => {
    throw new Error('boom')
  },
}

test('模拟模型 + 天气工具：无 API Key 也能跑完「调用 → 拿结果 → 回答」两轮', async () => {
  const model = createMockModel({ delayMs: 0 })
  const messages: ModelMessage[] = [{ role: 'user', content: '南昌今天天气怎么样' }]

  const result = await agentLoop(model as any, tools, messages, 'sys', {
    maxSteps: 5,
    logger: silentLogger,
    write: noWrite,
  })

  assert.equal(result.steps, 2, '第一步调工具，第二步回答')
  assert.equal(result.toolCalls, 1)
  assert.equal(result.stopReason, 'no-tool-call')
  assert.match(result.text, /晴,30摄氏度/)
  // 工具结果必须回灌进上下文，否则下一轮模型看不到
  assert.ok(messages.some((m) => m.role === 'tool'), '上下文里应有 tool 消息')
  assert.ok(
    messages.some(
      (m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((p: any) => p.type === 'tool-call'),
    ),
    '上下文里应有 assistant 的 tool-call',
  )
})

test('模型不调工具时一轮就结束，不误报「达到最大步数」', async () => {
  const { model } = scriptedModel([{ kind: 'text', text: '你好呀' }])
  const sink = collectingLogger()
  const messages: ModelMessage[] = [{ role: 'user', content: '你好' }]

  const result = await agentLoop(model, tools, messages, 'sys', {
    maxSteps: 10,
    logger: sink.logger,
    write: noWrite,
  })

  assert.equal(result.steps, 1)
  assert.equal(result.toolCalls, 0)
  assert.equal(result.stopReason, 'no-tool-call')
  assert.equal(result.text, '你好呀')
  assert.equal(sink.has('已达到最大步数'), false, '正常说完话不该出现 max-steps 提示')
})

test('步数用满时以 max-steps 结束并提示，不抛异常', async () => {
  const { model, calls } = scriptedModel([{ kind: 'tool-call', toolName: 'get_weather', input: { city: '南昌' } }])
  const sink = collectingLogger()

  const result = await agentLoop(model, tools, [{ role: 'user', content: '查天气' }], 'sys', {
    maxSteps: 3,
    logger: sink.logger,
    write: noWrite,
  })

  assert.equal(result.steps, 3)
  assert.equal(result.toolCalls, 3)
  assert.equal(result.stopReason, 'max-steps')
  assert.equal(calls(), 3, '步数用满后不应再多请求一次模型')
  assert.equal(sink.has('已达到最大步数 3'), true)
})

test('步数用满后上下文里不留「有 tool-call 没 tool 结果」的半截消息', async () => {
  const { model } = scriptedModel([{ kind: 'tool-call', toolName: 'get_weather', input: { city: '南昌' } }])
  const messages: ModelMessage[] = [{ role: 'user', content: '查天气' }]

  await agentLoop(model, tools, messages, 'sys', { maxSteps: 2, logger: silentLogger, write: noWrite })

  const last = messages[messages.length - 1]
  assert.equal(last.role, 'tool', '最后一条应是工具返回，而不是悬空的工具调用')
})

test('工具自己抛错时循环继续，把错误交给模型收尾', async () => {
  const { model } = scriptedModel([
    { kind: 'tool-call', toolName: 'boom', input: {} },
    { kind: 'text', text: '工具挂了，我换个说法' },
  ])
  const sink = collectingLogger()

  const result = await agentLoop(model, { boom: boomTool }, [{ role: 'user', content: '试试' }], 'sys', {
    maxSteps: 5,
    logger: sink.logger,
    write: noWrite,
  })

  assert.equal(result.steps, 2)
  assert.equal(result.stopReason, 'no-tool-call')
  assert.equal(sink.has('工具异常'), true)
  assert.match(result.text, /换个说法/)
})

test('模型流里出现 error part 时抛出，交给上层提示用户', async () => {
  const { model } = scriptedModel([{ kind: 'error', error: new Error('401 Unauthorized') }])

  await assert.rejects(
    () => agentLoop(model, tools, [{ role: 'user', content: 'hi' }], 'sys', { logger: silentLogger, write: noWrite }),
    /401 Unauthorized/,
  )
})

test('maxSteps 小于 1 时收敛为 1 步，不会一次都不跑', async () => {
  const { model } = scriptedModel([{ kind: 'text', text: 'ok' }])
  const result = await agentLoop(model, tools, [{ role: 'user', content: 'hi' }], 'sys', {
    maxSteps: 0,
    logger: silentLogger,
    write: noWrite,
  })
  assert.equal(result.steps, 1)
  assert.equal(result.text, 'ok')
})

test('默认步数是 10', () => {
  assert.equal(DEFAULT_MAX_STEPS, 10)
})
