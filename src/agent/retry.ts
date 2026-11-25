// 判断是否需要重试
export function isRetryable(error: unknown) {
    if (!(error instanceof Error)) {
        return false
    }

    const message = error.message || ''

    //HTTP 状态码判断
    // 只取「前后都不是数字」的三位数，避免把 "4290 tokens"、"耗时 1500ms"
    // 这类更长数字的前三位误判成状态码；[1-5] 限定在合法状态码区间。
    const statusMatch = message.match(/(?<!\d)([1-5]\d{2})(?!\d)/)
    if (statusMatch) {
        const status = parseInt(statusMatch[1])
        if ([429, 529, 408].includes(status)) return true  // 限流 / 服务过载 / 请求超时
        if (status >= 500 && status < 600) return true  // 服务器错误  LLM的问题
        // 其余 4xx（403/404/422...）是客户端永久错误，重试不会成功，只会白等
        // 退避时间并放大请求量；这里不返回 true，继续交给下面的网络错误判断。
    }

    // 网络错误
    if (message.includes('ECONNRESET') || message.includes('EPIPE')) return true;
    if (message.includes('ETIMEDOUT') || message.includes('timeout')) return true;
    if (message.includes('fetch failed') || message.includes('network')) return true;
    // AI SDK 会把流式错误包装成 NoOutputGeneratedError
    if (message.includes('No output generated')) return true;

    return false;

}

// 指数退避 + 随机抖动
//重试次数越多，等待时间指数翻倍；设置最大等待时间封顶。
//在计算出的延迟基础上，增加 ±25% 随机抖动，避免多个请求同时重试引发惊群效应。最后取整，并保证延迟不会小于 0。
export function calculateDelay(attemp:number,baseMs = 500,maxMs = 30000){
    // 非有限入参会算成 NaN，而 sleep(NaN) 被 setTimeout 当作 0，会退化成没有退避的紧密重试
    const attempt = Number.isFinite(attemp) ? Math.max(1, attemp) : 1
    const base = Number.isFinite(baseMs) && baseMs >= 0 ? baseMs : 500
    const cap = Number.isFinite(maxMs) && maxMs >= 0 ? maxMs : 30000

    const exponential = base * Math.pow(2, attempt - 1)
    const capped = Math.min(exponential, cap)
    const jitterRange = capped * 0.25
    const jittered = capped + (Math.random() * 2 - 1) * jitterRange
    // 抖动之后必须再夹一次上限，否则 +25% 会让返回值突破 maxMs（30000 -> 37500）
    return Math.min(cap, Math.max(0, Math.round(jittered)))
}

export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}