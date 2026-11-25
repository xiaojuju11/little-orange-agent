import test from 'node:test'
import assert from 'node:assert/strict'
import type { ModelMessage, ToolSet } from 'ai'
import { agentLoop } from '../src/agent/loop'
import { weatherTool } from '../src/tools/utility-tools'
import { collectingLogger, noWrite, scriptedModel, silentLogger } from './fake-model'

const tools: ToolSet = { get_weather: weatherTool }

test('工具反复同参调用会在第 8 步熔断，不把步数用完', async () => {
  const { model } = scriptedModel([{ kind: 'tool-call', toolName: 'get_weather', input: { city: '南昌' } }])
  const sink = collectingLogger()

  const result = await agentLoop(model, tools, [{ role: 'user', content: '查天气' }], 'sys', {
    maxSteps: 20,
    logger: sink.logger,
    write: noWrite,
  })

  assert.equal(result.steps, 8, '熔断发生在第 8 次重复调用，而不是跑满 20 步')
  assert.equal(result.toolCalls, 8)
  assert.equal(result.stopReason, 'circuit-breaker')
  assert.equal(sink.has('[熔断] get_weather 相同参数已调用 8 次'), true)
})

test('熔断后上下文里不留「有 tool-call 没 tool 结果」的半截消息', async () => {
  const { model } = scriptedModel([{ kind: 'tool-call', toolName: 'get_weather', input: { city: '南昌' } }])
  const messages: ModelMessage[] = [{ role: 'user', content: '查天气' }]

  await agentLoop(model, tools, messages, 'sys', { maxSteps: 20, logger: silentLogger, write: noWrite })

  const last = messages[messages.length - 1]
  assert.equal(last.role, 'tool')
})

test('警告在工具结果之后注入下一轮上下文，模型能看到提示', async () => {
  const { model } = scriptedModel([{ kind: 'tool-call', toolName: 'get_weather', input: { city: '南昌' } }])
  const messages: ModelMessage[] = [{ role: 'user', content: '查天气' }]

  const result = await agentLoop(model, tools, messages, 'sys', {
    maxSteps: 6,
    logger: silentLogger,
    write: noWrite,
  })

  assert.equal(result.stopReason, 'max-steps', '6 步还没到熔断阈值 8')
  const warned = messages.some(
    (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[警告]'),
  )
  assert.equal(warned, true, '第 5 步的警告应回灌到上下文')
  // 注入的提示必须排在工具结果之后，否则模型看到的上下文顺序是乱的
  const toolIdx = messages.findIndex((m) => m.role === 'tool')
  const warnIdx = messages.findIndex(
    (m) => m.role === 'user' && typeof m.content === 'string' && m.content.includes('[警告]'),
  )
  assert.ok(toolIdx >= 0 && warnIdx > toolIdx)
})

test('上一轮的调用记录不会带进新一轮', async () => {
  for (let i = 0; i < 3; i++) {
    // 每轮新建模型：scriptedModel 剧本用完后会重复最后一条（text）
    const { model } = scriptedModel([
      { kind: 'tool-call', toolName: 'get_weather', input: { city: '南昌' } },
      { kind: 'text', text: '说完了' },
    ])
    const result = await agentLoop(model, tools, [{ role: 'user', content: '查天气' }], 'sys', {
      maxSteps: 5,
      logger: silentLogger,
      write: noWrite,
    })
    assert.equal(result.stopReason, 'no-tool-call')
    assert.equal(result.toolCalls, 1, '每轮只该记自己的调用')
  }
})
