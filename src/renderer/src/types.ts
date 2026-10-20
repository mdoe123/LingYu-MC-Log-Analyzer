export type {
  AiAnalysis,
  AiChunk,
  AiComponent,
  AiFix,
  AiRequest,
  AiSecondary,
  AnalyzeProgress,
  AnalyzeRequest,
  AppApi,
  BaseAnalysis,
  CrashStage,
  CrashSummary,
  DirAnalyzeRequest,
  Environment,
  EvidenceItem,
  FixLevel,
  IpcResult,
  JavaArch,
  JavaRuntimeInfo,
  JavaRuntimeSource,
  JavaScanResult,
  LauncherIntegration,
  LauncherKind,
  LauncherProfile,
  LauncherProfileState,
  LinesRequest,
  LinesResult,
  LogFileKind,
  RuleFix,
  RuleHit,
  ScannedFile,
  Settings,
  SettingsTestResult,
  Severity,
  SignatureCount,
  StageGuess,
  Suspect
} from '../../shared/types'

export type Phase = 'idle' | 'base' | 'ready' | 'ai' | 'done' | 'error'

export type StageState = 'pending' | 'running' | 'done'

export interface StageView {
  id: string
  label: string
  hint: string
  detail?: string
  state: StageState
}
