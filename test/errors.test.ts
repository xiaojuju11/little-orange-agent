import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyError, formatAgentError } from '../src/agent/errors'

test('鉴权错误被识别成 auth，并提示去查 API Key', () => {
  const error = new Error('401 Unauthorized: Incorrect API key provided')
  assert.equal(classifyError(error), 'auth')
  assert.match(formatAgentError(error), /DASHSCOPE_API_KEY/)
})

test('429 单独归类，不跟网络错误混在一起', () => {
  const error = new Error('429 Too Many Requests')
  assert.equal(classifyError(error), 'rate-limit')
  assert.match(formatAgentError(error), /429|额度/)
})

test('连接失败算网络问题', () => {
  const error = new Error('fetch failed')
  ;(error as { cause?: unknown }).cause = new Error('connect ECONNREFUSED 127.0.0.1:443')
  assert.equal(classifyError(error), 'network')
  assert.match(formatAgentError(error), /网络|代理/)
})

test('超时单独归类', () => {
  assert.equal(classifyError(new Error('The operation timed out')), 'timeout')
  assert.match(formatAgentError(new Error('ETIMEDOUT')), /超时/)
})

test('未知错误至少把原始信息带出来，不是空串', () => {
  assert.equal(classifyError(new Error('奇怪的问题')), 'unknown')
  assert.match(formatAgentError(new Error('奇怪的问题')), /奇怪的问题/)
  assert.match(formatAgentError('纯字符串错误'), /纯字符串错误/)
})
