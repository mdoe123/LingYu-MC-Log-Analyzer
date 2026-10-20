import type { LogFileKind } from '../../shared/types'
import type { ZipEntry } from './extract'

export interface Candidate {
  entry: ZipEntry
  kind: LogFileKind
  note: string
  priority: number
  gzip: boolean
}

export interface Discovery {
  candidates: Candidate[]
  modJars: string[]
  versionJsons: string[]
  skipped: number
}

const LIMITS: Record<LogFileKind, number> = {
  crash: 6,
  hs_err: 3,
  latest: 1,
  fml: 2,
  debug: 1,
  history: 4,
  launcher: 3,
  version_json: 2,
  other: 0
}

const PRIORITY: Record<LogFileKind, number> = {
  crash: 100,
  hs_err: 95,
  latest: 90,
  fml: 80,
  debug: 70,
  history: 60,
  launcher: 40,
  version_json: 30,
  other: 0
}

const NOTE: Record<LogFileKind, string> = {
  crash: '崩溃报告',
  hs_err: 'JVM 崩溃日志',
  latest: '主日志',
  fml: '加载器日志',
  debug: '调试日志',
  history: '历史日志',
  launcher: '启动器日志',
  version_json: '版本配置',
  other: '其他文件'
}

function classify(path: string): { kind: LogFileKind; gzip: boolean } | null {
  const lower = path.toLowerCase()
  const base = lower.split('/').pop() ?? lower

  if (base.endsWith('.jar')) return null

  const gzip = base.endsWith('.gz')
  const stem = gzip ? base.slice(0, -3) : base

  if (/^crash-\d{4}-\d{2}-\d{2}.*\.txt$/.test(stem)) return { kind: 'crash', gzip }
  if (/^hs_err_pid\d+\.log$/.test(stem)) return { kind: 'hs_err', gzip }
  if (stem === 'latest.log') return { kind: 'latest', gzip }
  if (/^fml-(client|server)-latest\.log$/.test(stem)) return { kind: 'fml', gzip }
  if (/^debug(-\d+)?\.log$/.test(stem)) return { kind: 'debug', gzip }
  if (/^\d{4}-\d{2}-\d{2}-\d+\.log$/.test(stem)) return { kind: 'history', gzip }
  if (/^(hmcl|pcl|pcl2|launcher)[\w.-]*\.log$/.test(stem) || lower.includes('/hmcl/logs/')) {
    return { kind: 'launcher', gzip }
  }
  if (stem.endsWith('.log')) return { kind: 'history', gzip }
  if (stem.endsWith('.json') && lower.includes('versions/')) return { kind: 'version_json', gzip: false }
  if (stem.endsWith('.txt') && (stem.includes('crash') || stem.includes('崩溃'))) {
    return { kind: 'crash', gzip }
  }

  return null
}

export function discover(entries: ZipEntry[]): Discovery {
  const buckets = new Map<LogFileKind, Candidate[]>()
  const modJars: string[] = []
  const versionJsons: string[] = []
  let skipped = 0

  for (const entry of entries) {
    const lower = entry.path.toLowerCase()
    if (lower.endsWith('.jar') && (lower.includes('mods/') || lower.startsWith('mods/'))) {
      modJars.push(entry.path.split('/').pop() ?? entry.path)
      continue
    }

    const hit = classify(entry.path)
    if (!hit) {
      skipped += 1
      continue
    }

    if (hit.kind === 'version_json') {
      versionJsons.push(entry.path)
      continue
    }

    const bucket = buckets.get(hit.kind) ?? []
    bucket.push({
      entry,
      kind: hit.kind,
      note: NOTE[hit.kind],
      priority: PRIORITY[hit.kind],
      gzip: hit.gzip
    })
    buckets.set(hit.kind, bucket)
  }

  const candidates: Candidate[] = []
  for (const [kind, list] of buckets) {
    list.sort((a, b) => b.entry.path.localeCompare(a.entry.path))
    candidates.push(...list.slice(0, LIMITS[kind]))
  }

  candidates.sort((a, b) => b.priority - a.priority || a.entry.path.localeCompare(b.entry.path))

  return { candidates, modJars, versionJsons, skipped }
}
