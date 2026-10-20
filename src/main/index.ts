import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import type {
  AiAnalysis,
  AiRequest,
  AnalyzeRequest,
  BaseAnalysis,
  DirAnalyzeRequest,
  IpcResult,
  JavaScanResult,
  LauncherIntegration,
  LauncherProfile,
  LinesRequest,
  LinesResult,
  Settings,
  SettingsTestResult
} from '../shared/types'
import { analyzeArchive, analyzeGameDir } from './analysis/base'
import { looksLikeGameDir } from './analysis/scan'
import {
  buildEvidencePack,
  callModel,
  parseAiJson,
  toAiAnalysis,
  type AiContext
} from './analysis/ai'
import { applyLauncherDefaults, resolveLauncherProfile } from './launcher'
import { scanJavaRuntimes } from './java/scan'
import { migrateLegacyUserData } from './migrate'
import { normalizeLauncher, readSettings, writeSettings } from './settings'

let mainWindow: BrowserWindow | null = null
let lastContext: AiContext | null = null
let pendingAi: AbortController | null = null
let launcherProfile: LauncherProfile = { state: 'disabled', warnings: [] }
let profileSeq = 0
let javaCache: JavaScanResult | null = null
let javaScanning: Promise<JavaScanResult> | null = null

const SUPPORTED = /\.(zip|log|txt)$/i

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 640,
    title: '灵羽的MC日志分析器',
    show: false,
    backgroundColor: '#0a0d12',
    autoHideMenuBar: true,
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#0a0d12',
      symbolColor: '#9aa7ba',
      height: 44
    },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // 渲染进程运行在 Chromium 沙箱内：preload 只保留 ipcRenderer / contextBridge / webUtils，
      // 渲染层即使被注入也无法直接摸到 Node。回归点见 tools/e2e.cjs 的 apiPlatform 断言。
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    const allowed = devUrl ? url.startsWith(devUrl) : url.startsWith('file://')
    if (!allowed) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    mainWindow.loadURL(devUrl)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function refreshLauncherProfile(): Promise<LauncherProfile> {
  const seq = ++profileSeq
  try {
    const settings = await readSettings()
    const next = await resolveLauncherProfile(settings.launcher)
    if (seq === profileSeq) launcherProfile = next
    return next
  } catch (error) {
    const next: LauncherProfile = {
      state: 'error',
      warnings: [],
      error: error instanceof Error ? error.message : String(error)
    }
    if (seq === profileSeq) launcherProfile = next
    return next
  }
}

function javaCachePath(): string {
  return join(app.getPath('userData'), 'java-runtimes.json')
}

async function readJavaCache(): Promise<JavaScanResult | null> {
  try {
    const raw = await fs.readFile(javaCachePath(), 'utf8')
    const parsed = JSON.parse(raw) as JavaScanResult
    if (!parsed || !Array.isArray(parsed.runtimes)) return null
    return {
      runtimes: parsed.runtimes,
      scannedAt: typeof parsed.scannedAt === 'string' ? parsed.scannedAt : '',
      durationMs: Number(parsed.durationMs) || 0,
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings : []
    }
  } catch {
    return null
  }
}

async function writeJavaCache(result: JavaScanResult): Promise<void> {
  try {
    await fs.mkdir(dirname(javaCachePath()), { recursive: true })
    await fs.writeFile(javaCachePath(), JSON.stringify(result, null, 2), 'utf8')
  } catch {
    // 缓存写入失败不影响扫描结果
  }
}

async function scanJava(): Promise<JavaScanResult> {
  if (javaScanning) return javaScanning

  const task = (async (): Promise<JavaScanResult> => {
    const result = await scanJavaRuntimes({
      launcherJavaPath: launcherProfile.javaPath,
      extraRoots: launcherProfile.gameDir ? [join(launcherProfile.gameDir, 'runtime')] : []
    })
    javaCache = result
    await writeJavaCache(result)
    return result
  })()

  javaScanning = task.finally(() => {
    javaScanning = null
  })
  return javaScanning
}

function registerIpc(): void {
  ipcMain.handle('dialog:pick-archive', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择日志压缩包',
      properties: ['openFile'],
      filters: [
        { name: '日志压缩包', extensions: ['zip', 'log', 'txt'] },
        { name: '全部文件', extensions: ['*'] }
      ]
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const path = result.filePaths[0]
    const stat = await fs.stat(path)
    return { path, name: basename(path), size: stat.size }
  })

  ipcMain.handle('dialog:pick-game-dir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 Minecraft 游戏目录',
      properties: ['openDirectory'],
      buttonLabel: '分析此目录'
    })
    if (result.canceled || result.filePaths.length === 0) return null

    const path = result.filePaths[0]
    return { path, name: basename(path) }
  })

  ipcMain.handle('settings:get', () => readSettings())
  ipcMain.handle('settings:save', async (_event, next: Settings) => {
    const saved = await writeSettings(next)
    void refreshLauncherProfile()
    return saved
  })

  ipcMain.handle('dialog:pick-launcher', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择 PCL2 或 HMCL 启动器文件',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [
              { name: '启动器', extensions: ['exe', 'jar', 'bat', 'cmd'] },
              { name: '全部文件', extensions: ['*'] }
            ]
          : [
              { name: '启动器', extensions: ['jar', 'sh', 'bat', 'cmd'] },
              { name: '全部文件', extensions: ['*'] }
            ]
    })
    if (result.canceled || result.filePaths.length === 0) return null
    return { path: result.filePaths[0] }
  })

  ipcMain.handle('launcher:get', () => launcherProfile)

  ipcMain.handle('launcher:refresh', async (_event, integration?: LauncherIntegration) => {
    if (!integration) return refreshLauncherProfile()

    const seq = ++profileSeq
    const next = await resolveLauncherProfile(normalizeLauncher(integration))
    if (seq === profileSeq) launcherProfile = next
    return next
  })

  ipcMain.handle('java:list', async () => {
    if (!javaCache) javaCache = await readJavaCache()
    return javaCache ?? { runtimes: [], scannedAt: '', durationMs: 0, warnings: [] }
  })

  ipcMain.handle('java:scan', () => scanJava())

  ipcMain.handle('settings:test', async (_event, settings: Settings): Promise<SettingsTestResult> => {
    const baseUrl = (settings.baseUrl ?? '').replace(/\/+$/, '')
    if (!baseUrl) return { ok: false, error: '请先填写 Base URL' }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 8000)
    const startedAt = Date.now()

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: settings.apiKey ? { Authorization: `Bearer ${settings.apiKey}` } : {},
        signal: controller.signal
      })

      if (!response.ok) {
        if (response.status === 401 || response.status === 403) return { ok: false, error: 'API Key 无效或无权限' }
        if (response.status === 404) return { ok: false, error: '该地址没有 /models 接口，请检查 Base URL' }
        return { ok: false, error: `服务返回 ${response.status}` }
      }

      return { ok: true, latency: Date.now() - startedAt }
    } catch {
      return {
        ok: false,
        error: controller.signal.aborted ? '连接超时（8 秒）' : '无法连接到该地址，请检查网络或代理'
      }
    } finally {
      clearTimeout(timer)
    }
  })

  ipcMain.handle(
    'analysis:run',
    async (event, request: AnalyzeRequest): Promise<IpcResult<BaseAnalysis>> => {
      try {
        if (!SUPPORTED.test(request.name)) {
          return { ok: false, error: '当前版本仅支持 .zip 压缩包，或单个 .log / .txt 日志文件。' }
        }

        const stat = await fs.stat(request.path)
        if (!stat.isFile()) return { ok: false, error: '请选择一个文件，而不是文件夹。' }

        const settings = await readSettings()
        if (settings.launcher.enabled && launcherProfile.state === 'disabled') {
          await refreshLauncherProfile()
        }
        const sizeMb = stat.size / 1048576
        if (sizeMb > settings.maxArchiveMb) {
          return {
            ok: false,
            error: `压缩包 ${sizeMb.toFixed(0)} MB，超过设置中的 ${settings.maxArchiveMb} MB 上限。可在设置中调高。`
          }
        }

        const sender = event.sender
        const output = await analyzeArchive(
          request.path,
          request.name,
          stat.size,
          (progress) => {
            if (!sender.isDestroyed()) sender.send('analysis:progress', progress)
          },
          { useRuleEngine: settings.useRuleEngine }
        )

        applyLauncherDefaults(output.base, launcherProfile)
        lastContext = { base: output.base, sources: output.sources, modJars: output.modJars }
        return { ok: true, data: output.base }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle(
    'analysis:run-dir',
    async (event, request: DirAnalyzeRequest): Promise<IpcResult<BaseAnalysis>> => {
      try {
        const stat = await fs.stat(request.path)
        if (!stat.isDirectory()) return { ok: false, error: '请选择一个文件夹。' }

        if (!(await looksLikeGameDir(request.path))) {
          return {
            ok: false,
            error: '所选目录不像 Minecraft 游戏目录（缺少 logs、crash-reports 或 versions）。'
          }
        }

        const settings = await readSettings()
        if (settings.launcher.enabled && launcherProfile.state === 'disabled') {
          await refreshLauncherProfile()
        }

        const sender = event.sender
        const output = await analyzeGameDir(
          request.path,
          basename(request.path),
          (progress) => {
            if (!sender.isDestroyed()) sender.send('analysis:progress', progress)
          },
          { useRuleEngine: settings.useRuleEngine }
        )

        applyLauncherDefaults(output.base, launcherProfile)
        lastContext = { base: output.base, sources: output.sources, modJars: output.modJars }
        return { ok: true, data: output.base }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
  )

  ipcMain.handle('analysis:ai', async (event, request: AiRequest): Promise<IpcResult<AiAnalysis>> => {
    if (!lastContext) return { ok: false, error: '尚未完成基础分析，无法调用 AI。' }
    if (pendingAi) return { ok: false, error: '已有 AI 分析正在进行，请等待完成或先取消。' }

    const settings = await readSettings()

    if (request.trigger === 'auto' && !settings.autoAi) {
      return { ok: false, error: '未启用「自动 AI 分析」，已阻止本次自动调用。' }
    }
    if (!settings.apiKey && settings.provider !== 'ollama') {
      return { ok: false, error: '尚未配置 API Key，请先在设置的「模型服务」中填写。' }
    }

    const startedAt = Date.now()
    const controller = new AbortController()
    pendingAi = controller
    const sender = event.sender

    try {
      const pack = buildEvidencePack(lastContext, settings)
      const { text, usage } = await callModel(
        settings,
        pack,
        (delta) => {
          if (!sender.isDestroyed()) sender.send('analysis:chunk', { type: 'delta', text: delta })
        },
        controller.signal
      )

      const raw = parseAiJson(text)
      return {
        ok: true,
        data: toAiAnalysis(raw, lastContext, settings, usage, Date.now() - startedAt)
      }
    } catch (error) {
      if (controller.signal.aborted) return { ok: false, error: '已取消 AI 分析。' }
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    } finally {
      pendingAi = null
    }
  })

  ipcMain.handle('analysis:cancel', () => {
    pendingAi?.abort()
  })

  ipcMain.handle(
    'analysis:lines',
    async (_event, request: LinesRequest): Promise<IpcResult<LinesResult>> => {
      if (!lastContext) return { ok: false, error: '尚未完成基础分析。' }

      const source = lastContext.sources.find(
        (item) => item.file.path === request.file || item.file.name === request.file
      )
      if (!source) return { ok: false, error: '未在当前会话中找到该文件。' }

      const count = Math.max(20, Math.min(400, request.count ?? 160))
      const total = source.log.lines.length + source.log.lineOffset
      const half = Math.floor(count / 2)
      let startIndex = Math.max(0, request.line - 1 - source.log.lineOffset - half)
      startIndex = Math.min(startIndex, Math.max(0, source.log.lines.length - count))

      return {
        ok: true,
        data: {
          file: source.file.path,
          start: startIndex + 1 + source.log.lineOffset,
          total,
          lines: source.log.lines.slice(startIndex, startIndex + count)
        }
      }
    }
  )
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.lingyu.mclog')
  await migrateLegacyUserData()
  registerIpc()
  createWindow()
  void refreshLauncherProfile()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
