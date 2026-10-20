import { execFile } from 'node:child_process'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { JavaArch, JavaRuntimeInfo, JavaRuntimeSource } from '../../shared/types'

const DEFAULT_PROBE_TIMEOUT = 3000

interface ProbeFields {
  version?: string
  vendor?: string
  osArch?: string
  bits?: string
}

export function parseJavaVersion(raw?: string): { version: string; major: number } | null {
  if (!raw) return null
  const value = raw.trim().replace(/^"|"$/g, '')
  if (!value) return null

  const legacy = /^1\.(\d+)(?:[._]|$)/.exec(value)
  if (legacy) return { version: value, major: Number(legacy[1]) }

  const modern = /^(\d+)(?:[.+-]|$)/.exec(value)
  if (!modern) return null
  return { version: value, major: Number(modern[1]) }
}

export function normalizeJavaArch(raw?: string, bits?: string): JavaArch {
  const value = (raw ?? '').toLowerCase()
  if (value.includes('aarch64') || value.includes('arm64')) return 'aarch64'
  if (value.includes('x86_64') || value.includes('amd64') || value.includes('x64')) return 'x64'
  if (value.includes('x86') || value.includes('i386') || value.includes('i686')) return 'x86'
  if (bits === '64') return process.arch === 'arm64' ? 'aarch64' : 'x64'
  if (bits === '32') return 'x86'
  return 'unknown'
}

function parseRelease(text: string): Record<string, string> {
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim())
    if (!match) continue
    values[match[1]] = match[2].replace(/^"|"$/g, '').trim()
  }
  return values
}

async function readRelease(home: string): Promise<Record<string, string>> {
  try {
    const text = await fs.readFile(join(home, 'release'), 'utf8')
    return parseRelease(text)
  } catch {
    return {}
  }
}

function parseProbe(text: string): ProbeFields {
  const read = (key: string): string | undefined => {
    const match = new RegExp(`^\\s*${key.replace(/\./g, '\\.')}\\s*=\\s*(.+)$`, 'm').exec(text)
    return match?.[1]?.trim()
  }
  return {
    version: read('java.version'),
    vendor: read('java.vendor'),
    osArch: read('os.arch'),
    bits: read('sun.arch.data.model')
  }
}

function probe(exePath: string, timeoutMs: number): Promise<ProbeFields | null> {
  return new Promise((resolve) => {
    execFile(
      exePath,
      ['-XshowSettings:properties', '-version'],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 256 * 1024 },
      (error, stdout, stderr) => {
        const text = `${stdout ?? ''}\n${stderr ?? ''}`
        if (!text.trim()) {
          resolve(null)
          return
        }
        resolve(parseProbe(text))
      }
    )
  })
}

async function findExecutable(home: string): Promise<string | undefined> {
  const names = process.platform === 'win32' ? ['java.exe', 'javaw.exe'] : ['java']
  for (const name of names) {
    const path = join(home, 'bin', name)
    try {
      if ((await fs.stat(path)).isFile()) return path
    } catch {
      // 继续尝试下一个可执行文件名
    }
  }
  return undefined
}

/**
 * 识别单个 Java Home：优先读 release 文件（不执行二进制），
 * 缺少版本信息时才以超时方式执行 `java -XshowSettings:properties -version`。
 */
export async function identifyJavaHome(
  home: string,
  source: JavaRuntimeSource,
  options: { timeoutMs?: number } = {}
): Promise<JavaRuntimeInfo> {
  const info: JavaRuntimeInfo = { home, arch: 'unknown', source, valid: false }

  const executable = await findExecutable(home)
  if (!executable) {
    info.error = '未找到 bin/java 可执行文件'
    return info
  }
  info.executable = executable

  const release = await readRelease(home)
  let version: string | undefined = release.JAVA_VERSION
  let vendor = release.IMPLEMENTOR ?? release.JAVA_VENDOR
  let arch = normalizeJavaArch(release.OS_ARCH)

  let probed: ProbeFields | null = null
  if (!version) {
    probed = await probe(executable, options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT)
    version = probed?.version
    vendor = vendor ?? probed?.vendor
    if (arch === 'unknown') arch = normalizeJavaArch(probed?.osArch, probed?.bits)
  }

  const parsed = parseJavaVersion(version)
  if (!parsed) {
    info.error = '无法识别 Java 版本'
    return info
  }

  info.version = parsed.version
  info.major = parsed.major
  info.vendor = vendor
  info.arch = arch
  info.valid = true
  return info
}
