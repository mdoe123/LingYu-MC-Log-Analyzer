import { promises as fs } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'

export interface PclConfig {
  gameDir?: string
  maxMemoryMb?: number
  warnings: string[]
}

/**
 * PCL2 的 Setup.ini 并非标准 INI：它没有分节，每行是 `Key:Value`。
 * 参见 PCL2 `Modules/Base/ModBase.vb` 的 IniGetContent / WriteIni。
 */
export async function readPclConfig(launcherDir: string, configPath: string): Promise<PclConfig> {
  const warnings: string[] = []
  const text = (await fs.readFile(configPath, 'utf8')).replace(/^\uFEFF/, '')
  const entries = new Map<string, string>()

  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(':')
    if (index <= 0) continue
    const key = line.slice(0, index).trim()
    if (!key) continue
    entries.set(key, line.slice(index + 1).trim())
  }

  const config: PclConfig = { warnings }

  const folder = entries.get('LaunchFolderSelect')
  if (folder) {
    const gameDir = isAbsolute(folder) ? folder : resolve(launcherDir, folder)
    try {
      const stat = await fs.stat(gameDir)
      if (stat.isDirectory()) config.gameDir = gameDir
      else warnings.push(`PCL2 配置中的游戏目录不是文件夹：${gameDir}`)
    } catch {
      warnings.push(`PCL2 配置中的游戏目录不存在：${gameDir}`)
    }
  } else {
    warnings.push('PCL2 配置中没有 LaunchFolderSelect，未获取到游戏目录')
  }

  const ramType = entries.get('LaunchRamType')
  if (ramType === '1') {
    const custom = Number(entries.get('LaunchRamCustom'))
    if (Number.isFinite(custom) && custom > 0) {
      const mb = Math.round(custom * 1024)
      if (mb >= 256 && mb <= 65536) config.maxMemoryMb = mb
      else warnings.push(`PCL2 自定义内存超出合理范围：${custom} GB`)
    } else {
      warnings.push('PCL2 启用了自定义内存，但未读取到 LaunchRamCustom')
    }
  } else if (ramType !== undefined) {
    warnings.push('PCL2 内存为自动分配，配置中没有固定上限')
  }

  return config
}
