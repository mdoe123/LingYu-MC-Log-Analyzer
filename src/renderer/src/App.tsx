import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import type {
  AiAnalysis,
  AnalyzeProgress,
  BaseAnalysis,
  EvidenceItem,
  Phase,
  Settings,
  StageView
} from './types'
import { BASE_STAGES, DEFAULT_SETTINGS } from './data/mock'
import { Header } from './components/Header'
import { Sidebar, type FootAction } from './components/Sidebar'
import { IdleView } from './components/IdleView'
import { BaseProgressView, AiProgressView } from './components/ProgressViews'
import { BaseResultView } from './components/BaseResultView'
import { AiResultView } from './components/AiResultView'
import { SettingsDrawer } from './components/SettingsDrawer'
import { LogViewer } from './components/LogViewer'
import { Icon } from './components/Icons'
import { bridge, isDesktop } from './lib/bridge'
import { formatBytes, formatDuration, SEVERITY_META } from './lib/format'

interface ArchiveRef {
  path: string
  name: string
  size: number
}

export default function App(): ReactNode {
  const [phase, setPhase] = useState<Phase>('idle')
  const phaseRef = useRef<Phase>('idle')

  const [archive, setArchive] = useState<ArchiveRef | null>(null)
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS)
  const [hydrated, setHydrated] = useState(false)

  const [base, setBase] = useState<BaseAnalysis | null>(null)
  const [ai, setAi] = useState<AiAnalysis | null>(null)
  const [aiTrigger, setAiTrigger] = useState<'manual' | 'auto'>('manual')
  const [aiError, setAiError] = useState<string | null>(null)
  const [autoSkipped, setAutoSkipped] = useState(false)

  const [progress, setProgress] = useState<AnalyzeProgress | null>(null)
  const [progressLog, setProgressLog] = useState<AnalyzeProgress[]>([])
  const [stream, setStream] = useState('')
  const [error, setError] = useState<string | null>(null)

  const [settingsOpen, setSettingsOpen] = useState(false)
  const [viewer, setViewer] = useState<{ file: string; line: number } | null>(null)
  const [toast, setToast] = useState<string | null>(null)

  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const toastTimer = useRef<number | null>(null)
  const [launcherDir, setLauncherDir] = useState<{ path: string; label: string } | null>(null)

  const setPhaseSafe = useCallback((next: Phase) => {
    phaseRef.current = next
    setPhase(next)
  }, [])

  const notify = useCallback((text: string) => {
    setToast(text)
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle('is-electron', isDesktop)
    void bridge.settings.get().then((value) => {
      setSettings(value)
      setHydrated(true)
    })
  }, [])

  useEffect(() => {
    if (!hydrated || !settings.launcher.enabled) {
      setLauncherDir(null)
      return
    }
    void bridge.launcher.refresh(settings.launcher).then((profile) => {
      setLauncherDir(
        profile.state === 'ok' && profile.gameDir
          ? { path: profile.gameDir, label: profile.kind === 'pcl' ? 'PCL2' : 'HMCL' }
          : null
      )
    })
  }, [hydrated, settings.launcher.enabled, settings.launcher.kind, settings.launcher.exePath])

  useEffect(() => {
    if (!hydrated) return
    void bridge.settings.save(settings)
  }, [settings, hydrated])

  useEffect(() => {
    const offProgress = bridge.analysis.onProgress((event) => {
      setProgress(event)
      setProgressLog((prev) => [...prev.slice(-40), event])
    })
    const offChunk = bridge.analysis.onAiChunk((chunk) => {
      if (chunk.type === 'delta') setStream((prev) => prev + chunk.text)
    })
    return () => {
      offProgress()
      offChunk()
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setViewer(null)
        setSettingsOpen(false)
      }
      if ((e.ctrlKey || e.metaKey) && e.key === ',') {
        e.preventDefault()
        setSettingsOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    return () => {
      if (toastTimer.current) window.clearTimeout(toastTimer.current)
    }
  }, [])

  const stages = useMemo<StageView[]>(() => {
    const currentIndex = progress ? BASE_STAGES.findIndex((item) => item.id === progress.stage) : -1
    const finished = (progress?.progress ?? 0) >= 100

    return BASE_STAGES.map((stage, index) => {
      let state: StageView['state'] = 'pending'
      if (finished || (currentIndex >= 0 && index < currentIndex)) state = 'done'
      else if (index === currentIndex) state = 'running'

      const detail = progressLog
        .filter((item) => item.stage === stage.id && item.detail)
        .slice(-1)[0]?.detail

      return { id: stage.id, label: stage.label, hint: stage.hint, detail, state }
    })
  }, [progress, progressLog])

  const runAi = useCallback(
    async (trigger: 'manual' | 'auto') => {
      const current = phaseRef.current
      if (current !== 'ready' && current !== 'done') return
      if (trigger === 'auto' && !settings.autoAi) return
      if (!settings.apiKey && settings.provider !== 'ollama') {
        notify(
          isDesktop
            ? '请先在设置中配置 API Key'
            : '演示环境：在设置里随便填一个 API Key 即可体验 AI 流程'
        )
        setSettingsOpen(true)
        return
      }

      setAiTrigger(trigger)
      setAiError(null)
      setAutoSkipped(false)
      setStream('')
      setAi(null)
      setPhaseSafe('ai')

      const result = await bridge.analysis.ai({ trigger })

      if (!result.ok) {
        setPhaseSafe('ready')
        if (result.error !== '已取消 AI 分析。') {
          setAiError(result.error)
          notify(result.error)
        }
        return
      }

      setAi(result.data)
      setPhaseSafe('done')
    },
    [settings.autoAi, settings.apiKey, settings.provider, notify, setPhaseSafe]
  )

  const runAnalysis = useCallback(
    async (file: ArchiveRef, mode: 'archive' | 'dir' = 'archive') => {
      setArchive(file)
      setAi(null)
      setBase(null)
      setStream('')
      setError(null)
      setAiError(null)
      setAutoSkipped(false)
      setProgress(null)
      setProgressLog([])
      setViewer(null)
      setPhaseSafe('base')

      const result =
        mode === 'archive'
          ? await bridge.analysis.run({ path: file.path, name: file.name, size: file.size })
          : await bridge.analysis.runDir({ path: file.path })

      if (!result.ok) {
        setError(result.error)
        setPhaseSafe('error')
        return
      }

      setBase(result.data)
      setPhaseSafe('ready')

      if (settings.autoAi) {
        if (settings.apiKey || settings.provider === 'ollama') {
          void runAi('auto')
        } else {
          setAutoSkipped(true)
          notify('已启用自动 AI 分析，但未配置 API Key，本次已跳过模型调用')
        }
      }
    },
    [settings.autoAi, settings.apiKey, settings.provider, runAi, setPhaseSafe, notify]
  )

  const pickArchive = async (): Promise<void> => {
    if (isDesktop) {
      const picked = await bridge.pickArchive()
      if (picked) void runAnalysis(picked)
      return
    }
    inputRef.current?.click()
  }

  const pickGameDir = async (): Promise<void> => {
    const picked = await bridge.analysis.pickDir()
    if (picked) void runAnalysis({ path: picked.path, name: picked.name, size: 0 }, 'dir')
  }

  const launcherName = launcherDir
    ? launcherDir.path.split(/[\\/]/).filter(Boolean).pop() ?? '本地实例'
    : ''

  const onDragEnter = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const onDragOver = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const onDragLeave = (e: DragEvent<HTMLDivElement>): void => {
    if (!e.dataTransfer.types.includes('Files')) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault()
    dragDepth.current = 0
    setDragging(false)

    const file = e.dataTransfer.files?.[0]
    if (!file) return

    const path = isDesktop ? bridge.getPathForFile(file) : ''
    if (isDesktop && !path) {
      notify('无法获取文件路径，请改用「选择压缩包」')
      return
    }

    void runAnalysis({ path, name: file.name, size: file.size })
  }

  const toMarkdown = (): string => {
    if (ai && base) {
      const lines = [`# ${ai.title}`, '']
      lines.push(`- 严重级别：${SEVERITY_META[ai.severity].label}`)
      lines.push(`- 置信度：${Math.round(ai.confidence * 100)}%`)
      lines.push(`- 故障类型：${ai.category}`)
      lines.push(`- 触发位置：${ai.location}`)
      lines.push(`- 失败阶段：${base.stageGuess.label}`)
      lines.push(`- 模型：${ai.model}`)
      lines.push('', '## 根因', '')
      ai.rootCause.forEach((p) => lines.push(p, ''))
      lines.push('## 关键证据', '')
      ai.evidence.forEach((item) => {
        lines.push(`### ${item.file}:${item.line}`, '```', item.body, '```', '')
      })
      lines.push('## 相关组件', '')
      ai.components.forEach((c) => lines.push(`- ${c.name} ${c.version ?? ''}（${c.role}）`))
      lines.push('', '## 修复建议', '')
      ai.fixes.forEach((fix, i) => lines.push(`${i + 1}. **${fix.title}** — ${fix.detail}`))
      return lines.join('\n')
    }

    if (!base) return ''
    const lines = [`# 基础分析：${base.archiveName}`, '']
    lines.push(`- 失败阶段：${base.stageGuess.label}（置信度 ${base.stageGuess.confidence}）`)
    lines.push(`- 依据：${base.stageGuess.reason}`)
    lines.push(
      `- 环境：${base.environment.loader ?? '未知加载器'} / MC ${base.environment.mcVersion ?? '未知'}`
    )
    lines.push('', '## 规则命中', '')
    base.findings.forEach((hit) => {
      lines.push(`### [${SEVERITY_META[hit.severity].label}] ${hit.title}`, '', hit.detail, '')
      hit.fixes.forEach((fix, i) => lines.push(`${i + 1}. **${fix.title}** — ${fix.detail}`))
      lines.push('')
    })
    lines.push('## 疑似模组', '')
    base.suspects.forEach((item) => lines.push(`- ${item.name} ${item.version ?? ''}（${item.reason}）`))
    return lines.join('\n')
  }

  const copyReport = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(toMarkdown())
      notify('报告已复制到剪贴板')
    } catch {
      notify('复制失败，请检查剪贴板权限')
    }
  }

  const exportReport = (): void => {
    const blob = new Blob([toMarkdown()], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `mc-log-analysis-${new Date().toISOString().slice(0, 10)}.md`
    link.click()
    URL.revokeObjectURL(url)
    notify('已导出 Markdown 报告')
  }

  const footActions: FootAction[] = (() => {
    if (phase === 'base') {
      return [{ id: 'busy', label: '分析中', icon: 'refresh', disabled: true, onClick: () => undefined }]
    }
    if (phase === 'ai') {
      return [
        {
          id: 'cancel',
          label: '取消 AI 分析',
          icon: 'stop',
          onClick: () => {
            void bridge.analysis.cancel()
          }
        }
      ]
    }
    if (phase === 'ready') {
      return [
        { id: 'ai', label: 'AI 分析', icon: 'spark', primary: true, onClick: () => void runAi('manual') },
        { id: 'pick', label: '换文件', icon: 'upload', onClick: () => void pickArchive() }
      ]
    }
    if (phase === 'done') {
      return [
        {
          id: 'rerun',
          label: '重新分析',
          icon: 'refresh',
          onClick: () => {
            if (archive) void runAnalysis(archive)
          }
        },
        { id: 'pick', label: '换文件', icon: 'upload', onClick: () => void pickArchive() }
      ]
    }
    return [{ id: 'pick', label: '选择压缩包', icon: 'upload', primary: true, onClick: () => void pickArchive() }]
  })()

  const viewerFile = viewer ? base?.files.find((file) => file.path === viewer.file) ?? null : null

  return (
    <div
      className="app"
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Header
        archive={archive ? { name: archive.name, size: archive.size } : null}
        model={settings.model || '未配置模型'}
        autoAi={settings.autoAi}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="workbench">
        <Sidebar
          files={base?.files ?? []}
          activeFile={viewer?.file ?? null}
          isOver={dragging}
          onPick={() => void pickArchive()}
          onPickDir={() => void pickGameDir()}
          onOpenFile={(file) => setViewer({ file: file.path, line: 1 })}
          footActions={footActions}
        />

        <main className="main">
          <div className="main-inner">
            {phase === 'idle' && (
              <IdleView
                isOver={dragging}
                onPick={() => void pickArchive()}
                onPickDir={() => void pickGameDir()}
                quick={
                  launcherDir && launcherName
                    ? {
                        label: launcherDir.label,
                        name: launcherName,
                        path: launcherDir.path,
                        onAnalyze: () =>
                          void runAnalysis(
                            { path: launcherDir.path, name: launcherName, size: 0 },
                            'dir'
                          )
                      }
                    : undefined
                }
                onDemo={
                  isDesktop
                    ? undefined
                    : () => void runAnalysis({ path: '', name: 'crash-2026-10-20_12.04.31-client.zip', size: 13002342 })
                }
              />
            )}

            {phase === 'base' && <BaseProgressView stages={stages} progress={progress?.progress ?? 0} />}

            {phase === 'ai' && base && <AiProgressView base={base} stream={stream} auto={aiTrigger === 'auto'} />}

            {phase === 'ready' && base && (
              <BaseResultView
                base={base}
                settings={settings}
                aiError={aiError}
                autoSkipped={autoSkipped}
                onAi={() => void runAi('manual')}
                onOpenSettings={() => setSettingsOpen(true)}
                onLocate={(item: EvidenceItem) => setViewer({ file: item.file, line: item.line || 1 })}
              />
            )}

            {phase === 'done' && ai && base && (
              <AiResultView
                ai={ai}
                base={base}
                onLocate={(item: EvidenceItem) => setViewer({ file: item.file, line: item.line || 1 })}
                onCopy={() => void copyReport()}
                onExport={exportReport}
                onRunAgain={() => void runAi('manual')}
              />
            )}

            {phase === 'error' && (
              <div className="error-card">
                <Icon name="alert" size={20} style={{ color: 'var(--danger)' }} />
                <div style={{ flex: 1 }}>
                  <div className="error-title">无法完成分析</div>
                  <div className="error-text">{error}</div>
                </div>
                <button type="button" className="btn btn-sm" onClick={() => void pickArchive()}>
                  重新选择
                </button>
              </div>
            )}

            {phase === 'ready' && base && (
              <p className="main-footnote">
                基础分析用时 {formatDuration(base.durationMs)}，共解析 {base.stats.totalLines.toLocaleString('en-US')}{' '}
                行，压缩包 {formatBytes(base.archiveSize)}。以上结果全部来自本机规则，未调用任何模型。
              </p>
            )}
          </div>
        </main>
      </div>

      {dragging && (
        <div className="curtain">
          <div className="curtain-inner">
            <Icon name="zip" size={34} style={{ color: 'var(--accent)' }} />
            <div className="curtain-title">松开以开始基础分析</div>
            <div className="curtain-sub">支持 HMCL / PCL2 导出的 .zip，或单个 .log 文件</div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <SettingsDrawer
          settings={settings}
          onChange={(patch) => setSettings((prev) => ({ ...prev, ...patch }))}
          onClose={() => setSettingsOpen(false)}
          onReset={() => {
            setSettings(DEFAULT_SETTINGS)
            notify('已恢复默认设置')
          }}
        />
      )}

      {viewerFile && viewer && (
        <LogViewer file={viewerFile} line={viewer.line} onClose={() => setViewer(null)} />
      )}

      {toast && (
        <div className="toast">
          <Icon name="check" size={13} style={{ color: 'var(--accent)' }} />
          {toast}
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".zip,.log,.txt"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void runAnalysis({ path: '', name: file.name, size: file.size })
          e.target.value = ''
        }}
      />
    </div>
  )
}
