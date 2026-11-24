import test from 'node:test'
import assert from 'node:assert/strict'
import { extractCity, planResponse } from '../src/mock-model'

function user(text: string) {
  return { role: 'user', content: [{ type: 'text', text }] }
}

function oldStyleUser(text: string) {
  return { role: 'user', content: text }
}

function toolResult(toolName: string, value: string) {
  return {
    role: 'tool',
    content: [
      { type: 'tool-result', toolCallId: 'call-1', toolName, output: { type: 'text', value } },
    ],
  }
}

test('问天气时先发工具调用，参数是城市名', () => {
  const plan = planResponse([user('南昌今天天气怎么样')])
  assert.deepEqual(plan, { kind: 'tool-call', toolName: 'get_weather', input: { city: '南昌' } })

  const beijing = planResponse([user('北京天气')])
  assert.deepEqual(beijing, { kind: 'tool-call', toolName: 'get_weather', input: { city: '北京' } })
})

test('问到没数据登记的城市也照样发工具调用，由工具返回「未找到」', () => {
  const plan = planResponse([user('广州明天天气怎么样')])
  assert.deepEqual(plan, { kind: 'tool-call', toolName: 'get_weather', input: { city: '广州' } })
})

test('没说城市时反问，而不是瞎猜一个城市去调工具', () => {
  const plan = planResponse([user('今天天气怎么样')])
  assert.equal(plan.kind, 'text')
  assert.match((plan as { text: string }).text, /哪个城市/)
})

test('城市名抽取能跳过「今天/明天」这类时间词', () => {
  assert.equal(extractCity('今天天气怎么样'), null)
  assert.equal(extractCity('明天天气'), null)
  assert.equal(extractCity('杭州天气'), '杭州')
  assert.equal(extractCity('上海今天天气'), '上海')
})

test('收到工具结果后，基于结果组织回答', () => {
  const plan = planResponse([
    user('南昌天气'),
    {
      role: 'assistant',
      content: [{ type: 'tool-call', toolCallId: 'call-1', toolName: 'get_weather', input: '{"city":"南昌"}' }],
    },
    toolResult('get_weather', '晴,30摄氏度,东南风2级'),
  ])
  assert.equal(plan.kind, 'text')
  assert.match((plan as { text: string }).text, /晴,30摄氏度/)
})

test('老工具结果不会串到新话题上', () => {
  const plan = planResponse([
    user('南昌天气'),
    toolResult('get_weather', '晴,30摄氏度'),
    user('你好'),
  ])
  assert.equal(plan.kind, 'text')
  assert.match((plan as { text: string }).text, /你好/)
  assert.doesNotMatch((plan as { text: string }).text, /30摄氏度/)
})

test('content 是字符串的老式消息也不会崩（回归）', () => {
  assert.doesNotThrow(() => planResponse([oldStyleUser('你好')]))
  const plan = planResponse([oldStyleUser('你好')])
  assert.equal(plan.kind, 'text')
  assert.match((plan as { text: string }).text, /很高兴认识你/)
})

test('仍能记住名字，说明多轮上下文没坏', () => {
  const plan = planResponse([user('我叫小明'), user('你好')])
  assert.match((plan as { text: string }).text, /小明/)
})

test('json 形状的工具输出也能读出来', () => {
  const plan = planResponse([
    user('南昌天气'),
    {
      role: 'tool',
      content: [
        { type: 'tool-result', toolCallId: 'c', toolName: 'get_weather', output: { type: 'json', value: { text: '雷阵雨' } } },
      ],
    },
  ])
  assert.match((plan as { text: string }).text, /雷阵雨/)
})
