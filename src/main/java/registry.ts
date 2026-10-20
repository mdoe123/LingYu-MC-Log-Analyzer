import { execFile } from 'node:child_process'
import { isAbsolute } from 'node:path'
import { decodeBuffer } from '../analysis/decode'

const REGISTRY_KEYS = [
  'HKLM\\SOFTWARE\\JavaSoft',
  'HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft',
  'HKCU\\SOFTWARE\\JavaSoft',
  'HKLM\\SOFTWARE\\Eclipse Adoptium',
  'HKLM\\SOFTWARE\\Microsoft\\JDK',
  'HKLM\\SOFTWARE\\Azul Systems\\Zulu',
  'HKLM\\SOFTWARE\\BellSoft',
  'HKLM\\SOFTWARE\\Amazon\\Corretto',
  'HKLM\\SOFTWARE\\SapMachine'
]

const VALUE_PATTERN =
  /^\s*(?:JavaHome|JavaHome64|Path|InstallationPath|Home)\s+REG_(?:EXPAND_)?SZ\s+(.+)$/gim

function normalizeHome(raw: string): string | undefined {
  let value = raw.trim().replace(/^"|"$/g, '')
  value = value.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? '')
  if (!value || value.includes('%') || !isAbsolute(value)) return undefined

  value = value.replace(/[\\/]bin[\\/](?:java|javaw)(?:\.exe)?$/i, '')
  value = value.replace(/[\\/]bin$/i, '')
  value = value.replace(/[\\/]+$/, '')
  return value || undefined
}

function regQuery(key: string, timeoutMs: number): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(
        'reg.exe',
        ['query', key, '/s'],
        { timeout: timeoutMs, windowsHide: true, maxBuffer: 512 * 1024, encoding: 'buffer' },
        (error, stdout) => {
          if (error || !stdout) {
            resolve('')
            return
          }
          const buffer = Buffer.isBuffer(stdout) ? stdout : Buffer.from(String(stdout))
          resolve(decodeBuffer(buffer).text)
        }
      )
    } catch {
      // 受限环境（如沙箱）可能禁止启动 reg.exe，静默跳过注册表来源
      resolve('')
    }
  })
}

/**
 * 从 Windows 注册表读取 JavaSoft / 各发行版的安装路径。
 * 只在 win32 下执行；失败或超时返回空数组，不影响目录扫描。
 */
export async function queryWindowsJavaHomes(timeoutMs = 1200): Promise<string[]> {
  if (process.platform !== 'win32') return []

  const outputs = await Promise.all(REGISTRY_KEYS.map((key) => regQuery(key, timeoutMs)))
  const homes = new Set<string>()

  for (const text of outputs) {
    if (!text) continue
    for (const match of text.matchAll(VALUE_PATTERN)) {
      const home = normalizeHome(match[1])
      if (home) homes.add(home)
    }
  }

  return [...homes]
}
