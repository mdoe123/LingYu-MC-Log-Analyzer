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

const FORGE_PREFIX = /^\[([^\]]*)\]\s*\[([^\]]*)\]\s*\[([^\]]*)\]:\s?(.*)$/
const PAREN_PREFIX = /^\[([^\]]*)\]\s*\[([^\]]*)\]\s*\(([^)]*)\):\s?(.*)$/
const GENERIC_PREFIX = /^(?:\[[^\]]*\]\s*)+/

const LEVELS = new Set(['FATAL', 'ERROR', 'WARN', 'WARNING', 'INFO', 'DEBUG', 'TRACE'])

function normalizeLevel(value: string | undefined): string | null {
  if (!value) return null
  const upper = value.trim().toUpperCase()
  if (upper === 'WARNING') return 'WARN'
  return LEVELS.has(upper) ? upper : null
}

export function parseLine(raw: string): LineMeta {
  let time: string | undefined
  let threadRaw: string | undefined
  let logger: string | undefined
  let message = raw

  let match = FORGE_PREFIX.exec(raw)
  if (!match) match = PAREN_PREFIX.exec(raw)

  if (match) {
    time = match[1]
    threadRaw = match[2]
    logger = match[3]
    message = match[4]
  } else {
    const generic = GENERIC_PREFIX.exec(raw)
    if (generic && generic[0].length < raw.length) {
      message = raw.slice(generic[0].length)
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
