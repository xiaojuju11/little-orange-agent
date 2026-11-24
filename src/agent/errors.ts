/**
 * 把模型/网络抛出来的各种错误翻译成人话，避免 REPL 直接崩掉或只吐一堆栈。
 * 分类只用来提示用户「该去查什么」，不参与重试决策。
 */

export type AgentErrorKind = 'auth' | 'rate-limit' | 'timeout' | 'network' | 'unknown'

export function classifyError(error: unknown): AgentErrorKind {
  const message = errorMessage(error)

  if (/401|403|unauthorized|invalid api key|incorrect api key|api key/i.test(message)) return 'auth'
  if (/429|rate limit|too many requests|quota/i.test(message)) return 'rate-limit'
  if (/timeout|timed out|etimedout|aborted|abortsignal/i.test(message)) return 'timeout'
  if (/fetch failed|econnrefused|econnreset|enotfound|eai_again|socket hang up|network/i.test(message)) return 'network'
  return 'unknown'
}

/** 一行或多行的中文提示，直接 console.error 即可 */
export function formatAgentError(error: unknown): string {
  const message = errorMessage(error)
  const kind = classifyError(error)

  switch (kind) {
    case 'auth':
      return `鉴权失败：请检查 .env 里的 DASHSCOPE_API_KEY 是否正确、是否已过期。\n  原始错误：${message}`
    case 'rate-limit':
      return `请求太频繁或额度用完（429）：稍等一会儿再试，或去控制台看看配额。\n  原始错误：${message}`
    case 'timeout':
      return `请求超时：网络抖动或模型响应太慢，可以重试一次。\n  原始错误：${message}`
    case 'network':
      return `网络不通：检查代理/VPN 是否能访问 dashscope.aliyuncs.com。\n  原始错误：${message}`
    default:
      return `这一轮请求失败了：${message}`
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause
    const causeText = cause instanceof Error ? ` (cause: ${cause.message})` : ''
    return `${error.name}: ${error.message}${causeText}`
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
