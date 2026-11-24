import 'dotenv/config'
import type { LanguageModel, ModelMessage } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import { createMockModel } from './mock-model'
import { createInterface } from 'readline'
import { weatherTool } from './tools/utility-tools'
import { agentLoop, DEFAULT_MAX_STEPS } from './agent/loop'
import { formatAgentError } from './agent/errors'

const tools = { get_weather: weatherTool }

const system = `你是 Super Agent，一个有工具调用能力的AI助手。需要时主动使用工具获取信息，不要编造数据`

const EXIT_WORDS = new Set(['exit', 'quit', 'q'])

/** 支持 `--max-steps=5` 和 `--max-steps 5` 两种写法 */
function parseMaxSteps(argv: string[]): number {
  const args = argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    const inline = args[i].match(/^--max-steps=(\d+)$/)
    if (inline) return Math.max(1, Number(inline[1]))
    if (args[i] === '--max-steps' && args[i + 1] && /^\d+$/.test(args[i + 1])) {
      return Math.max(1, Number(args[i + 1]))
    }
  }
  return DEFAULT_MAX_STEPS
}

function prompt(): void {
  process.stdout.write('\nYou: ')
}

async function main() {
  const maxSteps = parseMaxSteps(process.argv)
  const useMock = !process.env.DASHSCOPE_API_KEY

  // 只有真的要用真模型时才构造 provider：没 key 时不去碰 openai 客户端
  let model: LanguageModel
  if (useMock) {
    model = createMockModel() as unknown as LanguageModel
  } else {
    const qwen = createOpenAI({
      baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKey: process.env.DASHSCOPE_API_KEY,
    })
    model = qwen.chat('qwen-plus-latest') as unknown as LanguageModel
  }

  const messages: ModelMessage[] = []

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  // Ctrl+C：不要直接把进程干掉，先让当前 readline 收尾（否则对话上下文会丢）
  rl.on('SIGINT', () => {
    process.stdout.write('\n')
    console.log('收到 Ctrl+C，退出。')
    rl.close()
  })

  console.log(
    `Super Agent v0.3 - Agent Loop（模型：${useMock ? 'mock，未配置 DASHSCOPE_API_KEY' : 'qwen-plus-latest'}，最大步数：${maxSteps}）`,
  )
  console.log('输入 exit / quit 退出。试试「南昌今天天气怎么样」，模拟模型也会走工具调用。')

  prompt()

  // 用 for await 读 readline：Ctrl+D / 管道输入读完后循环自然结束。
  // 原实现递归 rl.question，输入流一关就抛 ERR_USE_AFTER_CLOSE 崩溃。
  for await (const line of rl) {
    const input = line.trim()

    if (!input) {
      prompt()
      continue
    }
    if (EXIT_WORDS.has(input.toLowerCase())) break

    messages.push({ role: 'user', content: input })

    try {
      // 循环内部的「已达到最大步数」提示由 agentLoop 自己打印，
      // 这里只需要把异常接住，别让一次失败带走整个进程
      await agentLoop(model, tools, messages, system, { maxSteps })
    } catch (error) {
      // 失败的一轮不进上下文：留着半截 user 消息会让下一轮问答对不上
      messages.pop()
      console.error(`\n${formatAgentError(error)}`)
    }

    prompt()
  }

  console.log('Bye!')
}

main().catch((error) => {
  console.error(formatAgentError(error))
  process.exitCode = 1
})

// ===== 历史版本（留作对照，别删） =====
// import { streamText, type ModelMessage, stepCountIs } from 'ai'
//
// async function main() {
//   const result = streamText({
//     model: model as any,
//     prompt: '用一句话介绍你自己',
//   })
//
//   for await (const chunk of result.textStream) {
//     process.stdout.write(chunk)
//   }
// }
// main()
//
// function ask() {
//   rl.question('\nYou:', async(input) => {
//     const trimmed = input.trim();
//     if (!trimmed || trimmed === 'exit') {
//       console.log('Bye!');
//       rl.close();
//       return;
//     }
//
//     messages.push({ role: 'user', content: trimmed });
//
//     const result = streamText({
//       model: model as any,
//       system: `你是 Super Agent，一个有工具调用能力的AI助手。需要时主动使用工具获取信息，不要编造数据`,
//       tools,
//       messages,
//       stopWhen: stepCountIs(5),
//     })
//
//     process.stdout.write('Assistant:')
//     let fullResponse = ''
//     for await (const part of result.fullStream) {
//       switch (part.type) {
//         case 'text-delta':
//           process.stdout.write(part.text)
//           fullResponse += part.text
//           break;
//         case 'tool-call':
//           console.log(`\n [调用工具] ${part.toolName}(${JSON.stringify(part.input)})`);
//           break;
//         case 'tool-result':
//           console.log(`\n [工具返回] ${JSON.stringify(part.output)}`);
//           break;
//       }
//     }
//
//     console.log();  // 换行
//
//     messages.push({ role: 'assistant', content: fullResponse });
//     ask();
//   })
// }
