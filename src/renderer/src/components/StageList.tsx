import type { ReactNode } from 'react'
import type { StageView } from '../types'
import { Icon } from './Icons'

interface Props {
  title: string
  subtitle?: string
  stages: StageView[]
  progress: number
}

export function StageList({ title, subtitle, stages, progress }: Props): ReactNode {
  return (
    <section className="panel">
      <div className="panel-head">
        <span className="panel-title">{title}</span>
        <span className="panel-sub mono">{subtitle ?? `${Math.round(progress)}%`}</span>
      </div>

      <div
        className="bar"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div className="bar-fill" style={{ width: `${Math.min(100, Math.max(0, progress))}%` }} />
      </div>

      <div>
        {stages.map((stage) => (
          <div key={stage.id} className={`stage is-${stage.state}`}>
            <span className="stage-dot">{stage.state === 'done' && <Icon name="check" size={9} />}</span>
            <div className="stage-body">
              <div className="stage-label">{stage.label}</div>
              {stage.state === 'done' && stage.detail ? (
                <div className="stage-detail">{stage.detail}</div>
              ) : (
                <div className="stage-hint">{stage.hint}</div>
              )}
            </div>
            <span className="stage-state">
              {stage.state === 'done' ? '完成' : stage.state === 'running' ? '进行中' : '等待'}
            </span>
          </div>
        ))}
      </div>
    </section>
  )
}
