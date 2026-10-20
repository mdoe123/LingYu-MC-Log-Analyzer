import type { ReactNode } from 'react'
import type { AiFix, EvidenceItem, FixLevel, RuleFix, Severity } from '../types'
import { Icon } from './Icons'
import { FIX_META, formatCount, SEVERITY_META } from '../lib/format'

export function SeverityPill({ severity, label }: { severity: Severity; label?: string }): ReactNode {
  const meta = SEVERITY_META[severity]
  return (
    <span
      className="sev-pill"
      style={{ background: meta.soft, color: meta.color, borderColor: `${meta.color}44` }}
    >
      {label ?? meta.label}
    </span>
  )
}

export function EvidenceBlock({
  item,
  onLocate
}: {
  item: EvidenceItem
  onLocate?: (item: EvidenceItem) => void
}): ReactNode {
  return (
    <div className="evidence">
      <div className="evidence-head">
        <span className={`lvl lvl-${item.level}`}>{item.level}</span>
        <span style={{ color: 'var(--txt-2)' }}>
          {item.file}:{formatCount(item.line)}
        </span>
        {onLocate && (
          <button type="button" className="link-btn" onClick={() => onLocate(item)}>
            在日志中定位 →
          </button>
        )}
      </div>
      <pre>{item.body}</pre>
    </div>
  )
}

export function FixList({
  fixes
}: {
  fixes: Array<AiFix | RuleFix>
}): ReactNode {
  return (
    <>
      {fixes.map((fix, index) => {
        const meta = FIX_META[fix.level as FixLevel]
        return (
          <div key={`${fix.title}-${index}`} className="fix">
            <span className="fix-idx">{String(index + 1).padStart(2, '0')}</span>
            <div className="fix-body">
              <div className="fix-title">
                {fix.title}
                <span className={`badge ${meta.cls}`}>{meta.label}</span>
              </div>
              <div className="fix-detail">{fix.detail}</div>
            </div>
          </div>
        )
      })}
    </>
  )
}

export function SectionTitle({ children, count }: { children: ReactNode; count?: number }): ReactNode {
  return (
    <div className="section-title">
      {children}
      {count !== undefined && <span className="count">{count}</span>}
    </div>
  )
}

export function EmptyHint({ text }: { text: string }): ReactNode {
  return (
    <div className="empty-inline">
      <Icon name="check" size={12} />
      {text}
    </div>
  )
}
