import type { ReactNode } from 'react'
import type { LogFileKind, ScannedFile } from '../types'
import { Icon, type IconName } from './Icons'
import { formatBytes, formatCount } from '../lib/format'

const KIND_COLOR: Record<LogFileKind, string> = {
  crash: '#e5544b',
  hs_err: '#d9a441',
  latest: '#5b9df0',
  fml: '#8b7fe0',
  debug: '#5f6a78',
  history: '#5f6a78',
  launcher: '#57b8a8',
  version_json: '#6f7b8a',
  other: '#5f6a78'
}

export interface FootAction {
  id: string
  label: string
  icon: IconName
  primary?: boolean
  disabled?: boolean
  onClick: () => void
}

interface Props {
  files: ScannedFile[]
  activeFile: string | null
  isOver: boolean
  onPick: () => void
  onPickDir: () => void
  onOpenFile: (file: ScannedFile) => void
  footActions: FootAction[]
}

export function Sidebar({ files, activeFile, isOver, onPick, onPickDir, onOpenFile, footActions }: Props): ReactNode {
  const totalSize = files.reduce((sum, file) => sum + file.size, 0)

  return (
    <aside className="sidebar">
      <div className="sidebar-body">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <button
            type="button"
            className={`dropzone${isOver ? ' is-over' : ''}`}
            onClick={onPick}
            aria-label="选择日志压缩包"
          >
            <Icon name="upload" size={18} className="dropzone-icon" />
            <div className="dropzone-title">拖入压缩包</div>
            <div className="dropzone-sub">zip · 单个 .log / .txt</div>
          </button>

          <button type="button" className="btn btn-sm btn-ghost" style={{ width: '100%' }} onClick={onPickDir}>
            <Icon name="folder" size={12} />
            读取游戏目录
          </button>
        </div>

        <div>
          <div className="files-head">
            <b>日志文件</b>
            <span className="mono">{files.length > 0 ? formatBytes(totalSize) : '—'}</span>
          </div>

          {files.length === 0 ? (
            <div className="empty-note">尚未扫描到文件</div>
          ) : (
            <div className="files">
              {files.map((file) => (
                <div
                  key={file.id}
                  className={`file${activeFile === file.path ? ' is-active' : ''}`}
                  onClick={() => onOpenFile(file)}
                  role="button"
                  tabIndex={0}
                  title={`${file.path}（${file.note}）`}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onOpenFile(file)
                    }
                  }}
                >
                  <span className="file-bar" style={{ background: KIND_COLOR[file.kind] }} />
                  <span className="file-main">
                    <span className="file-name">{file.name}</span>
                    <span className="file-meta">
                      <span>{formatBytes(file.size)}</span>
                      <span>·</span>
                      <span>{formatCount(file.lines)} 行</span>
                      <span>·</span>
                      <span>{file.encoding}</span>
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {files.length === 0 && (
          <div>
            <div className="group-title" style={{ marginBottom: 7 }}>
              日志位置
            </div>
            <div
              className="mono"
              style={{ fontSize: 10.5, color: 'var(--txt-3)', lineHeight: 1.95, wordBreak: 'break-all' }}
            >
              <div>%APPDATA%\.minecraft\logs</div>
              <div>%APPDATA%\.minecraft\crash-reports</div>
              <div>整包：versions\&lt;版本&gt;\logs</div>
            </div>
          </div>
        )}
      </div>

      <div className="sidebar-foot">
        {footActions.map((action) => (
          <button
            key={action.id}
            type="button"
            className={`btn${action.primary ? ' btn-primary' : ''}`}
            onClick={action.onClick}
            disabled={action.disabled}
          >
            <Icon name={action.icon} size={12} />
            {action.label}
          </button>
        ))}
      </div>
    </aside>
  )
}
