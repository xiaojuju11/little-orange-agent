/**
 * 本地模拟模型：不填 DASHSCOPE_API_KEY 也能把整条链路跑通。
 *
 * 它实现的是 AI SDK 的「语言模型规范 v4」：只要提供 doGenerate / doStream
 * 两个方法，它就和真实的 Qwen 在 SDK 眼里没有区别（provider 模式的价值）。
 *
 * 2026-11-24 起支持**工具调用**：问「天气」时会先吐一个 get_weather 的
 * tool-call，等 SDK 把工具结果回灌进来，再基于结果组织回答。
 * 这样没有 API Key 也能看到 agent loop 的 [调用]/[结果] 全过程。
 */

const RESPONSES: Record<string, string> = {
  default: '你好！我是模拟模型。填了 DASHSCOPE_API_KEY 后会自动切换到真实的 Qwen。',
  greeting: '你好！虽然是模拟的，但流式输出的效果和真实 API 一致 :)',
  name: '你刚才告诉我了呀！我能"记住"是因为代码把对话历史传给了我。',
  intro: '我是通义千问（模拟版），在本地模拟回复，机制和真实 API 完全一致。',
  code: '模拟模式下我没有办法真的能写代码，但是流式输出的体验你感受到了，填写真实的apikey体验吧！',
};

/** 模拟模型认识的天气城市，和 tools/utility-tools.ts 里的假数据对齐 */
const WEATHER_CITIES = ['南昌', '北京', '上海']

/** 这些词出现在「…天气」前面时不是城市名 */
const NOT_CITY = ['今天', '明天', '后天', '现在', '这边', '那边', '这里', '那里', '最近']

export interface MockModelOptions {
  /** 每个字之间的延迟，模拟打字机效果；测试里传 0 */
  delayMs?: number
}

export type MockPlan =
  | { kind: 'text'; text: string }
  | { kind: 'tool-call'; toolName: string; input: Record<string, unknown> }

function getMsgText(msg: any): string {
  const content = msg?.content
  if (typeof content === 'string') return content // 老式 {role, content: 'xxx'}
  if (!Array.isArray(content)) return ''
  return content.map((part: any) => (typeof part === 'string' ? part : part?.text ?? '')).join('')
}

function lastUserText(prompt: any[]): string {
  const userMsgs = (prompt || []).filter((m: any) => m.role === 'user');
  const last = userMsgs[userMsgs.length - 1];
  if (!last) return '';
  return getMsgText(last).toLowerCase();
}

function findUserName(prompt: any[]): string | null {
  const userMsgs = (prompt || []).filter((m: any) => m.role === 'user');
  for (const msg of userMsgs) {
    const text = getMsgText(msg);
    const match = text.match(/(?:我(?:叫|是|的名字(?:是|叫)?))\s*(\S{1,10})/);
    if (match) return match[1];
  }
  return null;
}

/** 把 tool-result 的 output 归一化成一行文本（SDK 有 text/json/content/error 多种形状） */
function toolOutputText(output: any): string {
  if (output == null) return ''
  switch (output.type) {
    case 'text':
    case 'error-text':
      return String(output.value ?? '')
    case 'json':
    case 'error-json':
      return JSON.stringify(output.value)
    case 'content':
      return (output.value || []).map((p: any) => p?.text ?? '').join('')
    default:
      return typeof output === 'string' ? output : JSON.stringify(output)
  }
}

/**
 * 只看**最后一条**消息是不是工具返回。
 * 不能扫整个 prompt：否则后面聊别的话题时，模型还会拿上一轮的天气结果答话。
 */
function pendingToolResult(prompt: any[]): { toolName: string; text: string } | null {
  const list = prompt || []
  const last = list[list.length - 1]
  if (last?.role !== 'tool') return null
  const parts = Array.isArray(last.content) ? last.content : []
  for (const part of parts) {
    if (part?.type !== 'tool-result') continue
    return { toolName: part.toolName, text: toolOutputText(part.output) }
  }
  return null
}

export function extractCity(text: string): string | null {
  for (const city of WEATHER_CITIES) {
    if (text.includes(city)) return city
  }
  const matched = text.match(/([\u4e00-\u9fa5]{2,6}?)(?:今天|明天|现在|的)?的?天气/)
  if (!matched) return null
  const candidate = matched[1]
  return NOT_CITY.includes(candidate) ? null : candidate
}

/** 决定这一轮要说什么 / 要不要调工具 */
export function planResponse(prompt: any[]): MockPlan {
  const toolResult = pendingToolResult(prompt)
  if (toolResult) {
    return {
      kind: 'text',
      text: `[模拟] 我调用 ${toolResult.toolName} 拿到了结果：${toolResult.text}。`,
    }
  }

  const last = lastUserText(prompt)

  if (last.includes('天气')) {
    const city = extractCity(last)
    if (!city) {
      return { kind: 'text', text: '你想查哪个城市的天气？比如「南昌今天天气怎么样」。' }
    }
    return { kind: 'tool-call', toolName: 'get_weather', input: { city } }
  }

  if (last.includes('介绍你自己') || last.includes('你是谁')) {
    return { kind: 'text', text: RESPONSES.intro }
  }

  const name = findUserName(prompt)
  if (last.includes('你好') || last.includes('hello') || last.includes('hi')) {
    return {
      kind: 'text',
      text: name ? `你好${name}！很高兴认识你，有什么我能帮你的吗？` : '你好！很高兴认识你，有什么我能帮你的吗？',
    }
  }
  if (last.includes('叫什么') || last.includes('名字') || last.includes('记得') || last.includes('记住')) {
    return {
      kind: 'text',
      text: name ? `你说你叫${name}呀 :)` : '你还没告诉我你的名字呢，要不先自我介绍一下？',
    }
  }
  if (last.includes('代码') || last.includes('code') || last.includes('函数')) {
    return { kind: 'text', text: RESPONSES.code }
  }
  return { kind: 'text', text: RESPONSES.default }
}

const USAGE = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 20, text: 20, reasoning: undefined },
};

// 模拟模型的流式输出
function createDelayedStream(chunks: any[], delayMs = 30) {
  // chunks = [{type: 'text-start', id}, {type: 'text-delta', id, delta: '你'}, {type: 'text-delta', id, delta: '好'}, ...]
  return new ReadableStream({//js本身提供的流式输出
    start(controller) {
      let i = 0;
      function next() {
        if (i < chunks.length) {
          controller.enqueue(chunks[i]);
          i++;
          if (delayMs > 0) setTimeout(next, delayMs)
          else next()
        } else {
          controller.close()
        }
      }
      next()
    }
  })
}

export function createMockModel(options: MockModelOptions = {}) {
  const delayMs = options.delayMs ?? 30

  return {
    specificationVersion:'v4' as const,
    provider:'mock',
    modelId:'mock-model',

    async doGenerate({prompt}:any){
      const plan = planResponse(prompt)
      if (plan.kind === 'tool-call') {
        return {
          // 注意：规范 v4 里 tool-call 的 input 必须是 **JSON 字符串**，不是对象，
          // 否则 SDK 执行工具时会报 "input.trim is not a function"
          content:[{type:'tool-call' as const, toolCallId:'mock-call-1', toolName: plan.toolName, input: JSON.stringify(plan.input)}],
          finishReason:{unified:'tool-calls' as const,raw:undefined},
          usage:USAGE,
          warnings:[],
        }
      }
      return {
        content:[{type:'text' as const,text:plan.text}],
        finishReason:{unified:'stop' as const,raw:undefined},
        usage:USAGE,
        warnings:[],
      }
    },

    async doStream({ prompt }: any) {
      const plan = planResponse(prompt)
      let chunks: any[]

      if (plan.kind === 'tool-call') {
        // 工具调用也是流式的：先声明工具名，再一点点吐 JSON 参数
        const json = JSON.stringify(plan.input)
        chunks = [
          { type: 'tool-input-start', id: 'mock-call-1', toolName: plan.toolName },
          { type: 'tool-input-delta', id: 'mock-call-1', delta: json },
          { type: 'tool-input-end', id: 'mock-call-1' },
          { type: 'tool-call', toolCallId: 'mock-call-1', toolName: plan.toolName, input: json },
          { type: 'finish', finishReason: { unified: 'tool-calls', raw: undefined }, usage: USAGE },
        ]
      } else {
        const id = 'text-1';
        chunks = [
          { type: 'text-start', id },
          ...plan.text.split('').map((char: string) => ({ type: 'text-delta', id, delta: char })),
          { type: 'text-end', id },
          { type: 'finish', finishReason: { unified: 'stop', raw: undefined }, usage: USAGE },
        ];
      }

      return { stream: createDelayedStream(chunks, delayMs) };
    },
  }
}
