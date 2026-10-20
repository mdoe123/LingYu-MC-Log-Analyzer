import type {
  AiAnalysis,
  AiFix,
  BaseAnalysis,
  EvidenceItem,
  Settings
} from '../../shared/types'
import { lineNumberOf } from './parse'
import type { LogSource } from './rules'

export interface AiContext {
  base: BaseAnalysis
  sources: LogSource[]
  modJars: string[]
}

const MAX_PACK_CHARS = 38000

function redact(text: string): string {
  return text
    .replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, '<ip>')
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
    .replace(/(Setting user:\s*)\S+/g, '$1<player>')
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text
  return `${text.slice(0, limit)}\n…（已截断）`
}

function blockText(source: LogSource, startIndex: number, lineCount = 16): string {
  const start = Math.max(0, startIndex)
  const end = Math.min(source.log.lines.length, start + lineCount)
  return source.log.lines.slice(start, end).join('\n')
}

function errorBlocks(sources: LogSource[], limit: number): string {
  const parts: string[] = []
  const seen = new Set<string>()
  let count = 0

  const ordered = [...sources].sort((a, b) => {
    const rank = (kind: string): number =>
      kind === 'latest' ? 0 : kind === 'crash' ? 1 : kind === 'debug' ? 2 : kind === 'fml' ? 3 : 4
    return rank(a.file.kind) - rank(b.file.kind)
  })

  for (const source of ordered) {
    if (count >= limit) break
    for (const block of source.log.blocks) {
      if (count >= limit) break
      const signature = block.exceptionType
      if (seen.has(signature)) continue
      seen.add(signature)
      parts.push(
        `### ${source.file.path} 第 ${block.startLine} 行（${signature}）\n\`\`\`\n${clip(
          block.lines.slice(0, 18).join('\n'),
          2600
        )}\n\`\`\``
      )
      count += 1
    }
  }

  return parts.length > 0 ? parts.join('\n\n') : '（未提取到异常块）'
}

export function buildEvidencePack(context: AiContext, settings: Settings): string {
  const { base } = context
  const env = base.environment

  const crashSection =
    base.crashReports.length > 0
      ? base.crashReports
          .map((crash) => {
            const chain = crash.causedByChain.length
              ? crash.causedByChain.map((item, index) => `  ${index + 1}. ${item}`).join('\n')
              : '  （无 Caused by 链）'
            return [
              `### ${crash.file}`,
              `Description: ${crash.description || '（空）'}`,
              `异常类型: ${crash.exceptionType ?? '未知'}`,
              `Caused by 链（最后一条为根因）:`,
              chain,
              `首个非原版堆栈帧: ${crash.firstForeignFrame ?? '未找到'}`,
              '报告头部:',
              '```',
              clip(crash.head, 2400),
              '```'
            ].join('\n')
          })
          .join('\n\n')
      : '（导出包中无崩溃报告，属正常现象）'

  const findingsSection =
    base.findings.length > 0
      ? base.findings
          .map((hit) => {
            const evidence = hit.evidence
              .map((item) => `    - ${item.file}:${item.line}`)
              .join('\n')
            return `- [${hit.severity}] ${hit.title}：${hit.detail}${evidence ? `\n  证据位置:\n${evidence}` : ''}`
          })
          .join('\n')
      : '（规则引擎未命中已知签名）'

  const suspectsSection =
    base.suspects.length > 0
      ? base.suspects.map((item) => `- ${item.name}${item.version ? ` ${item.version}` : ''}（${item.reason}）`).join('\n')
      : '（无明确嫌疑对象）'

  const modSection =
    context.modJars.length > 0
      ? clip(context.modJars.slice(0, 120).join(', '), 3000)
      : '（导出包中未包含 mods 目录，无法列出模组清单）'

  const signatureSection = base.signatures
    .map((item) => `- ${item.keyword}: ${item.count} 次${item.file ? `（首次出现于 ${item.file}:${item.line}）` : ''}`)
    .join('\n')

  const pack = [
    '## 运行环境',
    [
      `启动器: ${env.launcher ?? '未知'}`,
      `加载器: ${env.loader ?? '未知'}`,
      `游戏版本: ${env.mcVersion ?? '未知'}`,
      `Java: ${env.javaVersion ?? '未知'}`,
      `最大内存: ${env.memoryMaxMb ? `${env.memoryMaxMb} MB` : '未知'}`,
      `模组数量: ${env.modCount ?? '未知'}`,
      `系统: ${env.os ?? '未知'}`
    ].join('\n'),
    '',
    '## 本地规则判定',
    `阶段: ${base.stageGuess.label}（置信度 ${base.stageGuess.confidence}）—— ${base.stageGuess.reason}`,
    `统计: 共 ${base.stats.totalLines} 行，ERROR ${base.stats.errors} 条，WARN ${base.stats.warnings} 条，异常块 ${base.stats.exceptionBlocks} 个`,
    '',
    '### 特征关键词统计',
    signatureSection || '（无）',
    '',
    '### 规则命中',
    findingsSection,
    '',
    '### 候选嫌疑对象',
    suspectsSection,
    '',
    '## 崩溃报告',
    crashSection,
    '',
    '## 关键异常片段',
    errorBlocks(context.sources, Math.max(2, Math.min(settings.maxEvidence, 10))),
    '',
    '## 模组清单',
    modSection
  ].join('\n')

  const finalText = settings.redact ? redact(pack) : pack
  return clip(finalText, MAX_PACK_CHARS)
}

export function buildSystemPrompt(settings: Settings): string {
  const language = settings.language === 'en' ? 'English' : '简体中文'
  return [
    '你是一名 Minecraft 崩溃日志分析专家，擅长 Forge / NeoForge / Fabric 生态的启动失败与运行期崩溃归因。',
    '',
    '分析纪律（必须遵守）：',
    '1. 先判定失败发生在哪个阶段：启动器拉起 → 游戏/模组初始化 → 运行期。不同阶段对应不同证据，不要混着推断。',
    '2. 若存在崩溃报告，以它为主：看头部环境（Java 版本、内存），Caused by 链中最后一条才是根因。',
    '3. 在 Caused by 的堆栈里向下找第一个非 net.minecraft、非 java. 的包名，它通常指向具体模组。',
    '4. 无崩溃报告时依靠日志关键词：Exception/ERROR、OutOfMemoryError、NoClassDefFoundError/ClassNotFoundException、Mixin apply failed。',
    '5. 出现 hs_err_pid 说明是 JVM 崩溃（驱动、原生库、Java 版本），不要按模组冲突解释。',
    '6. 只使用材料中出现的模组名与版本，禁止编造。不确定时降低 confidence 并在 summary 中说明还需要什么信息。',
    '7. 修复建议要可执行：给出具体操作、明确先后顺序；涉及模组冲突时推荐二分法。',
    '',
    `输出语言：${language}。`,
    '只输出一个 JSON 对象，不要输出 Markdown 代码块或任何解释文字。JSON 结构如下：',
    '{',
    '  "severity": "critical|high|medium|low",',
    '  "title": "不超过 40 字的结论标题",',
    '  "summary": "一到两句话的结论",',
    '  "category": "故障类型，如 Mixin 冲突 / 缺少前置 / 内存不足",',
    '  "location": "最关键的定位，格式 文件:行 或 类.方法",',
    '  "confidence": 0.0 到 1.0 之间的数字,',
    '  "rootCause": ["分点陈述的根因，2-3 段"],',
    '  "evidence": [{ "file": "材料中的文件路径", "line": 行号数字, "why": "这行为什么关键" }],',
    '  "components": [{ "name": "模组名", "version": "版本", "role": "模组|前置|加载器", "primary": true }],',
    '  "fixes": [{ "title": "操作标题", "detail": "具体怎么做", "level": "immediate|try|diagnose" }],',
    '  "secondary": [{ "title": "次要问题", "detail": "影响说明", "count": 出现次数 }]',
    '}',
    'evidence 中的 file 与 line 必须来自材料里真实出现过的位置，最多 4 条。'
  ].join('\n')
}

function hydrateEvidence(
  sources: LogSource[],
  raw: Array<{ file?: string; line?: number; why?: string }>
): EvidenceItem[] {
  const items: EvidenceItem[] = []
  for (const entry of raw.slice(0, 4)) {
    const file = entry.file ?? ''
    const line = Number(entry.line ?? 0)
    const source = sources.find((item) => item.file.path === file || item.file.path.endsWith(file) || file.endsWith(item.file.name))
    if (!source || !Number.isFinite(line) || line <= 0) continue

    const index = line - 1 - source.log.lineOffset
    if (index < 0 || index >= source.log.lines.length) continue

    const body = blockText(source, index, 6)
    items.push({
      id: `ai-${source.file.id}-${line}`,
      file: source.file.path,
      line,
      level: 'ERROR',
      body: entry.why ? `${body}\n\n# ${entry.why}` : body
    })
  }
  return items
}

function normalizeFixes(raw: unknown): AiFix[] {
  if (!Array.isArray(raw)) return []
  return raw
    .slice(0, 6)
    .map((item) => {
      const value = item as Record<string, unknown>
      const rawLevel = value.level
      const level: AiFix['level'] =
        rawLevel === 'immediate' || rawLevel === 'try' || rawLevel === 'diagnose' ? rawLevel : 'try'
      return {
        title: String(value.title ?? '').slice(0, 120),
        detail: String(value.detail ?? ''),
        level
      }
    })
    .filter((item) => item.title)
}

export function parseAiJson(text: string): Record<string, unknown> {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>
    }
    throw new Error('模型返回的内容不是合法 JSON')
  }
}

export function toAiAnalysis(
  raw: Record<string, unknown>,
  context: AiContext,
  settings: Settings,
  usage: { input: number; output: number } | undefined,
  durationMs: number
): AiAnalysis {
  const severityRaw = String(raw.severity ?? 'high')
  const severity =
    severityRaw === 'critical' || severityRaw === 'medium' || severityRaw === 'low' ? severityRaw : 'high'

  const rootCause = Array.isArray(raw.rootCause)
    ? raw.rootCause.map((item) => String(item)).filter(Boolean)
    : [String(raw.summary ?? '')].filter(Boolean)

  const components = Array.isArray(raw.components)
    ? raw.components.slice(0, 10).map((item) => {
        const value = item as Record<string, unknown>
        return {
          name: String(value.name ?? ''),
          version: value.version ? String(value.version) : undefined,
          role: String(value.role ?? '模组'),
          primary: Boolean(value.primary)
        }
      })
    : []

  const secondary = Array.isArray(raw.secondary)
    ? raw.secondary.slice(0, 6).map((item) => {
        const value = item as Record<string, unknown>
        return {
          title: String(value.title ?? ''),
          detail: String(value.detail ?? ''),
          count: Number(value.count ?? 0) || 0
        }
      })
    : []

  return {
    severity,
    title: String(raw.title ?? '分析结果').slice(0, 80),
    summary: String(raw.summary ?? ''),
    category: String(raw.category ?? '未分类'),
    location: String(raw.location ?? ''),
    confidence: Math.max(0, Math.min(1, Number(raw.confidence ?? 0.6))),
    rootCause,
    evidence: hydrateEvidence(
      context.sources,
      Array.isArray(raw.evidence) ? (raw.evidence as Array<{ file?: string; line?: number; why?: string }>) : []
    ),
    components,
    fixes: normalizeFixes(raw.fixes),
    secondary,
    model: settings.model,
    usage,
    durationMs
  }
}

interface StreamResult {
  text: string
  usage?: { input: number; output: number }
}

export async function callModel(
  settings: Settings,
  pack: string,
  onDelta: (text: string) => void,
  signal: AbortSignal
): Promise<StreamResult> {
  const baseUrl = settings.baseUrl.replace(/\/+$/, '')
  if (!baseUrl) throw new Error('尚未配置接口地址，请先在设置中填写 Base URL。')

  const body: Record<string, unknown> = {
    model: settings.model,
    temperature: settings.temperature,
    max_tokens: settings.maxTokens,
    stream: true,
    messages: [
      { role: 'system', content: buildSystemPrompt(settings) },
      { role: 'user', content: `以下是待分析的日志材料：\n\n${pack}\n\n请按要求输出 JSON。` }
    ]
  }

  if (settings.provider === 'deepseek' || settings.provider === 'openai' || settings.provider === 'moonshot') {
    body.response_format = { type: 'json_object' }
    body.stream_options = { include_usage: true }
  }

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${settings.apiKey}`
    },
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    const hint =
      response.status === 401
        ? 'API Key 无效或已过期'
        : response.status === 404
          ? '接口地址或模型名不正确'
          : response.status === 429
            ? '请求过于频繁或额度不足'
            : `模型服务返回 ${response.status}`
    throw new Error(`${hint}${detail ? `：${detail.slice(0, 200)}` : ''}`)
  }

  const contentType = response.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const text = json.choices?.[0]?.message?.content ?? ''
    onDelta(text)
    return {
      text,
      usage: {
        input: json.usage?.prompt_tokens ?? 0,
        output: json.usage?.completion_tokens ?? 0
      }
    }
  }

  if (!response.body) throw new Error('模型服务未返回内容')

  const reader = (response.body as ReadableStream<Uint8Array>).getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let text = ''
  let usage: StreamResult['usage']

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data:')) continue
      const payload = trimmed.slice(5).trim()
      if (!payload || payload === '[DONE]') continue

      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>
          usage?: { prompt_tokens?: number; completion_tokens?: number }
        }
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          text += delta
          onDelta(delta)
        }
        if (parsed.usage) {
          usage = {
            input: parsed.usage.prompt_tokens ?? 0,
            output: parsed.usage.completion_tokens ?? 0
          }
        }
      } catch {
        // 忽略心跳或非 JSON 行
      }
    }
  }

  return { text, usage }
}
