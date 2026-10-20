import { promises as fs } from 'node:fs'
import { isAbsolute, join, resolve } from 'node:path'

export interface HmclConfig {
  configPath: string
  gameDir?: string
  instance?: string
  javaPath?: string
  maxMemoryMb?: number
  warnings: string[]
}

const CONFIG_CANDIDATES = ['config/launcher-settings.json', 'hmcl.json', '.hmcl.json']
const INSTANCE_SETTINGS = ['.hmcl', 'config', 'instance-game-settings.json']

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function asId(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  const record = asRecord(value)
  return record ? asString(record.id) : undefined
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function readJson(path: string): Promise<unknown> {
  const text = (await fs.readFile(path, 'utf8')).replace(/^\uFEFF/, '')
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`HMCL 配置文件不是合法 JSON（${path}）：${error instanceof Error ? error.message : '解析失败'}`)
  }
}

function normalizeDir(value: string, launcherDir: string): string {
  return isAbsolute(value) ? value : resolve(launcherDir, value)
}

/** 从 `config/game-directories.json` 中按 ID 查目录路径，兼容字符串与对象两种写法。 */
async function resolveGameDirectoryById(launcherDir: string, id: string): Promise<string | undefined> {
  const path = join(launcherDir, 'config', 'game-directories.json')
  if (!(await fileExists(path))) return undefined

  const parsed = asRecord(await readJson(path))
  const list = parsed?.directories
  if (!Array.isArray(list)) return undefined

  for (const item of list) {
    const record = asRecord(item)
    if (!record || asId(record.id) !== id) continue
    const rawPath = record.path
    const value = typeof rawPath === 'string' ? rawPath : asString(asRecord(rawPath)?.path)
    if (value) return normalizeDir(value, launcherDir)
  }
  return undefined
}

async function findInstanceSettings(gameDir: string): Promise<{ instance: string; path: string }[]> {
  const versions = join(gameDir, 'versions')
  let entries
  try {
    entries = await fs.readdir(versions, { withFileTypes: true })
  } catch {
    return []
  }

  const found: { instance: string; path: string }[] = []
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const path = join(versions, entry.name, ...INSTANCE_SETTINGS)
    if (await fileExists(path)) found.push({ instance: entry.name, path })
  }
  return found
}

async function readInstanceSettings(
  path: string
): Promise<{ maxMemoryMb?: number; javaPath?: string; warnings: string[] }> {
  const warnings: string[] = []
  const parsed = asRecord(await readJson(path))
  if (!parsed) return { warnings: [`HMCL 实例配置为空：${path}`] }

  let maxMemoryMb: number | undefined
  const memory = Number(parsed.maxMemory)
  if (Number.isFinite(memory) && memory >= 256 && memory <= 65536) maxMemoryMb = Math.round(memory)
  else if (parsed.maxMemory !== undefined) warnings.push(`HMCL 实例内存超出合理范围：${String(parsed.maxMemory)}`)

  const javaPath = asString(parsed.customJavaPath) ?? asString(parsed.javaPath) ?? asString(parsed.javaDir)
  return { maxMemoryMb, javaPath, warnings }
}

/**
 * 读取 HMCL 3.16+ 的 `config/launcher-settings.json`；旧版回退 `hmcl.json` / `.hmcl.json`。
 * 实例级设置位于 `<gameDir>/versions/<instance>/.hmcl/config/instance-game-settings.json`。
 */
export async function readHmclConfig(launcherDir: string): Promise<HmclConfig | null> {
  let configPath: string | undefined
  for (const candidate of CONFIG_CANDIDATES) {
    const path = join(launcherDir, candidate)
    if (await fileExists(path)) {
      configPath = path
      break
    }
  }
  if (!configPath) return null

  const parsed = asRecord(await readJson(configPath))
  if (!parsed) throw new Error(`HMCL 配置内容不是对象：${configPath}`)

  const warnings: string[] = []
  const selectedId = asId(parsed.selectedGameDirectory)

  let gameDir: string | undefined
  const legacyGameDir = asString(parsed.gameDir)
  if (legacyGameDir) {
    gameDir = normalizeDir(legacyGameDir, launcherDir)
  } else if (selectedId) {
    gameDir = await resolveGameDirectoryById(launcherDir, selectedId)
    if (!gameDir) warnings.push(`HMCL 配置引用了游戏目录 ${selectedId}，但无法在 game-directories.json 中解析`)
  }

  if (!gameDir) {
    const fallback = join(launcherDir, '.minecraft')
    if (await dirExists(fallback)) {
      gameDir = fallback
      warnings.push('未解析到 HMCL 选定的游戏目录，已回退到启动器同级的 .minecraft')
    }
  }

  if (gameDir) {
    if (!(await dirExists(gameDir))) {
      warnings.push(`HMCL 配置中的游戏目录不存在：${gameDir}`)
      gameDir = undefined
    }
  }

  let instance: string | undefined
  const selectedInstance = asRecord(parsed.selectedInstance)
  if (selectedInstance) {
    const key = selectedId ?? gameDir
    if (key) instance = asString(selectedInstance[key])
  }

  let instanceSettingsPath: string | undefined
  if (gameDir && instance) {
    const path = join(gameDir, 'versions', instance, ...INSTANCE_SETTINGS)
    if (await fileExists(path)) instanceSettingsPath = path
    else warnings.push(`HMCL 选中实例 ${instance} 没有实例级配置文件，内存与 Java 使用启动器默认值`)
  } else if (gameDir) {
    const found = await findInstanceSettings(gameDir)
    if (found.length === 1) {
      instance = found[0].instance
      instanceSettingsPath = found[0].path
      warnings.push(`未确定 HMCL 选中的实例，已按唯一可用实例 ${instance} 读取`)
    } else if (found.length > 1) {
      warnings.push(`未确定 HMCL 选中的实例，${found.length} 个实例均可读取，已跳过实例级设置`)
    }
  }

  let maxMemoryMb: number | undefined
  let javaPath: string | undefined
  if (instanceSettingsPath) {
    const settings = await readInstanceSettings(instanceSettingsPath)
    maxMemoryMb = settings.maxMemoryMb
    javaPath = settings.javaPath
    warnings.push(...settings.warnings)
  }

  if (!javaPath) {
    javaPath = asString(parsed.javaDir) ?? asString(parsed.javaPath) ?? asString(parsed.customJavaPath)
  }

  return { configPath, gameDir, instance, javaPath, maxMemoryMb, warnings }
}
