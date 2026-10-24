export interface LineMeta {
  level: string
  thread?: string
  logger?: string
  message: string
}

export interface StackBlock {
  index: number
  startLine: number
  exceptionType: string
  lines: string[]
  level: string
}

export interface ParsedLog {
  file: string
  lines: string[]
  meta: (LineMeta | null)[]
  blocks: StackBlock[]
  errors: number
  warnings: number
  lineOffset: number
  truncated: boolean
}

const MAX_LINES = 300000

/**
 * 四种日志行前缀，按「信息量从多到少」排列：
 *
 * 1. Forge / NeoForge：`[12:04:27] [main/INFO] [net.minecraftforge.fml.loading.ModSorter/]: msg`
 *    第三段是 logger，Forge 侧习惯带一个结尾斜杠（log4j2 的 `%c{1.}` 摘要形式）。
 * 2. Fabric / Quilt 及部分第三方启动器：`[12:04:27] [main/INFO] (QuiltLoader) msg`
 *    括号内是 logger，冒号可有可无。
 * 3. 原版 / Fabric / Quilt 标准形式：`[12:04:27] [main/INFO]: msg`（无 logger）
 * 4. 启动器剥离时间戳后的形式：`[main/INFO] [FML]: msg`，首段即 `线程/级别`。
 *
 * 注意顺序：3 段方括号的形式必须先于「线程/级别」形式匹配，否则 logger 会被当成消息的一部分。
 */
const FORGE_PREFIX = /^\[([^\]]*)\]\s*\[([^\]]*)\]\s*\[([^\]]*)\]:\s?(.*)$/
const PAREN_PREFIX = /^\[([^\]]*)\]\s*\[([^\]]*)\]\s*\(([^)]*)\):?\s?(.*)$/
const BARE_THREAD_PREFIX = /^\[([^\]]*\/[A-Za-z]+)\]:?\s*(?:\[([^\]]*)\]:?\s*)?(.*)$/
const GENERIC_PREFIX = /^(?:\[[^\]]*\]\s*)+/

const LEVELS = new Set(['FATAL', 'ERROR', 'WARN', 'WARNING', 'INFO', 'DEBUG', 'TRACE'])

function normalizeLevel(value: string | undefined): string | null {
  if (!value) return null
  const upper = value.trim().toUpperCase()
  if (upper === 'WARNING') return 'WARN'
  return LEVELS.has(upper) ? upper : null
}

/** Forge 系日志的 logger 常带结尾斜杠（`ModSorter/`、`mixin/`），统一去掉便于比对 */
function stripLoggerSuffix(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().replace(/\/+$/, '')
  return trimmed || undefined
}

export function parseLine(raw: string): LineMeta {
  let time: string | undefined
  let threadRaw: string | undefined
  let logger: string | undefined
  let message = raw

  const forge = FORGE_PREFIX.exec(raw)
  const paren = forge ? null : PAREN_PREFIX.exec(raw)
  const bare = forge || paren ? null : BARE_THREAD_PREFIX.exec(raw)

  if (forge) {
    time = forge[1]
    threadRaw = forge[2]
    logger = stripLoggerSuffix(forge[3])
    message = forge[4]
  } else if (paren) {
    time = paren[1]
    threadRaw = paren[2]
    logger = stripLoggerSuffix(paren[3])
    message = paren[4]
  } else if (bare) {
    threadRaw = bare[1]
    logger = stripLoggerSuffix(bare[2])
    message = bare[3]
  } else {
    const generic = GENERIC_PREFIX.exec(raw)
    if (generic && generic[0].length < raw.length) {
      // `[12:00:00] [main/INFO]: msg` 的前缀正则不含冒号，残留的 `: ` 要去掉
      message = raw.slice(generic[0].length).replace(/^:\s?/, '')
      const groups = raw.slice(0, generic[0].length).match(/\[([^\]]*)\]/g) ?? []
      if (groups.length >= 2) threadRaw = groups[1].replace(/[[\]]/g, '')
    }
  }

  let level: string | null = null
  if (threadRaw) {
    const slash = threadRaw.lastIndexOf('/')
    if (slash >= 0) {
      level = normalizeLevel(threadRaw.slice(slash + 1))
      threadRaw = threadRaw.slice(0, slash)
    }
  }

  if (!level) {
    if (/\/FATAL\]/.test(raw)) level = 'FATAL'
    else if (/\/ERROR\]|\bERROR\b/.test(raw)) level = 'ERROR'
    else if (/\/WARN\]|\bWARN\b/.test(raw)) level = 'WARN'
  }

  return { level: level ?? '', thread: threadRaw, logger, message: message ?? raw }
}

function looksLikeStart(trimmed: string): boolean {
  if (trimmed.startsWith('at ') || trimmed.startsWith('...')) return false
  if (/^Caused by:/.test(trimmed) || /^Suppressed:/.test(trimmed)) return true
  return /(?:^|[\s:])((?:[a-zA-Z_$][\w$]*\.)*[A-Z][\w$]*(?:Exception|Error|Throwable))(?::|\s*$)/.test(
    trimmed
  )
}

function isContinuation(trimmed: string, raw: string): boolean {
  if (!trimmed) return false
  if (trimmed.startsWith('at ') || trimmed.startsWith('...')) return true
  if (/^Caused by:/.test(trimmed) || /^Suppressed:/.test(trimmed)) return true
  if (raw.startsWith('\t') || raw.startsWith('    ')) return true
  return false
}

function exceptionTypeOf(text: string): string {
  const match = /((?:[a-zA-Z_$][\w$]*\.)*[A-Z][\w$]*(?:Exception|Error|Throwable))/.exec(text)
  return match ? match[1] : 'UnknownException'
}

export function parseLog(file: string, text: string, truncated: boolean): ParsedLog {
  let lines = text.split('\n')
  let lineOffset = 0
  let wasTruncated = truncated

  if (lines.length > MAX_LINES) {
    lineOffset = lines.length - MAX_LINES
    lines = lines.slice(lineOffset)
    wasTruncated = true
  }

  const meta: (LineMeta | null)[] = new Array(lines.length)
  const blocks: StackBlock[] = []
  let errors = 0
  let warnings = 0

  for (let i = 0; i < lines.length; i += 1) {
    const info = parseLine(lines[i])
    meta[i] = info
    if (info.level === 'ERROR' || info.level === 'FATAL') errors += 1
    else if (info.level === 'WARN') warnings += 1
  }

  for (let i = 0; i < lines.length; i += 1) {
    const info = meta[i]
    if (!info) continue
    const trimmed = info.message.trim()
    const next = meta[i + 1]
    const nextIsContinuation = Boolean(
      next && next.message.trim() && isContinuation(next.message.trim(), lines[i + 1] ?? '')
    )
    const isErrorLevel = info.level === 'ERROR' || info.level === 'FATAL'

    if (!looksLikeStart(trimmed) && !(isErrorLevel && nextIsContinuation)) continue

    const startLine = i + 1 + lineOffset
    const collected = [lines[i]]
    let j = i + 1
    let guard = 0

    while (j < lines.length && guard < 80) {
      const next = meta[j]
      if (!next) break
      const nextTrimmed = next.message.trim()
      if (!nextTrimmed) break
      if (!isContinuation(nextTrimmed, lines[j])) break
      collected.push(lines[j])
      j += 1
      guard += 1
    }

    blocks.push({
      index: i,
      startLine,
      exceptionType: exceptionTypeOf(trimmed),
      lines: collected,
      level: info.level || 'ERROR'
    })

    i = j - 1
  }

  return {
    file,
    lines,
    meta,
    blocks,
    errors,
    warnings,
    lineOffset,
    truncated: wasTruncated
  }
}

export function lineNumberOf(log: ParsedLog, index: number): number {
  return index + 1 + log.lineOffset
}

export function blockAt(log: ParsedLog, index: number): StackBlock | undefined {
  return log.blocks.find((block) => index >= block.index && index < block.index + block.lines.length)
}
