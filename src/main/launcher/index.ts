import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type { BaseAnalysis, LauncherIntegration, LauncherProfile } from '../../shared/types'
import { readHmclConfig } from './hmcl'
import { readPclConfig } from './pcl'

const KIND_LABEL: Record<'pcl' | 'hmcl', string> = { pcl: 'PCL2', hmcl: 'HMCL' }

export function launcherKindLabel(kind: 'pcl' | 'hmcl' | undefined): string {
  return kind ? KIND_LABEL[kind] : '启动器'
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await fs.stat(path)).isFile()
  } catch {
    return false
  }
}

async function detectKind(exePath: string, dir: string): Promise<'pcl' | 'hmcl' | null> {
  const name = basename(exePath).toLowerCase()
  if (name.includes('hmcl')) return 'hmcl'
  if (name.includes('pcl') || name.includes('plain craft')) return 'pcl'

  if (await fileExists(join(dir, 'PCL', 'Setup.ini'))) return 'pcl'
  if (
    (await fileExists(join(dir, 'config', 'launcher-settings.json'))) ||
    (await fileExists(join(dir, 'hmcl.json'))) ||
    (await fileExists(join(dir, '.hmcl.json')))
  ) {
    return 'hmcl'
  }
  return null
}

/**
 * 解析启动器配置。只读，不执行启动器，也不修改其文件。
 * 任何失败都转换为 `state: 'error'`，由调用方回退到默认设置。
 */
export async function resolveLauncherProfile(integration: LauncherIntegration): Promise<LauncherProfile> {
  const warnings: string[] = []

  if (!integration.enabled) return { state: 'disabled', warnings }

  const exePath = integration.exePath.trim()
  if (!exePath) return { state: 'unconfigured', warnings }

  try {
    const stat = await fs.stat(exePath)
    if (!stat.isFile()) {
      return { state: 'error', exePath, warnings, error: '所选路径不是文件' }
    }
  } catch {
    return { state: 'error', exePath, warnings, error: '启动器路径不存在或无法访问' }
  }

  const dir = dirname(exePath)
  const kind =
    integration.kind === 'pcl' || integration.kind === 'hmcl'
      ? integration.kind
      : await detectKind(exePath, dir)

  if (!kind) {
    return {
      state: 'error',
      exePath,
      warnings,
      error: '无法识别启动器类型，请在设置中手动指定 PCL2 或 HMCL'
    }
  }

  try {
    if (kind === 'pcl') {
      const configPath = join(dir, 'PCL', 'Setup.ini')
      if (!(await fileExists(configPath))) {
        return {
          state: 'error',
          kind,
          exePath,
          warnings,
          error: '未找到 PCL2 配置文件 PCL/Setup.ini'
        }
      }

      const config = await readPclConfig(dir, configPath)
      if (!config.gameDir && config.maxMemoryMb === undefined) {
        return {
          state: 'error',
          kind,
          exePath,
          configPath,
          warnings: config.warnings,
          error: '已找到 PCL2 配置，但未读取到可用设置'
        }
      }

      return {
        state: 'ok',
        kind,
        exePath,
        configPath,
        gameDir: config.gameDir,
        maxMemoryMb: config.maxMemoryMb,
        warnings: config.warnings,
        resolvedAt: new Date().toISOString()
      }
    }

    const config = await readHmclConfig(dir)
    if (!config) {
      return {
        state: 'error',
        kind,
        exePath,
        warnings,
        error: '未找到 HMCL 配置文件（config/launcher-settings.json 或 hmcl.json）'
      }
    }

    if (!config.gameDir && !config.javaPath && !config.maxMemoryMb && !config.instance) {
      return {
        state: 'error',
        kind,
        exePath,
        configPath: config.configPath,
        warnings: config.warnings,
        error: '已找到 HMCL 配置，但未读取到可用设置'
      }
    }

    return {
      state: 'ok',
      kind,
      exePath,
      configPath: config.configPath,
      gameDir: config.gameDir,
      instance: config.instance,
      javaPath: config.javaPath,
      maxMemoryMb: config.maxMemoryMb,
      warnings: config.warnings,
      resolvedAt: new Date().toISOString()
    }
  } catch (error) {
    return {
      state: 'error',
      kind,
      exePath,
      warnings,
      error: error instanceof Error ? error.message : String(error)
    }
  }
}

/**
 * 将启动器配置作为“默认值”补进分析结果：只填日志里缺失的字段，不覆盖已有值。
 * `state !== 'ok'` 时完全不改动结果，保证关闭时行为与原有版本一致。
 */
export function applyLauncherDefaults(base: BaseAnalysis, profile: LauncherProfile): void {
  if (profile.state !== 'ok') return

  const applied: string[] = []

  if (!base.environment.launcher && profile.kind) {
    base.environment.launcher = KIND_LABEL[profile.kind]
    applied.push('启动器')
  }

  if (base.environment.memoryMaxMb === undefined && profile.maxMemoryMb !== undefined) {
    base.environment.memoryMaxMb = profile.maxMemoryMb
    applied.push('最大内存')
  }

  if (applied.length === 0) return

  const label = launcherKindLabel(profile.kind)
  const source = profile.configPath ? `（${profile.configPath}）` : ''
  base.notes.push(
    `运行环境中的${applied.join('、')}来自 ${label} 配置${source}，仅在日志未提供该字段时填充，已有值不会被覆盖。`
  )
}
