import type { CrashStage, FixLevel, Severity } from '../types'

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`
}

export function formatCount(value: number): string {
  return value.toLocaleString('en-US')
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(1, Math.round(ms))} ms`
  return `${(ms / 1000).toFixed(1)} s`
}

export const SEVERITY_META: Record<Severity, { label: string; color: string; soft: string }> = {
  critical: { label: '严重', color: 'var(--danger)', soft: 'var(--danger-soft)' },
  high: { label: '高', color: '#e08a3c', soft: 'rgba(224,138,60,.13)' },
  medium: { label: '中', color: 'var(--warn)', soft: 'var(--warn-soft)' },
  low: { label: '低', color: 'var(--txt-2)', soft: 'var(--surface-2)' }
}

export const FIX_META: Record<FixLevel, { label: string; cls: string }> = {
  immediate: { label: '立即处理', cls: 'badge-immediate' },
  try: { label: '可尝试', cls: 'badge-try' },
  diagnose: { label: '仅排查', cls: 'badge-diagnose' }
}

export const STAGE_META: Record<CrashStage, string> = {
  launcher: '启动器拉起阶段',
  init: '游戏 / 模组初始化',
  runtime: '运行期',
  unknown: '未判定'
}

export const CONFIDENCE_META: Record<'high' | 'medium' | 'low', string> = {
  high: '高',
  medium: '中',
  low: '低'
}
