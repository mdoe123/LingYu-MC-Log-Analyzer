export type LogFileKind =
  | 'crash'
  | 'latest'
  | 'debug'
  | 'fml'
  | 'hs_err'
  | 'launcher'
  | 'history'
  | 'version_json'
  | 'other'

export type Severity = 'critical' | 'high' | 'medium' | 'low'
export type FixLevel = 'immediate' | 'try' | 'diagnose'

export interface ScannedFile {
  id: string
  name: string
  path: string
  size: number
  bytesRead: number
  lines: number
  kind: LogFileKind
  encoding: string
  included: boolean
  note: string
  truncated: boolean
}

export interface Environment {
  launcher?: string
  loader?: string
  mcVersion?: string
  javaVersion?: string
  os?: string
  memoryMaxMb?: number
  modCount?: number
}

export type CrashStage = 'launcher' | 'init' | 'runtime' | 'unknown'

export interface StageGuess {
  stage: CrashStage
  label: string
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export interface EvidenceItem {
  id: string
  file: string
  line: number
  level: 'ERROR' | 'FATAL' | 'WARN'
  body: string
}

export interface RuleFix {
  title: string
  detail: string
  level: FixLevel
}

export interface RuleHit {
  id: string
  severity: Severity
  title: string
  detail: string
  evidence: EvidenceItem[]
  suspects: string[]
  fixes: RuleFix[]
}

export interface Suspect {
  name: string
  version?: string
  reason: string
  score: number
  kind: 'mod' | 'plugin' | 'loader' | 'java' | 'config' | 'unknown'
}

export interface CrashSummary {
  file: string
  description: string
  rootCause?: string
  causedByChain: string[]
  firstForeignFrame?: string
  exceptionType?: string
  modCount?: number
  head: string
}

export interface LogStats {
  totalLines: number
  errors: number
  warnings: number
  exceptionBlocks: number
}

export interface SignatureCount {
  keyword: string
  count: number
  file?: string
  line?: number
}

export interface BaseAnalysis {
  archiveName: string
  archiveSize: number
  entryCount: number
  files: ScannedFile[]
  environment: Environment
  stageGuess: StageGuess
  stats: LogStats
  crashReports: CrashSummary[]
  findings: RuleHit[]
  suspects: Suspect[]
  signatures: SignatureCount[]
  notes: string[]
  durationMs: number
  analyzedAt: string
}

export interface AiComponent {
  name: string
  version?: string
  role: string
  primary: boolean
}

export interface AiFix {
  title: string
  detail: string
  level: FixLevel
}

export interface AiSecondary {
  title: string
  detail: string
  count: number
}

export interface AiAnalysis {
  severity: Severity
  title: string
  summary: string
  category: string
  location: string
  confidence: number
  rootCause: string[]
  evidence: EvidenceItem[]
  components: AiComponent[]
  fixes: AiFix[]
  secondary: AiSecondary[]
  model: string
  usage?: { input: number; output: number }
  durationMs: number
}

export type LauncherKind = 'auto' | 'pcl' | 'hmcl'

export interface LauncherIntegration {
  enabled: boolean
  kind: LauncherKind
  exePath: string
}

export type LauncherProfileState = 'disabled' | 'unconfigured' | 'ok' | 'error'

export type JavaRuntimeSource = 'env' | 'path' | 'registry' | 'standard' | 'launcher' | 'custom'
export type JavaArch = 'x86' | 'x64' | 'aarch64' | 'unknown'

export interface JavaRuntimeInfo {
  home: string
  executable?: string
  version?: string
  major?: number
  vendor?: string
  arch: JavaArch
  source: JavaRuntimeSource
  valid: boolean
  error?: string
}

export interface JavaScanResult {
  runtimes: JavaRuntimeInfo[]
  scannedAt: string
  durationMs: number
  warnings: string[]
}

export interface LauncherProfile {
  state: LauncherProfileState
  kind?: 'pcl' | 'hmcl'
  exePath?: string
  configPath?: string
  gameDir?: string
  instance?: string
  javaPath?: string
  maxMemoryMb?: number
  warnings: string[]
  error?: string
  resolvedAt?: string
}

export interface Settings {
  provider: string
  baseUrl: string
  model: string
  apiKey: string
  temperature: number
  maxTokens: number
  language: 'zh' | 'en'
  useRuleEngine: boolean
  redact: boolean
  maxEvidence: number
  autoAi: boolean
  maxArchiveMb: number
  launcher: LauncherIntegration
}

export interface AnalyzeProgress {
  stage: string
  label: string
  detail?: string
  progress: number
}

export interface AnalyzeRequest {
  path: string
  name: string
  size: number
}

export interface DirAnalyzeRequest {
  path: string
}

export interface AiRequest {
  trigger: 'manual' | 'auto'
}

export interface LinesRequest {
  file: string
  line: number
  count?: number
}

export interface LinesResult {
  file: string
  start: number
  total: number
  lines: string[]
}

export type AiChunk = { type: 'delta'; text: string } | { type: 'status'; text: string }

export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }

export interface SettingsTestResult {
  ok: boolean
  latency?: number
  error?: string
}

export interface AppApi {
  pickArchive: () => Promise<{ path: string; name: string; size: number } | null>
  getPathForFile: (file: File) => string
  settings: {
    get: () => Promise<Settings>
    save: (settings: Settings) => Promise<Settings>
    test: (settings: Settings) => Promise<SettingsTestResult>
  }
  analysis: {
    run: (request: AnalyzeRequest) => Promise<IpcResult<BaseAnalysis>>
    runDir: (request: DirAnalyzeRequest) => Promise<IpcResult<BaseAnalysis>>
    pickDir: () => Promise<{ path: string; name: string } | null>
    ai: (request: AiRequest) => Promise<IpcResult<AiAnalysis>>
    cancel: () => Promise<void>
    lines: (request: LinesRequest) => Promise<IpcResult<LinesResult>>
    onProgress: (cb: (event: AnalyzeProgress) => void) => () => void
    onAiChunk: (cb: (chunk: AiChunk) => void) => () => void
  }
  launcher: {
    pick: () => Promise<{ path: string } | null>
    get: () => Promise<LauncherProfile>
    refresh: (integration?: LauncherIntegration) => Promise<LauncherProfile>
  }
  java: {
    list: () => Promise<JavaScanResult>
    scan: () => Promise<JavaScanResult>
  }
  platform: string
}
