import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import type {
  AnalyzeProgress,
  BaseAnalysis,
  CrashSummary,
  LogFileKind,
  ScannedFile
} from '../../shared/types'
import { decodeBuffer } from './decode'
import { discover } from './discover'
import { listZip, readEntry } from './extract'
import { listGameDir, readFileCapped } from './scan'
import { parseLog, type ParsedLog } from './parse'
import { parseCrashReport } from './crash'
import { detectLoader, detectionSample, type LoaderProfile } from './loader'
import { extractEnvironment, guessStage, runRules, type LogSource } from './rules'

const MAX_FILE_BYTES = 48 * 1024 * 1024
const MAX_TOTAL_BYTES = 160 * 1024 * 1024

const NOTE: Record<LogFileKind, string> = {
  crash: '崩溃报告',
  hs_err: 'JVM 崩溃日志',
  latest: '主日志',
  fml: '加载器日志',
  debug: '调试日志（信噪比低）',
  history: '历史日志',
  launcher: '启动器日志',
  version_json: '版本配置',
  other: '其他文件'
}

type ProgressFn = (event: AnalyzeProgress) => void

interface LoadedFile {
  file: ScannedFile
  text: string
  log: ParsedLog
}

function fileKindRank(kind: LogFileKind): number {
  const order: LogFileKind[] = [
    'crash',
    'hs_err',
    'latest',
    'fml',
    'debug',
    'history',
    'launcher',
    'version_json',
    'other'
  ]
  return order.indexOf(kind)
}

async function loadSingleFile(path: string, name: string): Promise<LoadedFile> {
  const buffer = await fs.readFile(path)
  const slice = buffer.length > MAX_FILE_BYTES ? buffer.subarray(0, MAX_FILE_BYTES) : buffer
  const decoded = decodeBuffer(slice)
  const trimmed = buffer.length > MAX_FILE_BYTES
  const log = parseLog(name, decoded.text, trimmed)
  const lower = name.toLowerCase()
  const kind: LogFileKind = lower.includes('crash')
    ? 'crash'
    : lower.includes('hs_err')
      ? 'hs_err'
      : lower === 'latest.log'
        ? 'latest'
        : 'other'

  return {
    text: decoded.text,
    log,
    file: {
      id: 'single',
      name,
      path: name,
      size: buffer.length,
      bytesRead: slice.length,
      lines: log.lines.length,
      kind,
      encoding: decoded.encoding,
      included: true,
      note: NOTE[kind],
      truncated: trimmed
    }
  }
}

export interface AnalyzeOutput {
  base: BaseAnalysis
  sources: LogSource[]
  modJars: string[]
}

function finalizeAnalysis(input: {
  archiveName: string
  archiveSize: number
  entryCount: number
  loaded: LoadedFile[]
  modJars: string[]
  historyCandidates: boolean
  notes: string[]
  startedAt: number
  onProgress: ProgressFn
  useRuleEngine: boolean
}): AnalyzeOutput {
  const { loaded, notes, onProgress, useRuleEngine } = input

  const sources: LogSource[] = loaded
    .map((item) => ({ file: item.file, log: item.log }))
    .sort((a, b) => fileKindRank(a.file.kind) - fileKindRank(b.file.kind))

  const crashReports: CrashSummary[] = loaded
    .filter((item) => item.file.kind === 'crash')
    .map((item) => parseCrashReport(item.file.path, item.text))

  const hasHsErr = loaded.some((item) => item.file.kind === 'hs_err')
  const loader = detectLoader(
    detectionSample(loaded.map((item) => ({ kind: item.file.kind, text: item.text })))
  )
  const environment = extractEnvironment({ crashReports, sources, loader })

  if (input.modJars.length > 0 && !environment.modCount) {
    environment.modCount = input.modJars.length
  }

  const stageGuess = guessStage({ sources, crashReports, hasHsErr, env: environment })
  const rules = runRules({
    sources,
    crashReports,
    hasHsErr,
    modJars: input.modJars,
    useRuleEngine,
    loader
  })

  onProgress({
    stage: 'rules',
    label: useRuleEngine ? '规则匹配' : '规则引擎已关闭',
    detail: useRuleEngine ? `命中 ${rules.findings.length} 条特征` : '未做故障签名匹配',
    progress: 94
  })

  if (!useRuleEngine) {
    notes.push('设置中已关闭本地规则引擎，本次未做故障签名匹配、嫌疑排序与关键词统计。')
  }

  if (crashReports.length === 0) {
    notes.push(
      '输入内容中没有崩溃报告。HMCL 与 PCL2 只在部分崩溃场景下生成 crash-report，缺少它属于正常现象，本次以游戏日志为主要依据。'
    )
  }
  if (hasHsErr) {
    notes.push('检测到 hs_err_pid 日志，说明 JVM 本身崩溃，排查方向应是驱动与 Java 环境，而非模组逻辑。')
  }
  if (!loaded.some((item) => item.file.kind === 'latest')) {
    notes.push('未找到 latest.log，可能是仅提供了启动器日志，或输入未包含游戏 logs 目录。')
  }
  if (loader.family === 'unknown') {
    notes.push(
      '未从输入中识别出模组加载器（Fabric / Quilt / Forge / NeoForge），加载器专属规则已全部放开匹配，可能出现跨加载器的误报。'
    )
  }
  if (input.historyCandidates && !loaded.some((item) => item.file.kind === 'history')) {
    notes.push('存在历史日志，默认未参与分析；定位偶发崩溃时可手动选择包含历史日志的输入。')
  }

  onProgress({ stage: 'rules', label: '基础分析完成', detail: '未调用模型', progress: 100 })

  const totalLines = loaded.reduce((sum, item) => sum + item.log.lines.length, 0)

  return {
    sources,
    modJars: input.modJars,
    base: {
      archiveName: input.archiveName,
      archiveSize: input.archiveSize,
      entryCount: input.entryCount,
      files: loaded.map((item) => item.file),
      environment,
      stageGuess,
      stats: {
        totalLines,
        errors: loaded.reduce((sum, item) => sum + item.log.errors, 0),
        warnings: loaded.reduce((sum, item) => sum + item.log.warnings, 0),
        exceptionBlocks: loaded.reduce((sum, item) => sum + item.log.blocks.length, 0)
      },
      crashReports,
      findings: rules.findings,
      suspects: rules.suspects,
      signatures: rules.signatures,
      notes,
      durationMs: Date.now() - input.startedAt,
      analyzedAt: new Date().toISOString()
    }
  }
}

export interface AnalyzeOptions {
  /** 来自设置项的 `useRuleEngine`，默认 true。关闭时规则引擎整体短路。 */
  useRuleEngine?: boolean
}

export async function analyzeArchive(
  archivePath: string,
  archiveName: string,
  archiveSize: number,
  onProgress: ProgressFn,
  options: AnalyzeOptions = {}
): Promise<AnalyzeOutput> {
  const useRuleEngine = options.useRuleEngine !== false
  const startedAt = Date.now()
  const notes: string[] = []

  const isSingleFile = /\.(log|txt)$/i.test(archiveName)

  if (isSingleFile) {
    onProgress({ stage: 'extract', label: '读取日志文件', detail: archiveName, progress: 20 })
    const loaded = await loadSingleFile(archivePath, archiveName)

    onProgress({ stage: 'scan', label: '识别文件类型', detail: loaded.file.note, progress: 45 })
    onProgress({ stage: 'decode', label: '编码归一', detail: loaded.file.encoding, progress: 62 })
    onProgress({ stage: 'parse', label: '堆栈解析', detail: `${loaded.log.lines.length} 行`, progress: 78 })

    const sources: LogSource[] = [{ file: loaded.file, log: loaded.log }]
    const crashReports =
      loaded.file.kind === 'crash' ? [parseCrashReport(loaded.file.path, loaded.text)] : []
    const loader = detectLoader(detectionSample([{ kind: loaded.file.kind, text: loaded.text }]))
    const env = extractEnvironment({ crashReports, sources, loader })
    const stageGuess = guessStage({ sources, crashReports, hasHsErr: loaded.file.kind === 'hs_err', env })
    const rules = runRules({
      sources,
      crashReports,
      hasHsErr: loaded.file.kind === 'hs_err',
      modJars: [],
      useRuleEngine,
      loader
    })

    onProgress({
      stage: 'rules',
      label: useRuleEngine ? '规则匹配' : '规则引擎已关闭',
      detail: useRuleEngine ? `${rules.findings.length} 条命中` : '未做故障签名匹配',
      progress: 96
    })

    if (!useRuleEngine) {
      notes.push('设置中已关闭本地规则引擎，本次未做故障签名匹配、嫌疑排序与关键词统计。')
    }

    return {
      sources,
      modJars: [],
      base: {
        archiveName,
        archiveSize,
        entryCount: 1,
        files: [loaded.file],
        environment: env,
        stageGuess,
        stats: {
          totalLines: loaded.log.lines.length,
          errors: loaded.log.errors,
          warnings: loaded.log.warnings,
          exceptionBlocks: loaded.log.blocks.length
        },
        crashReports,
        findings: rules.findings,
        suspects: rules.suspects,
        signatures: rules.signatures,
        notes,
        durationMs: Date.now() - startedAt,
        analyzedAt: new Date().toISOString()
      }
    }
  }

  onProgress({ stage: 'extract', label: '解压压缩包', detail: '读取中央目录…', progress: 8 })

  let entries
  try {
    entries = await listZip(archivePath)
  } catch (error) {
    throw new Error(
      `无法读取压缩包：${error instanceof Error ? error.message : String(error)}。当前版本支持 .zip 与单个 .log / .txt 文件。`
    )
  }

  if (entries.length === 0) throw new Error('压缩包内没有可读取的文件。')

  onProgress({
    stage: 'extract',
    label: '解压压缩包',
    detail: `${entries.length} 个条目`,
    progress: 20
  })

  const discovery = discover(entries)
  if (discovery.candidates.length === 0) {
    throw new Error('未在压缩包中找到可分析的日志或崩溃报告，请确认导出包内容。')
  }

  onProgress({
    stage: 'scan',
    label: '识别日志类型',
    detail: `命中 ${discovery.candidates.length} 个文件，跳过 ${discovery.skipped} 个无关条目`,
    progress: 36
  })

  const loaded: LoadedFile[] = []
  let totalBytes = 0

  for (let i = 0; i < discovery.candidates.length; i += 1) {
    const candidate = discovery.candidates[i]
    const percent = 36 + Math.round(((i + 1) / discovery.candidates.length) * 24)

    onProgress({
      stage: 'decode',
      label: '编码归一',
      detail: `${candidate.entry.path}${candidate.gzip ? '（gzip）' : ''}`,
      progress: percent
    })

    try {
      const { buffer } = await readEntry(archivePath, candidate.entry.path, MAX_FILE_BYTES)
      if (buffer.length === 0) continue

      let raw = buffer
      if (candidate.gzip) {
        try {
          raw = gunzipSync(buffer)
        } catch {
          notes.push(`${candidate.entry.path} 解压失败，已跳过。`)
          continue
        }
      }

      if (totalBytes + raw.length > MAX_TOTAL_BYTES) {
        notes.push('日志总量超过 160 MB，后续文件未参与本次分析。')
        break
      }
      totalBytes += raw.length

      const decoded = decodeBuffer(raw)
      const log = parseLog(candidate.entry.path, decoded.text, false)
      const truncated = candidate.entry.size > MAX_FILE_BYTES

      if (truncated) notes.push(`${candidate.entry.path} 超过 48 MB，仅分析了前段内容。`)

      loaded.push({
        text: decoded.text,
        log,
        file: {
          id: `${candidate.kind}-${i}`,
          name: candidate.entry.path.split('/').pop() ?? candidate.entry.path,
          path: candidate.entry.path,
          size: candidate.entry.size,
          bytesRead: raw.length,
          lines: log.lines.length,
          kind: candidate.kind,
          encoding: decoded.encoding,
          included: true,
          note: NOTE[candidate.kind],
          truncated
        }
      })
    } catch (error) {
      notes.push(`${candidate.entry.path} 读取失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  if (loaded.length === 0) throw new Error('日志文件均无法读取，请检查压缩包是否完整。')

  onProgress({ stage: 'parse', label: '堆栈解析', detail: `${loaded.length} 个文件已解析`, progress: 72 })

  return finalizeAnalysis({
    archiveName,
    archiveSize,
    entryCount: entries.length,
    loaded,
    modJars: discovery.modJars,
    historyCandidates: discovery.candidates.some((item) => item.kind === 'history'),
    notes,
    startedAt,
    onProgress,
    useRuleEngine
  })
}

/**
 * 直接分析本机游戏目录（.minecraft 或版本隔离目录），无需先导出 zip。
 * 只读取 logs / crash-reports / mods / versions 等与诊断相关的文件。
 */
export async function analyzeGameDir(
  dirPath: string,
  dirName: string,
  onProgress: ProgressFn,
  options: AnalyzeOptions = {}
): Promise<AnalyzeOutput> {
  const useRuleEngine = options.useRuleEngine !== false
  const startedAt = Date.now()
  const notes: string[] = ['本次分析直接读取游戏目录，文件路径均为相对路径。']

  onProgress({ stage: 'extract', label: '扫描游戏目录', detail: dirName, progress: 10 })

  const { entries, truncated } = await listGameDir(dirPath)
  if (truncated) notes.push('目录条目超过 20000 个，后续文件未参与本次分析。')

  onProgress({
    stage: 'scan',
    label: '识别日志类型',
    detail: `${entries.length} 个候选文件`,
    progress: 30
  })

  const discovery = discover(entries)
  if (discovery.candidates.length === 0) {
    throw new Error('所选目录中未找到可分析的日志或崩溃报告（logs / crash-reports）。')
  }

  onProgress({
    stage: 'scan',
    label: '识别日志类型',
    detail: `命中 ${discovery.candidates.length} 个文件，跳过 ${discovery.skipped} 个无关文件`,
    progress: 36
  })

  const loaded: LoadedFile[] = []
  let totalBytes = 0

  for (let i = 0; i < discovery.candidates.length; i += 1) {
    const candidate = discovery.candidates[i]
    const percent = 36 + Math.round(((i + 1) / discovery.candidates.length) * 24)

    onProgress({
      stage: 'decode',
      label: '编码归一',
      detail: `${candidate.entry.path}${candidate.gzip ? '（gzip）' : ''}`,
      progress: percent
    })

    try {
      const buffer = await readFileCapped(join(dirPath, candidate.entry.path), MAX_FILE_BYTES)
      if (buffer.length === 0) continue

      let raw = buffer
      if (candidate.gzip) {
        try {
          raw = gunzipSync(buffer)
        } catch {
          notes.push(`${candidate.entry.path} 解压失败，已跳过。`)
          continue
        }
      }

      if (totalBytes + raw.length > MAX_TOTAL_BYTES) {
        notes.push('日志总量超过 160 MB，后续文件未参与本次分析。')
        break
      }
      totalBytes += raw.length

      const decoded = decodeBuffer(raw)
      const log = parseLog(candidate.entry.path, decoded.text, false)
      const truncated = candidate.entry.size > MAX_FILE_BYTES
      if (truncated) notes.push(`${candidate.entry.path} 超过 48 MB，仅分析了前段内容。`)

      loaded.push({
        text: decoded.text,
        log,
        file: {
          id: `${candidate.kind}-${i}`,
          name: candidate.entry.path.split('/').pop() ?? candidate.entry.path,
          path: candidate.entry.path,
          size: candidate.entry.size,
          bytesRead: raw.length,
          lines: log.lines.length,
          kind: candidate.kind,
          encoding: decoded.encoding,
          included: true,
          note: NOTE[candidate.kind],
          truncated
        }
      })
    } catch (error) {
      notes.push(`${candidate.entry.path} 读取失败：${error instanceof Error ? error.message : '未知错误'}`)
    }
  }

  if (loaded.length === 0) throw new Error('目录中的日志均无法读取，请检查文件权限。')

  onProgress({ stage: 'parse', label: '堆栈解析', detail: `${loaded.length} 个文件已解析`, progress: 72 })

  return finalizeAnalysis({
    archiveName: `${dirName}（本地目录）`,
    archiveSize: totalBytes,
    entryCount: entries.length,
    loaded,
    modJars: discovery.modJars,
    historyCandidates: discovery.candidates.some((item) => item.kind === 'history'),
    notes,
    startedAt,
    onProgress,
    useRuleEngine
  })
}
