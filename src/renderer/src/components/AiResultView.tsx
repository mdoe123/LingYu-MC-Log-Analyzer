import { useState, type ReactNode } from 'react'
import type { AiAnalysis, BaseAnalysis, EvidenceItem } from '../types'
import { EvidenceBlock, FixList, SectionTitle } from './parts'
import { Icon } from './Icons'
import { formatDuration, SEVERITY_META } from '../lib/format'

interface Props {
  ai: AiAnalysis
  base: BaseAnalysis
  onLocate: (item: EvidenceItem) => void
  onCopy: () => void
  onExport: () => void
  onRunAgain: () => void
}

export function AiResultView({ ai, base, onLocate, onCopy, onExport, onRunAgain }: Props): ReactNode {
  const [showSecondary, setShowSecondary] = useState(false)
  const severity = SEVERITY_META[ai.severity]

  return (
    <article className="result" data-sev={ai.severity}>
      <div className="result-head">
        <div className="result-head-top">
          <span className="sev-badge" style={{ background: severity.soft, color: severity.color, borderColor: `${severity.color}44` }}>
            <Icon name="alert" size={11} />
            {severity.label}
          </span>
          <span className="result-meta">
            <span>置信度 {Math.round(ai.confidence * 100)}%</span>
            <span>用时 {formatDuration(ai.durationMs)}</span>
          </span>
        </div>

        <h2 className="result-title">{ai.title}</h2>
        <p className="result-summary">{ai.summary}</p>

        <div className="result-byline">
          <span>{ai.model}</span>
          {ai.usage && (
            <span>
              {ai.usage.input.toLocaleString('en-US')} in / {ai.usage.output.toLocaleString('en-US')} out
            </span>
          )}
          <span>规则命中 {base.findings.length} 条</span>
          <span>阶段：{base.stageGuess.label}</span>
        </div>
      </div>

      <dl className="metrics">
        <div className="metric">
          <dt>故障类型</dt>
          <dd>{ai.category}</dd>
        </div>
        <div className="metric">
          <dt>相关组件</dt>
          <dd>{ai.components.filter((item) => item.primary).length || ai.components.length} 个</dd>
        </div>
        <div className="metric">
          <dt>触发位置</dt>
          <dd className="mono" title={ai.location}>
            {ai.location || '—'}
          </dd>
        </div>
      </dl>

      <section className="section rootcause">
        <SectionTitle>故障原因</SectionTitle>
        {ai.rootCause.map((paragraph, index) => (
          <p key={index}>{paragraph}</p>
        ))}
      </section>

      {ai.evidence.length > 0 && (
        <section className="section">
          <SectionTitle count={ai.evidence.length}>关键证据</SectionTitle>
          {ai.evidence.map((item) => (
            <EvidenceBlock key={item.id} item={item} onLocate={onLocate} />
          ))}
        </section>
      )}

      {ai.components.length > 0 && (
        <section className="section">
          <SectionTitle>相关组件</SectionTitle>
          <div className="chips">
            {ai.components.map((component) => (
              <span
                key={`${component.name}-${component.version ?? ''}`}
                className={`comp${component.primary ? ' is-primary' : ''}`}
              >
                <span className="comp-dot" />
                <span className="comp-name">{component.name}</span>
                {component.version && <span className="comp-ver">{component.version}</span>}
                <span className="comp-role">{component.role}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      {ai.fixes.length > 0 && (
        <section className="section">
          <SectionTitle count={ai.fixes.length}>修复建议</SectionTitle>
          <FixList fixes={ai.fixes} />
        </section>
      )}

      {ai.secondary.length > 0 && (
        <section className="section">
          <button type="button" className="secondary-toggle" onClick={() => setShowSecondary((v) => !v)}>
            <Icon
              name="chevron"
              size={12}
              style={{ transform: showSecondary ? 'none' : 'rotate(-90deg)', transition: 'transform .15s' }}
            />
            其他发现
            <span className="count">{ai.secondary.length}</span>
          </button>

          {showSecondary && (
            <div className="secondary-list">
              {ai.secondary.map((issue) => (
                <div key={issue.title} className="secondary-item" style={{ flexDirection: 'column', gap: 2 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%' }}>
                    <span className="mono">{issue.title}</span>
                    <em>× {issue.count}</em>
                  </div>
                  <span style={{ color: 'var(--txt-3)', fontSize: 11 }}>{issue.detail}</span>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      <div className="result-foot">
        <button type="button" className="btn btn-sm" onClick={onCopy}>
          <Icon name="copy" size={12} />
          复制报告
        </button>
        <button type="button" className="btn btn-sm" onClick={onExport}>
          <Icon name="download" size={12} />
          导出 Markdown
        </button>
        <span className="spacer" />
        <button type="button" className="btn btn-sm btn-ghost" onClick={onRunAgain}>
          <Icon name="refresh" size={12} />
          重新分析
        </button>
      </div>
    </article>
  )
}
