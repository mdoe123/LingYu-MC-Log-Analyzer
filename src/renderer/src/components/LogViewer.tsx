import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { LinesResult, ScannedFile } from '../types'
import { Icon } from './Icons'
import { bridge } from '../lib/bridge'
import { formatBytes, formatCount } from '../lib/format'

interface Props {
  file: ScannedFile
  line: number
  onClose: () => void
}

export function LogViewer({ file, line, onClose }: Props): ReactNode {
  const [data, setData] = useState<LinesResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const targetRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let active = true
    setData(null)
    setError(null)

    bridge.analysis.lines({ file: file.path, line, count: 220 }).then((result) => {
      if (!active) return
      if (result.ok) setData(result.data)
      else setError(result.error)
    })

    return () => {
      active = false
    }
  }, [file.path, line])

  useEffect(() => {
    if (data) targetRef.current?.scrollIntoView({ block: 'center' })
  }, [data])

  return (
    <div className="modal" onClick={onClose} role="dialog" aria-label={`${file.name} 预览`}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <Icon name="file" size={13} />
          <span style={{ color: 'var(--txt)' }}>{file.path}</span>
          <span className="meta">
            {formatBytes(file.size)} · {formatCount(file.lines)} 行 · {file.encoding}
          </span>
          <button
            type="button"
            className="icon-btn"
            style={{ marginLeft: 'auto' }}
            onClick={onClose}
            aria-label="关闭"
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="logbody">
          {error && <div className="empty-note">{error}</div>}
          {!data && !error && <div className="empty-note">正在读取…</div>}
          {data && data.lines.length === 0 && <div className="empty-note">该文件没有可显示的内容。</div>}
          {data &&
            data.lines.map((text, index) => {
              const number = data.start + index
              const isTarget = number === line
              return (
                <div
                  key={number}
                  className={`logline${isTarget ? ' hl' : ''}`}
                  ref={isTarget ? targetRef : undefined}
                >
                  <span className="ln">{formatCount(number)}</span>
                  <span className="txt">{text || ' '}</span>
                </div>
              )
            })}
        </div>

        {data && (
          <div className="modal-foot">
            显示第 {formatCount(data.start)} – {formatCount(data.start + data.lines.length - 1)} 行，共{' '}
            {formatCount(data.total)} 行
          </div>
        )}
      </div>
    </div>
  )
}
