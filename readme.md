# 项目起手
1. pnpm init 初始化项目
2. pnpm install typescript --save-dev 安装typescript   
安装ts在开发环境，不包含在生产环境，项目打包时不会出现ts相关文件，--save-dev == -D
3. tsc --init 初始化tsconfig.json

4. pnpm add ai @ai-sdk/openai dotenv   (ai 这个SDK 主要是以openai的标准用来调用openai的api)
5. pnpm add -D tsx @types/node   (tsx是ts的实时运行器，文件一写完，就可以直接跑起来看效果)

# package.json 配置
  "scripts": {
    "dev": "tsx watch src/index.tsx",   
    //当我运行dev这个指令的时候，tsx这个运行器会帮我实时监听src/index.tsx文件并且可以帮我实时转换为js文件
    "start": "tsx src/index.tsx"
    //当我去跑npm start这个指令的时候，会帮我运行src/index.tsx文件
  },
# ai 这个SDK 
用户的问题抛出之后是由ai这个库接管了，然后用ai这个库里面的函数streamText来和千问通信，并且由ai这个库来告诉千问现在的工具列表长什么样子，用变量result来接受由ai这个库和模型通讯返回的结果，那么AI这个库拿到了结果，模型说它要调用工具函数的时候，那么AI这个库就会帮把帮忙把这个工具函数触发掉。触发掉了工具函数得到的结果会被AI这个库自动的再写入到它自己的那个那个桶水桶(fulllString)里面去.
- fullStream  是ai这个库生成的一个水桶（流空间），里面装的是模型的输出，并且当工具调用完成后会自动的将结果添加到水桶中

ai这个包会帮我转成各个模型的格式
- generateText 生成文本
- streamText 流式生成文本
调用这两个方法一定会触发openai里的doGenerate或者doStream这个函数

# 进程持续
- readline 读取用户输入
- process.stdout.write 写入标准输出
- process.stdin.write 写入标准输入
- process.exit 退出进程

# 模型调用三要素
1. 模型调用： StreamConsumer --- 解析工具调用，推理过程程，token用量等多种事件
<!-- streamText + model -->
2. 消息管理： 四层上下文管理 --- 截断、时间衰减修剪、LLM摘要压缩、Cache优化   <!--messages-->
3. 交互循环： AgentLoop --- while(true) {think - act - observe}   
<!-- ask递归调用 -->

主要包括了三个核心的要素，第一是模型的调用。
模型调用的是这个呢， stringtext 加上你的 model，就可以将消息发给模型，然后获得流式响应。
无论 model 背后是假的 mock，还是真实的 API 调用的方式完全都是一致的。
这就是 provider 模式的价值，提 provider 这种模式啊，就是 openai 统一的这种模式。
还有一个是消息管理，你要跟模型聊天，你可以用到一个 messages 数组来存放，每一轮对话都向数组里面 push 一条 user 和一条 assistant。
然后下一轮呢将整个数组传给模型，这也是最基础的上下文管理，叫全量传递，对吧？这是最最原始的、最基础的上下文管理哈，不做任何压缩.
第三点呢就是交互，ask 本身呢是做了一个递归吧，就做了递归呀，形成了一个叫从 readline 再到呢我们的。
就读取用户输入，然后到流式输出，然后再到 push 到 messages 里面去，再到 readline.
是不这么一个循环呢？形成了一个循环。


# 从能聊天到能干活
user: 南昌今天的天气怎么样?
agent: [调用get_waether 工具] -> 南昌今天晴，30摄氏度，东南风2级

- SDK ai 提供的 streamText 方法存在自动循环机制
  用户提问 -> 模型说要调用工具 -> 调用工具 -> 得到工具返回结果 -> 再次调用模型 -> 返回给用户

    - 可定制性太差 --- 我们没有办法在循环的步骤中间插入自定义的逻辑（比如：添加日志、添加缓存、添加错误处理等）



# 上保险丝
1. 死循环检测：连续调用相同工具 + 相同参数？ 打断循环
   1. 通用循环：同一个工具，相同参数，相同结果，重复调用
      - 将工具名+参数做一个确定性的JSON序列化，再哈希加密，
      get_weather({city: '南昌', num: 1}) -> 12x3dasd45fadsa6(文件指纹)
      - 滑动窗口：比如就看最近的30轮有没有重复的文件指纹
      - 同样的输入 + 相同的输出 == 无进展  （只有调用指纹和结果指纹都相同，才认为是无进展的）

   2. 乒乓循环：两个工具，交替调用，结果没有进展
   3. 轮询无进展：不断的poll检查状态，但是状态没有变化

2. Token 预算：烧了多少token？ 超过预算？ 打断循环
   - 把每一步的token用量都记录下来，超过预算后，就打断循环 

3. API容错：请求重试，降低模型
   - 错误要分类，有些错误值得重试，有些错误不值得
   - 指数退避 + 随机抖动


 - 从能跑 到 ‘跑不挂’
 

# 当前进度（2026-11-24）

- 交互：`for await (const line of rl)` 替代递归 `rl.question`。管道输入 / Ctrl+D 读完
  不会再抛 `ERR_USE_AFTER_CLOSE` 崩掉，Ctrl+C 走 close 正常收尾。
- 模型：没配 DASHSCOPE_API_KEY 时用 `src/mock-model.ts`。它现在**也会发工具调用**，
  所以「南昌今天天气怎么样」不填 key 也能看到
  [调用: get_weather] -> [结果] -> 第二轮回答 的完整 agent loop。
- 循环：`agentLoop` 返回 `{ text, steps, toolCalls, stopReason }`；修掉「正常说完话
  也报超过最大限制」的误判；工具自己抛错不打断循环（错误作为 tool-result 回灌）；
  模型/网络错误抛给上层，由 `src/agent/errors.ts` 翻成人话。
- 命令：
  - `pnpm start` 起对话；`pnpm start -- --max-steps=5` 改步数上限（默认 10）
  - `pnpm run typecheck` 等价 `tsc --noEmit`（之前 tsconfig 缺 node 类型，有 15 个报错）
  - `pnpm test` 跑 `node --import tsx --test`，覆盖 loop / mock / 错误分类 22 例

# 自己写 provider 时的坑（做 mock 踩到的）

- 规范 v4 里流式 `tool-call` 的 `input` 必须是 **JSON 字符串**；直接传对象会报
  `toolCall.input.trim is not a function`（SDK 内部先 trim 再 JSON.parse）。
- 工具调用要按顺序发：`tool-input-start` -> `tool-input-delta` -> `tool-input-end`
  -> `tool-call`，最后 `finish` 的 finishReason 用 `tool-calls`。
- `result.response.messages` 里已经包含 assistant 的 tool-call 和对应的 tool 结果，
  整段 push 回 messages 就行，不要自己拼。
