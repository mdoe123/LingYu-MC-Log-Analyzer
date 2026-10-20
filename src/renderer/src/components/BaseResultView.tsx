import { useState, type ReactNode } from 'react'
import type { BaseAnalysis, EvidenceItem, Settings } from '../types'
import { EvidenceBlock, FixList, SectionTitle, SeverityPill } from './parts'
import { Icon } from './Icons'
import { formatCount, formatDuration, SEVERITY_META } from '../lib/format'

interface Props {
  base: BaseAnalysis
  settings: Settings
  aiError: string | null
  autoSkipped: boolean
  onAi: () => void
  onOpenSettings: () => void
  onLocate: (item: EvidenceItem) => void
}

export function BaseResultView({
  base,
  settings,
  aiError,
  autoSkipped,
  onAi,
  onOpenSettings,
  onLocate
}: Props): ReactNode {
  const [openFixes, setOpenFixes] = useState<string[]>(() =>
    base.findings.length > 0 ? [base.findings[0].id] : []
  )

  const topSeverity = base.findings[0]?.severity ?? 'medium'
  const env = base.environment

  const envItems = [
    env.loader,
    env.mcVersion ? `MC ${env.mcVersion}` : undefined,
    env.javaVersion ? `Java ${env.javaVersion}` : undefined,
    env.memoryMaxMb ? `最大内存 ${env.memoryMaxMb} MB` : undefined,
    env.modCount !== undefined ? `${env.modCount} 个模组` : undefined,
    env.launcher ? `由 ${env.launcher} 导出` : undefined,
    env.os
  ].filter(Boolean) as string[]

  const toggleFixes = (id: string): void => {
    setOpenFixes((prev) => (prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]))
  }

  const autoState = settings.autoAi
    ? autoSkipped
      ? '已启用自动 AI 分析，但未配置 API Key，本次已跳过模型调用'
      : '自动 AI 分析已开启'
    : '自动 AI 分析已关闭 · 仅在你点击按钮时调用模型'

  return (
    <article className="result" data-sev={topSeverity}>
      <div className="result-head">
        <div className="result-head-top">
          <span className="status-pill">
            <Icon name="check" size={11} />
            基础分析完成
          </span>
          <span className="result-meta">
            <span>未调用模型</span>
            <span>用时 {formatDuration(base.durationMs)}</span>
          </span>
        </div>

        <h2 className="result-title">失败阶段：{base.stageGuess.label}</h2>
        <p className="result-summary">{base.stageGuess.reason}</p>
      </div>

      <dl className="metrics">
        <div className="metric">
          <dt>日志总行数</dt>
          <dd>{formatCount(base.stats.totalLines)}</dd>
        </div>
        <div className="metric">
          <dt>ERROR / WARN</dt>
          <dd>
            {formatCount(base.stats.errors)} / {formatCount(base.stats.warnings)}
          </dd>
        </div>
        <div className="metric">
          <dt>异常块</dt>
          <dd>{base.stats.exceptionBlocks}</dd>
        </div>
      </dl>

      {envItems.length > 0 && (
        <section className="section">
          <SectionTitle>运行环境</SectionTitle>
          <div className="chips">
            {envItems.map((item) => (
              <span key={item} className="comp">
                <span className="comp-dot" />
                <span className="comp-name" style={{ fontFamily: 'inherit' }}>
                  {item}
                </span>
              </span>
            ))}
          </div>
        </section>
      )}

      {base.crashReports.length > 0 && (
        <section className="section">
          <SectionTitle count={base.crashReports.length}>崩溃报告</SectionTitle>
          {base.crashReports.map((crash) => (
            <div key={crash.file} className="kv">
              <div className="kv-row">
                <span className="kv-key">Description</span>
                <span className="kv-val">{crash.description || '（空）'}</span>
              </div>
              {crash.rootCause && (
                <div className="kv-row">
                  <span className="kv-key">根因</span>
                  <span className="kv-val mono" style={{ fontSize: 11 }}>
                    {crash.rootCause}
                  </span>
                </div>
              )}
              {crash.firstForeignFrame && (
                <div className="kv-row">
                  <span className="kv-key">首个非原版帧</span>
                  <span className="kv-val mono" style={{ fontSize: 11 }}>
                    {crash.firstForeignFrame}
                  </span>
                </div>
              )}
              <div className="kv-row">
                <span className="kv-key">来源</span>
                <span className="kv-val mono" style={{ fontSize: 11 }}>
                  {crash.file}
                </span>
              </div>
            </div>
          ))}
        </section>
      )}

      <section className="section">
        <SectionTitle count={base.findings.length}>规则命中</SectionTitle>

        {base.findings.length === 0 ? (
          <div className="empty-inline">
            <Icon name="check" size={12} />
            未命中已知故障签名。可尝试开启 debug 日志参与分析，或直接让 AI 复核。
          </div>
        ) : (
          base.findings.map((finding) => (
            <div key={finding.id} className="finding">
              <div className="finding-head">
                <SeverityPill severity={finding.severity} />
                <span className="finding-title">{finding.title}</span>
                {finding.evidence.length > 0 && <span className="count">{finding.evidence.length}</span>}
              </div>
              <p className="finding-detail">{finding.detail}</p>

              {finding.evidence.slice(0, 2).map((item) => (
                <EvidenceBlock key={item.id} item={item} onLocate={onLocate} />
              ))}

              {finding.fixes.length > 0 && (
                <>
                  <button
                    type="button"
                    className="secondary-toggle"
                    style={{ marginTop: 8 }}
                    onClick={() => toggleFixes(finding.id)}
                  >
                    <Icon
                      name="chevron"
                      size={12}
                      style={{ transform: openFixes.includes(finding.id) ? 'none' : 'rotate(-90deg)' }}
                    />
                    处理建议
                    <span className="count">{finding.fixes.length}</span>
                  </button>
                  {openFixes.includes(finding.id) && (
                    <div style={{ marginTop: 8 }}>
                      <FixList fixes={finding.fixes} />
                    </div>
                  )}
                </>
              )}
            </div>
          ))
        )}
      </section>

      {base.suspects.length > 0 && (
        <section className="section">
          <SectionTitle count={base.suspects.length}>疑似模组</SectionTitle>
          <div className="suspects">
            {base.suspects.map((suspect) => (
              <div key={suspect.name} className="suspect-row">
                <span className="comp-name">{suspect.name}</span>
                {suspect.version && <span className="comp-ver">{suspect.version}</span>}
                <span className="suspect-reason">{suspect.reason}</span>
                <span
                  className="suspect-score"
                  style={{
                    background: SEVERITY_META[suspect.score >= 60 ? 'critical' : 'medium'].soft,
                    color: SEVERITY_META[suspect.score >= 60 ? 'critical' : 'medium'].color
                  }}
                >
                  {suspect.score}
                </span>
              </div>
            ))}
          </div>
          <p className="section-foot">分数由规则信号累加得出，仅表示可疑程度，不等同于确定结论。</p>
        </section>
      )}

      {base.signatures.length > 0 && (
        <section className="section">
          <SectionTitle>关键词统计</SectionTitle>
          <div className="sig-list">
            {base.signatures.map((item) => (
              <div key={item.keyword} className="sig-row">
                <span className="mono sig-key">{item.keyword}</span>
                <span className="sig-count">× {formatCount(item.count)}</span>
                {item.file && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() =>
                      onLocate({
                        id: `sig-${item.keyword}`,
                        file: item.file as string,
                        line: item.line ?? 1,
                        level: 'WARN',
                        body: ''
                      })
                    }
                  >
                    {item.file.split('/').pop()}:{formatCount(item.line ?? 1)}
                  </button>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {base.notes.length > 0 && (
        <section className="section">
          <SectionTitle>说明</SectionTitle>
          <ul className="note-list">
            {base.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <div className="ai-cta">
          <div className="ai-cta-head">
            <Icon name="spark" size={14} style={{ color: 'var(--accent)' }} />
            <span className="ai-cta-title">AI 深度归因</span>
            <span className="ai-cta-model">{settings.model || '未配置模型'}</span>
          </div>

          <p className="ai-cta-text">
            在规则初判的基础上，让模型复核根因、补齐版本组合关系，并给出有先后顺序的修复方案。发送内容是脱敏后的证据包，不包含完整日志。
          </p>

          <div className={`ai-cta-state${autoSkipped ? ' is-warn' : ''}`}>
            <span className="ai-cta-dot" />
            {autoState}
          </div>

          {aiError && <div className="ai-cta-error">{aiError}</div>}

          <div className="ai-cta-actions">
            <button type="button" className="btn btn-primary" onClick={onAi}>
              <Icon name="spark" size={12} />
              开始 AI 分析
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenSettings}>
              模型设置
            </button>
          </div>
        </div>
      </section>
    </article>
  )
}
