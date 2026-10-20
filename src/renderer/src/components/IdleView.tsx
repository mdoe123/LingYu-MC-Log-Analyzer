import type { ReactNode } from 'react'
import { Icon } from './Icons'

interface QuickDir {
  label: string
  name: string
  path: string
  onAnalyze: () => void
}

interface Props {
  isOver: boolean
  onPick: () => void
  onPickDir: () => void
  quick?: QuickDir
  onDemo?: () => void
}

const NOTES = [
  {
    title: '先本地，后模型',
    text: '解压、编码归一、规则匹配全部在本机完成，不联网。'
  },
  {
    title: 'AI 需明确触发',
    text: '只有点击「AI 分析」，或设置中开启自动分析，才会调用模型。'
  },
  {
    title: '证据可溯源',
    text: '每条结论都锚定到具体文件与行号，可一键跳转原文。'
  }
]

export function IdleView({ isOver, onPick, onPickDir, quick, onDemo }: Props): ReactNode {
  return (
    <div>
      <div className={`hero${isOver ? ' is-over' : ''}`} onClick={onPick}>
        <Icon name="upload" size={30} className="hero-icon" />
        <h1 className="hero-title">拖入日志压缩包，或直接读取游戏目录</h1>
        <p className="hero-sub">
          自动识别 crash-reports、latest.log、debug.log 与 hs_err_pid，先跑本地规则引擎判定失败阶段；也可以分析本机 .minecraft 目录，省去导出压缩包。AI 归因需要你明确触发。
        </p>

        <div className="hints">
          <span className="hint">crash-*.txt</span>
          <span className="hint">latest.log</span>
          <span className="hint">debug.log</span>
          <span className="hint">hs_err_pid*.log</span>
          <span className="hint">*.log.gz</span>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button
            type="button"
            className="btn btn-primary"
            onClick={(e) => {
              e.stopPropagation()
              onPick()
            }}
          >
            选择日志包
          </button>
          <button
            type="button"
            className="btn"
            onClick={(e) => {
              e.stopPropagation()
              onPickDir()
            }}
          >
            <Icon name="folder" size={12} />
            读取游戏目录
          </button>
          {quick && (
            <button
              type="button"
              className="btn"
              onClick={(e) => {
                e.stopPropagation()
                quick.onAnalyze()
              }}
            >
              <Icon name="play" size={12} />
              分析 {quick.label} 实例
            </button>
          )}
          {onDemo && (
            <button
              type="button"
              className="btn"
              onClick={(e) => {
                e.stopPropagation()
                onDemo()
              }}
            >
              <Icon name="play" size={12} />
              载入示例
            </button>
          )}
        </div>

        {quick && (
          <p
            className="mono"
            title={quick.path}
            style={{ fontSize: 10.5, color: 'var(--txt-3)', marginTop: 10, lineHeight: 1.6 }}
          >
            已从 {quick.label} 配置识别到实例「{quick.name}」，可直接分析。
          </p>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 10, marginTop: 14 }}>
        {NOTES.map((note) => (
          <div
            key={note.title}
            style={{
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius)',
              padding: '10px 12px',
              background: 'rgba(255,255,255,0.012)'
            }}
          >
            <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 2 }}>{note.title}</div>
            <div style={{ fontSize: 11, color: 'var(--txt-3)', lineHeight: 1.65 }}>{note.text}</div>
          </div>
        ))}
      </div>

      <p style={{ fontSize: 11, color: 'var(--txt-3)', textAlign: 'center', marginTop: 18, lineHeight: 1.7 }}>
        支持 HMCL「导出游戏崩溃信息」、PCL2「导出崩溃报告」的结构，单个 .log / .txt，或直接读取 .minecraft
        目录（logs、crash-reports、mods、versions）。
      </p>
    </div>
  )
}
