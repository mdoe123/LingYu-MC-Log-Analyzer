import { useEffect, useRef, useState, type ReactNode } from 'react'
import type {
  JavaRuntimeSource,
  JavaScanResult,
  LauncherIntegration,
  LauncherProfile,
  Settings
} from '../types'
import { PROVIDERS } from '../data/mock'
import { Icon } from './Icons'
import { bridge } from '../lib/bridge'

const JAVA_SOURCE_LABEL: Record<JavaRuntimeSource, string> = {
  env: '环境变量',
  path: 'PATH',
  registry: '注册表',
  standard: '安装目录',
  launcher: '启动器',
  custom: '手动'
}

const JAVA_ARCH_LABEL = {
  x86: '32 位',
  x64: '64 位',
  aarch64: 'ARM64',
  unknown: '架构未知'
} as const

interface Props {
  settings: Settings
  onChange: (patch: Partial<Settings>) => void
  onClose: () => void
  onReset: () => void
}

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }): ReactNode {
  return (
    <button
      type="button"
      className={`switch${on ? ' on' : ''}`}
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onToggle}
    />
  )
}

export function SettingsDrawer({ settings, onChange, onClose, onReset }: Props): ReactNode {
  const [test, setTest] = useState<{ state: 'idle' | 'testing' | 'ok' | 'err'; text?: string }>({
    state: 'idle'
  })
  const [profile, setProfile] = useState<LauncherProfile | null>(null)
  const [checking, setChecking] = useState(false)
  const [java, setJava] = useState<JavaScanResult | null>(null)
  const [javaScanning, setJavaScanning] = useState(false)
  const alive = useRef(true)

  useEffect(() => {
    alive.current = true
    void bridge.java.list().then((value) => {
      if (alive.current) setJava(value)
    })
    return () => {
      alive.current = false
    }
  }, [])

  const runJavaScan = async (): Promise<void> => {
    setJavaScanning(true)
    try {
      const result = await bridge.java.scan()
      if (alive.current) setJava(result)
    } catch {
      if (alive.current) {
        setJava({
          runtimes: [],
          scannedAt: new Date().toISOString(),
          durationMs: 0,
          warnings: ['扫描失败，请稍后重试']
        })
      }
    } finally {
      if (alive.current) setJavaScanning(false)
    }
  }

  const refreshProfile = async (integration?: LauncherIntegration): Promise<void> => {
    setChecking(true)
    try {
      const next = await bridge.launcher.refresh(integration)
      if (alive.current) setProfile(next)
    } catch {
      if (alive.current) {
        setProfile({ state: 'error', warnings: [], error: '读取启动器配置失败' })
      }
    } finally {
      if (alive.current) setChecking(false)
    }
  }

  useEffect(() => {
    void refreshProfile(settings.launcher)
    // 仅在启动器相关设置变化时重新解析，避免其他设置项触发文件读取
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.launcher.enabled, settings.launcher.kind, settings.launcher.exePath])

  const updateLauncher = (patch: Partial<LauncherIntegration>): void => {
    onChange({ launcher: { ...settings.launcher, ...patch } })
  }

  const pickLauncher = async (): Promise<void> => {
    const picked = await bridge.launcher.pick()
    if (!picked) return
    updateLauncher({ exePath: picked.path })
  }

  const launcherStatus = ((): { tone: 'idle' | 'ok' | 'warn' | 'err'; text: string } => {
    if (checking) return { tone: 'idle', text: '正在读取启动器配置…' }
    if (!profile) return { tone: 'idle', text: '尚未读取配置' }
    if (profile.state === 'disabled') {
      return {
        tone: 'idle',
        text: settings.launcher.exePath
          ? '已选择启动器文件，但功能未启用'
          : '未启用：不会读取任何启动器配置文件'
      }
    }
    if (profile.state === 'unconfigured') return { tone: 'warn', text: '已启用，但尚未选择启动器文件' }
    if (profile.state === 'error') {
      return { tone: 'err', text: `${profile.error ?? '读取失败'}（已回退默认设置）` }
    }

    const label = profile.kind === 'pcl' ? 'PCL2' : 'HMCL'
    const parts = [
      profile.gameDir ? `游戏目录 ${profile.gameDir}` : '未读取到游戏目录',
      profile.instance ? `实例 ${profile.instance}` : '',
      profile.maxMemoryMb ? `最大内存 ${profile.maxMemoryMb} MB` : '',
      profile.javaPath ? `Java ${profile.javaPath}` : ''
    ].filter(Boolean)

    return { tone: 'ok', text: `已读取 ${label} 配置：${parts.join(' · ')}` }
  })()

  const runTest = async (): Promise<void> => {
    setTest({ state: 'testing' })
    const result = await bridge.settings.test(settings)
    if (!alive.current) return
    setTest({
      state: result.ok ? 'ok' : 'err',
      text: result.ok ? `连接正常 · ${result.latency ?? 0}ms` : (result.error ?? '连接失败')
    })
  }

  const pickProvider = (id: string): void => {
    const preset = PROVIDERS.find((item) => item.id === id)
    onChange(preset ? { provider: id, baseUrl: preset.baseUrl, model: preset.model } : { provider: id })
  }

  return (
    <>
      <div className="overlay" onClick={onClose} />
      <aside className="drawer" role="dialog" aria-label="设置">
        <div className="drawer-head">
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="drawer-title">设置</div>
            <div className="drawer-sub">模型接入、AI 触发方式与隐私选项</div>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="关闭设置">
            <Icon name="close" size={14} />
          </button>
        </div>

        <div className="drawer-body">
          <div className="group">
            <div className="group-title">AI 触发方式</div>

            <div className="switch-row">
              <div className="switch-text">
                <b>自动 AI 分析</b>
                <span>开启后，每次导入完成基础分析即自动调用模型；关闭时只有点击「AI 分析」才会调用。</span>
              </div>
              <Switch
                on={settings.autoAi}
                onToggle={() => onChange({ autoAi: !settings.autoAi })}
                label="自动 AI 分析"
              />
            </div>

            <p className="group-note">
              手动触发始终可用，不受此开关影响。两者不会重复调用：自动触发只在基础分析完成后执行一次，手动触发在分析进行中会被禁用。
            </p>
          </div>

          <div className="group">
            <div className="group-title">模型服务</div>

            <div className="field">
              <label className="field-label" htmlFor="provider">
                服务商
              </label>
              <select
                id="provider"
                className="select"
                value={settings.provider}
                onChange={(e) => pickProvider(e.target.value)}
              >
                {PROVIDERS.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="baseUrl">
                Base URL
              </label>
              <input
                id="baseUrl"
                className="input mono"
                value={settings.baseUrl}
                placeholder="https://api.deepseek.com/v1"
                onChange={(e) => onChange({ baseUrl: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="model">
                模型
              </label>
              <input
                id="model"
                className="input mono"
                value={settings.model}
                placeholder="deepseek-chat"
                onChange={(e) => onChange({ model: e.target.value })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="apiKey">
                API Key
                <small>{settings.provider === 'ollama' ? '本地模型无需填写' : '加密存于本机'}</small>
              </label>
              <input
                id="apiKey"
                className="input mono"
                type="password"
                autoComplete="off"
                value={settings.apiKey}
                placeholder="sk-..."
                onChange={(e) => onChange({ apiKey: e.target.value })}
              />
            </div>

            <div className="row" style={{ marginTop: 4 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void runTest()}
                disabled={test.state === 'testing' || !settings.baseUrl}
              >
                {test.state === 'testing' ? '测试中…' : '测试连接'}
              </button>
              {test.state === 'ok' && (
                <span className="test-status ok">
                  <Icon name="check" size={12} />
                  {test.text}
                </span>
              )}
              {test.state === 'err' && <span className="test-status err">{test.text}</span>}
            </div>
          </div>

          <div className="group">
            <div className="group-title">生成参数</div>

            <div className="field">
              <label className="field-label" htmlFor="temp">
                温度
                <small>{settings.temperature.toFixed(1)}</small>
              </label>
              <input
                id="temp"
                className="range"
                type="range"
                min={0}
                max={1}
                step={0.1}
                value={settings.temperature}
                onChange={(e) => onChange({ temperature: Number(e.target.value) })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="maxTokens">
                最大输出 tokens
              </label>
              <input
                id="maxTokens"
                className="input mono"
                type="number"
                min={256}
                max={8192}
                step={128}
                value={settings.maxTokens}
                onChange={(e) => onChange({ maxTokens: Number(e.target.value) })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="maxEvidence">
                证据块上限
                <small>{settings.maxEvidence}</small>
              </label>
              <input
                id="maxEvidence"
                className="range"
                type="range"
                min={2}
                max={16}
                step={1}
                value={settings.maxEvidence}
                onChange={(e) => onChange({ maxEvidence: Number(e.target.value) })}
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="lang">
                结论语言
              </label>
              <select
                id="lang"
                className="select"
                value={settings.language}
                onChange={(e) => onChange({ language: e.target.value as Settings['language'] })}
              >
                <option value="zh">简体中文</option>
                <option value="en">English</option>
              </select>
            </div>
          </div>

          <div className="group">
            <div className="group-title">分析行为</div>

            <div className="switch-row">
              <div className="switch-text">
                <b>启用本地规则引擎</b>
                <span>
                  已知故障签名先在本机匹配，基础分析永远不消耗 token。关闭后基础分析只输出文件、环境与阶段，
                  不再给出故障签名、嫌疑排序与关键词统计。
                </span>
              </div>
              <Switch
                on={settings.useRuleEngine}
                onToggle={() => onChange({ useRuleEngine: !settings.useRuleEngine })}
                label="启用本地规则引擎"
              />
            </div>

            <div className="switch-row">
              <div className="switch-text">
                <b>发送前脱敏</b>
                <span>替换 IP、UUID、邮箱与玩家名后再提交给模型。</span>
              </div>
              <Switch on={settings.redact} onToggle={() => onChange({ redact: !settings.redact })} label="发送前脱敏" />
            </div>
          </div>

          <div className="group">
            <div className="group-title">启动器联动</div>

            <div className="switch-row">
              <div className="switch-text">
                <b>读取启动器配置</b>
                <span>
                  启用后，应用启动时读取 PCL2 / HMCL 的配置文件，把游戏目录、内存与 Java 作为分析环境的补充默认值；不执行启动器，也不修改其文件。
                </span>
              </div>
              <Switch
                on={settings.launcher.enabled}
                onToggle={() => updateLauncher({ enabled: !settings.launcher.enabled })}
                label="读取启动器配置"
              />
            </div>

            <div className="field">
              <label className="field-label" htmlFor="launcherKind">
                启动器类型
              </label>
              <select
                id="launcherKind"
                className="select"
                value={settings.launcher.kind}
                onChange={(e) => updateLauncher({ kind: e.target.value as LauncherIntegration['kind'] })}
              >
                <option value="auto">自动识别</option>
                <option value="pcl">PCL2</option>
                <option value="hmcl">HMCL</option>
              </select>
            </div>

            <div className="field">
              <label className="field-label" htmlFor="launcherPath">
                启动器文件
                <small>仅读取，不执行</small>
              </label>
              <input
                id="launcherPath"
                className="input mono"
                value={settings.launcher.exePath}
                readOnly
                placeholder="尚未选择（PCL2.exe / HMCL.jar）"
              />
            </div>

            <div className="row" style={{ marginTop: 2 }}>
              <button type="button" className="btn btn-sm" onClick={() => void pickLauncher()}>
                选择文件
              </button>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => void refreshProfile()}
                disabled={checking || !settings.launcher.enabled}
              >
                重新读取
              </button>
            </div>

            <div
              className={`test-status${launcherStatus.tone === 'ok' ? ' ok' : launcherStatus.tone === 'err' ? ' err' : ''}`}
              style={{ marginTop: 6 }}
            >
              {launcherStatus.text}
            </div>

            {profile?.state === 'ok' && profile.configPath && (
              <p className="group-note">配置文件：{profile.configPath}</p>
            )}

            {profile && profile.warnings.length > 0 && (
              <p className="group-note">提示：{profile.warnings.join('；')}</p>
            )}

            <p className="group-note">
              默认关闭。关闭时不读取任何本地配置，分析与启动行为与未启用时一致；读取失败按默认设置继续，不阻塞应用启动。
            </p>
          </div>

          <div className="group">
            <div className="group-title">Java 运行时</div>

            <p className="group-note" style={{ marginTop: 0 }}>
              只读扫描环境变量、PATH、Windows 注册表与常见安装目录，不做全盘搜索；便携版 JDK 可能无法发现。
            </p>

            <div className="row" style={{ marginTop: 2 }}>
              <button
                type="button"
                className="btn btn-sm"
                onClick={() => void runJavaScan()}
                disabled={javaScanning}
              >
                {javaScanning ? '扫描中…' : '扫描本机 Java'}
              </button>
            </div>

            <div className="test-status" style={{ marginTop: 6 }}>
              {javaScanning
                ? '正在扫描，可能需要数秒…'
                : java && java.scannedAt
                  ? `已发现 ${java.runtimes.length} 个 Java · 用时 ${java.durationMs} ms`
                  : '尚未扫描；列表只读取上次缓存'}
            </div>

            {java && java.runtimes.length > 0 && (
              <div className="java-list">
                {java.runtimes.map((item) => (
                  <div key={item.home} className="java-item" title={item.home}>
                    <span className={`java-badge${item.valid ? '' : ' is-bad'}`}>
                      {item.valid ? `Java ${item.major}` : '无效'}
                    </span>
                    <span className="java-main">
                      <span className="mono">{item.home}</span>
                      <span className="java-meta">
                        {item.version ?? '版本未知'} · {item.vendor ?? '厂商未知'} ·{' '}
                        {JAVA_ARCH_LABEL[item.arch]} · {JAVA_SOURCE_LABEL[item.source]}
                      </span>
                      {!item.valid && <span className="java-err">{item.error ?? '不可用'}</span>}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {java && java.warnings.length > 0 && (
              <p className="group-note">提示：{java.warnings.join('；')}</p>
            )}

            <p className="group-note">扫描结果保存在本机，仅用于展示与后续选择，不参与日志分析。</p>
          </div>

          <div className="group">
            <div className="group-title">文件处理</div>

            <div className="field">
              <label className="field-label" htmlFor="maxArchive">
                单包体积上限（MB）
              </label>
              <input
                id="maxArchive"
                className="input mono"
                type="number"
                min={10}
                max={4096}
                step={10}
                value={settings.maxArchiveMb}
                onChange={(e) => onChange({ maxArchiveMb: Number(e.target.value) })}
              />
            </div>
          </div>
        </div>

        <div className="drawer-foot">
          <button type="button" className="btn btn-sm btn-ghost" onClick={onReset}>
            恢复默认
          </button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 10.5, color: 'var(--txt-3)', marginRight: 4 }}>设置仅保存在本机</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={onClose}>
            完成
          </button>
        </div>
      </aside>
    </>
  )
}
