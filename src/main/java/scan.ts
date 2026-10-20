import { promises as fs } from 'node:fs'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import type {
  JavaRuntimeInfo,
  JavaRuntimeSource,
  JavaScanResult
} from '../../shared/types'
import { identifyJavaHome } from './identify'
import { queryWindowsJavaHomes } from './registry'

interface Candidate {
  home: string
  source: JavaRuntimeSource
}

export interface JavaScanOptions {
  env?: NodeJS.ProcessEnv
  /** 额外扫描的容器目录（如游戏目录下的 runtime），会向下探测两层。 */
  extraRoots?: string[]
  launcherJavaPath?: string
  includeEnv?: boolean
  includePath?: boolean
  includeStandard?: boolean
  includeRegistry?: boolean
  timeoutMs?: number
  maxCandidates?: number
}

const EXE_NAMES = process.platform === 'win32' ? ['java.exe', 'javaw.exe'] : ['java']
const CONCURRENCY = 4

async function isJavaHome(dir: string): Promise<boolean> {
  for (const name of EXE_NAMES) {
    try {
      if ((await fs.stat(join(dir, 'bin', name))).isFile()) return true
    } catch {
      // 继续检查 release
    }
  }
  try {
    return (await fs.stat(join(dir, 'release'))).isFile()
  } catch {
    return false
  }
}

function homeFromExecutable(path: string): string {
  const lower = path.toLowerCase()
  if (!/[\\/](?:java|javaw)(?:\.exe)?$/.test(lower)) return path
  const dir = dirname(path)
  return basename(dir).toLowerCase() === 'bin' ? dirname(dir) : dir
}

function standardRoots(env: NodeJS.ProcessEnv): { root: string; depth: number }[] {
  const roots: { root: string; depth: number }[] = []

  if (process.platform === 'win32') {
    const names = [
      'Java',
      'Eclipse Adoptium',
      'Microsoft',
      'Zulu',
      'BellSoft',
      'Amazon Corretto',
      'SapMachine',
      'Semeru',
      'Temurin'
    ]
    const bases = [env['ProgramFiles'], env['ProgramFiles(x86)']]
    if (env['LOCALAPPDATA']) bases.push(join(env['LOCALAPPDATA'], 'Programs'))
    for (const base of bases) {
      if (!base) continue
      for (const name of names) roots.push({ root: join(base, name), depth: 1 })
    }
  } else if (process.platform === 'darwin') {
    roots.push({ root: '/Library/Java/JavaVirtualMachines', depth: 2 })
    roots.push({ root: join(homedir(), 'Library/Java/JavaVirtualMachines'), depth: 2 })
    roots.push({ root: join(homedir(), '.sdkman/candidates/java'), depth: 1 })
  } else {
    roots.push({ root: '/usr/lib/jvm', depth: 1 })
    roots.push({ root: '/usr/java', depth: 1 })
    roots.push({ root: '/usr/lib32/jvm', depth: 1 })
    roots.push({ root: join(homedir(), '.sdkman/candidates/java'), depth: 1 })
    roots.push({ root: join(homedir(), '.asdf/installs/java'), depth: 1 })
  }

  return roots
}

async function walkJavaRoots(
  root: string,
  depth: number,
  add: (home: string, source: JavaRuntimeSource) => void,
  full: () => boolean,
  source: JavaRuntimeSource = 'standard'
): Promise<void> {
  if (full()) return

  let entries
  try {
    entries = await fs.readdir(root, { withFileTypes: true })
  } catch {
    return
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const home = join(root, entry.name)
    if (await isJavaHome(home)) {
      add(home, source)
      if (full()) return
      continue
    }
    if (depth > 0) await walkJavaRoots(home, depth - 1, add, full, source)
  }
}

async function collectPathHomes(
  env: NodeJS.ProcessEnv,
  add: (home: string, source: JavaRuntimeSource) => void
): Promise<void> {
  const raw = env.PATH ?? env.Path ?? ''
  for (const entry of raw.split(delimiter)) {
    if (!entry) continue
    for (const name of EXE_NAMES) {
      const candidate = join(entry, name)
      try {
        if (!(await fs.stat(candidate)).isFile()) continue
        let real = candidate
        try {
          real = await fs.realpath(candidate)
        } catch {
          // 保留原路径
        }
        add(homeFromExecutable(real), 'path')
        break
      } catch {
        // 该 PATH 项没有 java，继续
      }
    }
  }
}

/**
 * 只读扫描本机 Java：环境变量、PATH、启动器选中路径、Windows 注册表、常见安装目录。
 * 不做全盘搜索；所有错误都转为 warning/无效项，不抛出。
 */
export async function scanJavaRuntimes(options: JavaScanOptions = {}): Promise<JavaScanResult> {
  const started = Date.now()
  const warnings: string[] = []
  const env = options.env ?? process.env
  const timeoutMs = options.timeoutMs ?? 8000
  const maxCandidates = options.maxCandidates ?? 120
  const candidates = new Map<string, Candidate>()

  const add = (home: string, source: JavaRuntimeSource): void => {
    if (!home || candidates.size >= maxCandidates) return
    let normalized: string
    try {
      normalized = resolve(home)
    } catch {
      return
    }
    const key = process.platform === 'win32' ? normalized.toLowerCase() : normalized
    if (!candidates.has(key)) candidates.set(key, { home: normalized, source })
  }

  if (options.includeEnv !== false) {
    for (const key of ['JAVA_HOME', 'JDK_HOME', 'JRE_HOME']) {
      const value = env[key]
      if (value) add(value, 'env')
    }
  }

  if (options.launcherJavaPath) add(homeFromExecutable(options.launcherJavaPath), 'launcher')

  if (options.includePath !== false) await collectPathHomes(env, add)

  if (options.includeRegistry !== false && process.platform === 'win32') {
    try {
      const homes = await queryWindowsJavaHomes()
      for (const home of homes) add(home, 'registry')
    } catch {
      warnings.push('注册表读取失败，已跳过该来源。')
    }
  }

  if (options.includeStandard !== false) {
    const full = (): boolean => candidates.size >= maxCandidates || Date.now() - started > timeoutMs
    for (const item of standardRoots(env)) {
      if (full()) {
        warnings.push('扫描达到时间或数量上限，部分标准目录未检查。')
        break
      }
      await walkJavaRoots(item.root, item.depth, add, full)
    }
  }

  for (const root of options.extraRoots ?? []) {
    if (candidates.size >= maxCandidates) break
    await walkJavaRoots(root, 2, add, () => candidates.size >= maxCandidates, 'launcher')
  }

  const list = [...candidates.values()]
  const identified: JavaRuntimeInfo[] = []

  for (let i = 0; i < list.length; i += CONCURRENCY) {
    if (Date.now() - started > timeoutMs) {
      warnings.push('识别阶段超过时间预算，部分候选未完成。')
      break
    }
    const chunk = list.slice(i, i + CONCURRENCY)
    const results = await Promise.all(
      chunk.map((item) => identifyJavaHome(item.home, item.source, { timeoutMs: 2500 }))
    )
    identified.push(...results)
  }

  const deduped = new Map<string, JavaRuntimeInfo>()
  for (const item of identified) {
    let real = item.home
    try {
      real = await fs.realpath(item.home)
    } catch {
      // 保留原路径
    }
    const key = process.platform === 'win32' ? real.toLowerCase() : real
    const existing = deduped.get(key)
    if (!existing || (!existing.valid && item.valid)) {
      deduped.set(key, { ...item, home: real })
    }
  }

  const runtimes = [...deduped.values()].sort((a, b) => {
    if (a.valid !== b.valid) return a.valid ? -1 : 1
    if ((b.major ?? 0) !== (a.major ?? 0)) return (b.major ?? 0) - (a.major ?? 0)
    return a.home.localeCompare(b.home)
  })

  if (runtimes.length === 0) {
    warnings.push('未在环境变量、注册表或常见安装目录中找到 Java。便携版需手动确认路径。')
  }

  return {
    runtimes,
    scannedAt: new Date().toISOString(),
    durationMs: Date.now() - started,
    warnings
  }
}
