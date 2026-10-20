import type {
  AiAnalysis,
  AiChunk,
  AnalyzeProgress,
  AppApi,
  BaseAnalysis,
  IpcResult,
  LinesResult,
  Settings
} from '../types'
import { BASE_STAGES, DEFAULT_SETTINGS, MOCK_AI, MOCK_BASE, MOCK_LOGS } from '../data/mock'

const STORAGE_KEY = 'mclog.settings.v2'

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Settings>
      return {
        ...DEFAULT_SETTINGS,
        ...parsed,
        launcher: { ...DEFAULT_SETTINGS.launcher, ...(parsed.launcher ?? {}) }
      }
    }
  } catch {
    // ignore
  }
  return { ...DEFAULT_SETTINGS }
}

const progressListeners = new Set<(event: AnalyzeProgress) => void>()
const chunkListeners = new Set<(chunk: AiChunk) => void>()

let baseResult: BaseAnalysis | null = null
let cancelled = false

function emitProgress(event: AnalyzeProgress): void {
  progressListeners.forEach((listener) => listener(event))
}

function emitChunk(chunk: AiChunk): void {
  chunkListeners.forEach((listener) => listener(chunk))
}

const STAGE_DETAIL: Record<string, string> = {
  extract: '12.4 MB · 87 个条目',
  scan: '命中 4 个日志文件，跳过 41 个无关条目',
  decode: 'logs/latest.log（GB18030 → UTF-8）',
  parse: '26,280 行 · 合并 12 个堆栈块',
  rules: '命中 2 条特征'
}

const mockApi: AppApi = {
  pickArchive: async () => null,
  getPathForFile: () => '',

  settings: {
    get: async () => loadSettings(),
    save: async (settings: Settings) => {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
      return settings
    },
    test: async () => {
      await sleep(600)
      return { ok: true, latency: 214 }
    }
  },

  analysis: {
    run: async (request): Promise<IpcResult<BaseAnalysis>> => {
      cancelled = false
      const total = BASE_STAGES.length
      for (let i = 0; i < total; i += 1) {
        if (cancelled) break
        const stage = BASE_STAGES[i]
        emitProgress({
          stage: stage.id,
          label: stage.label,
          detail: STAGE_DETAIL[stage.id],
          progress: Math.round(((i + 0.6) / total) * 100)
        })
        await sleep(420)
      }

      baseResult = {
        ...MOCK_BASE,
        archiveName: request.name,
        archiveSize: request.size
      }
      emitProgress({ stage: 'rules', label: '基础分析完成', detail: '未调用模型', progress: 100 })
      return { ok: true, data: baseResult }
    },

    runDir: async (request): Promise<IpcResult<BaseAnalysis>> => {
      cancelled = false
      const total = BASE_STAGES.length
      for (let i = 0; i < total; i += 1) {
        if (cancelled) break
        const stage = BASE_STAGES[i]
        emitProgress({
          stage: stage.id,
          label: stage.label,
          detail: STAGE_DETAIL[stage.id],
          progress: Math.round(((i + 0.6) / total) * 100)
        })
        await sleep(420)
      }

      const name = request.path.split(/[\\/]/).pop() || '本地实例'
      baseResult = {
        ...MOCK_BASE,
        archiveName: `${name}（本地目录）`,
        archiveSize: MOCK_BASE.files.reduce((sum, file) => sum + file.size, 0)
      }
      emitProgress({ stage: 'rules', label: '基础分析完成', detail: '未调用模型', progress: 100 })
      return { ok: true, data: baseResult }
    },

    pickDir: async () => null,

    ai: async (request): Promise<IpcResult<AiAnalysis>> => {
      if (!baseResult) return { ok: false, error: '尚未完成基础分析。' }
      if (request.trigger === 'auto' && !loadSettings().autoAi) {
        return { ok: false, error: '未启用「自动 AI 分析」，已阻止本次自动调用。' }
      }

      cancelled = false
      const text = JSON.stringify(
        {
          severity: MOCK_AI.severity,
          title: MOCK_AI.title,
          category: MOCK_AI.category,
          confidence: MOCK_AI.confidence,
          rootCause: MOCK_AI.rootCause,
          fixes: MOCK_AI.fixes.map((fix) => fix.title)
        },
        null,
        2
      )

      for (let i = 0; i < text.length; i += 8) {
        if (cancelled) return { ok: false, error: '已取消 AI 分析。' }
        emitChunk({ type: 'delta', text: text.slice(i, i + 8) })
        await sleep(30)
      }

      return { ok: true, data: MOCK_AI }
    },

    cancel: async () => {
      cancelled = true
    },

    lines: async (request): Promise<IpcResult<LinesResult>> => {
      const preview = MOCK_LOGS[request.file]
      if (preview) return { ok: true, data: preview }
      return {
        ok: true,
        data: {
          file: request.file,
          start: 1,
          total: 0,
          lines: ['（浏览器预览环境未载入真实日志内容）', '', '在桌面版中，此处会显示压缩包内的实际日志行。']
        }
      }
    },

    onProgress: (cb) => {
      progressListeners.add(cb)
      return () => {
        progressListeners.delete(cb)
      }
    },

    onAiChunk: (cb) => {
      chunkListeners.add(cb)
      return () => {
        chunkListeners.delete(cb)
      }
    }
  },

  launcher: {
    pick: async () => null,
    get: async () => ({ state: 'disabled', warnings: ['浏览器预览环境不读取本机启动器配置'] }),
    refresh: async () => ({ state: 'disabled', warnings: ['浏览器预览环境不读取本机启动器配置'] })
  },

  java: {
    list: async () => ({
      runtimes: [],
      scannedAt: '',
      durationMs: 0,
      warnings: ['浏览器预览环境不扫描本机 Java']
    }),
    scan: async () => ({
      runtimes: [],
      scannedAt: new Date().toISOString(),
      durationMs: 0,
      warnings: ['浏览器预览环境不扫描本机 Java']
    })
  },

  platform: 'web'
}

export const isDesktop = Boolean(window.api)
export const bridge: AppApi = window.api ?? mockApi
