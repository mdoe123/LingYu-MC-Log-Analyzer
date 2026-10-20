import type { ReactNode } from 'react'
import type { BaseAnalysis, StageView } from '../types'
import { StageList } from './StageList'
import { Icon } from './Icons'
import { formatDuration } from '../lib/format'

export function BaseProgressView({
  stages,
  progress
}: {
  stages: StageView[]
  progress: number
}): ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <StageList title="基础分析" stages={stages} progress={progress} />
      <div className="notice">
        <Icon name="alert" size={13} />
        <span>
          基础分析完全在本机执行。完成后如果未开启「自动 AI 分析」，流程会停在此处，不会向模型发送任何内容。
        </span>
      </div>
    </div>
  )
}

export function AiProgressView({
  base,
  stream,
  auto
}: {
  base: BaseAnalysis
  stream: string
  auto: boolean
}): ReactNode {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">基础分析已完成</span>
          <span className="panel-sub mono">{formatDuration(base.durationMs)}</span>
        </div>
        <div className="summary-row">
          <span>{base.stageGuess.label}</span>
          <span className="dot-sep">·</span>
          <span>{base.findings.length} 条规则命中</span>
          <span className="dot-sep">·</span>
          <span>{base.suspects.length} 个嫌疑对象</span>
          <span className="dot-sep">·</span>
          <span>{base.stats.totalLines.toLocaleString('en-US')} 行已解析</span>
        </div>
      </section>

      <section className="panel">
        <div className="panel-head">
          <span className="panel-title">AI 归因分析</span>
          <span className="panel-sub">{auto ? '设置自动触发 · 流式输出' : '手动触发 · 流式输出'}</span>
        </div>
        <div className="stream">
          {stream || '正在准备证据包…'}
          <span className="caret" />
        </div>
      </section>
    </div>
  )
}
