import { app, safeStorage } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { LauncherIntegration, Settings } from '../shared/types'

export const DEFAULT_LAUNCHER: LauncherIntegration = {
  enabled: false,
  kind: 'auto',
  exePath: ''
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
  model: 'deepseek-chat',
  apiKey: '',
  temperature: 0.2,
  maxTokens: 2048,
  language: 'zh',
  useRuleEngine: true,
  redact: true,
  maxEvidence: 8,
  autoAi: false,
  maxArchiveMb: 200,
  launcher: DEFAULT_LAUNCHER
}

export function normalizeLauncher(value: unknown): LauncherIntegration {
  const raw = (value ?? {}) as Partial<LauncherIntegration>
  const kind = raw.kind === 'pcl' || raw.kind === 'hmcl' ? raw.kind : 'auto'
  return {
    enabled: raw.enabled === true,
    kind,
    exePath: typeof raw.exePath === 'string' ? raw.exePath : ''
  }
}

interface StoredSettings extends Partial<Settings> {
  apiKeyEnc?: string
}

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function readSettings(): Promise<Settings> {
  try {
    const raw = await fs.readFile(settingsPath(), 'utf8')
    const stored = JSON.parse(raw) as StoredSettings
    const merged: Settings = {
      ...DEFAULT_SETTINGS,
      ...stored,
      apiKey: '',
      launcher: normalizeLauncher(stored.launcher)
    }

    if (stored.apiKeyEnc && safeStorage.isEncryptionAvailable()) {
      try {
        merged.apiKey = safeStorage.decryptString(Buffer.from(stored.apiKeyEnc, 'base64'))
      } catch {
        merged.apiKey = ''
      }
    } else if (typeof stored.apiKey === 'string') {
      merged.apiKey = stored.apiKey
    }

    return merged
  } catch {
    return { ...DEFAULT_SETTINGS, launcher: { ...DEFAULT_LAUNCHER } }
  }
}

export async function writeSettings(next: Settings): Promise<Settings> {
  const launcher = normalizeLauncher(next.launcher)
  const normalized: Settings = {
    ...next,
    launcher,
    autoAi: Boolean(next.autoAi),
    maxEvidence: Math.max(2, Math.min(16, Number(next.maxEvidence) || 8)),
    maxArchiveMb: Math.max(10, Math.min(4096, Number(next.maxArchiveMb) || 200))
  }
  const payload: Record<string, unknown> = { ...normalized }
  delete payload.apiKey

  if (safeStorage.isEncryptionAvailable()) {
    payload.apiKeyEnc = safeStorage.encryptString(next.apiKey ?? '').toString('base64')
  } else {
    payload.apiKey = next.apiKey ?? ''
  }

  await fs.mkdir(app.getPath('userData'), { recursive: true })
  await fs.writeFile(settingsPath(), JSON.stringify(payload, null, 2), 'utf8')
  return normalized
}
