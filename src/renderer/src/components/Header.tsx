import type { ReactNode } from 'react'
import { BrandMark, Icon } from './Icons'
import { formatBytes } from '../lib/format'

interface Props {
  archive: { name: string; size: number } | null
  model: string
  autoAi: boolean
  onOpenSettings: () => void
}

export function Header({ archive, model, autoAi, onOpenSettings }: Props): ReactNode {
  return (
    <header className="topbar">
      <div className="brand">
        <BrandMark />
        <span className="brand-name">灵羽的MC日志分析器</span>
        <span className="brand-ver">v{__APP_VERSION__}</span>
      </div>

      <div className="topbar-center">
        {archive ? (
          <span className="chip" title={archive.name}>
            <span className="chip-dot" />
            <span className="chip-name">{archive.name}</span>
            {archive.size > 0 && <span style={{ color: 'var(--txt-3)' }}>{formatBytes(archive.size)}</span>}
          </span>
        ) : (
          <span className="chip" style={{ borderStyle: 'dashed', color: 'var(--txt-3)' }}>
            尚未载入压缩包
          </span>
        )}
      </div>

      <div className="topbar-right">
        {autoAi && (
          <span className="chip" title="设置中已启用自动 AI 分析">
            <span className="chip-dot" style={{ background: 'var(--warn)' }} />
            自动 AI 已开启
          </span>
        )}
        <span className="chip" title="当前使用的分析模型">
          <Icon name="spark" size={11} />
          <span className="chip-name">{model}</span>
        </span>
        <button type="button" className="icon-btn" onClick={onOpenSettings} title="设置 (Ctrl+,)">
          <Icon name="sliders" size={13} />
          设置
        </button>
      </div>
    </header>
  )
}
