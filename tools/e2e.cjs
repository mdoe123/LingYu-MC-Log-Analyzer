const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

require('../out/main/index.js')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

setTimeout(() => {
  console.log('E2E: TIMEOUT')
  app.exit(2)
}, 30000)

app.whenReady().then(async () => {
  let tmpRoot = ''
  try {
    await wait(1800)
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) throw new Error('主进程未创建窗口')

    await wait(800)
    const fixture = path.join(__dirname, '../test/fixture.zip')
    const size = fs.statSync(fixture).size

    // 构造一个最小 PCL2 目录，用于验证启动器联动 IPC（不依赖本机真实启动器）
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mclog-e2e-'))
    const pclDir = path.join(tmpRoot, 'pcl')
    const gameDir = path.join(pclDir, 'game')
    const pclExe = path.join(pclDir, 'Plain Craft Launcher 2.exe')
    fs.mkdirSync(path.join(pclDir, 'PCL'), { recursive: true })
    fs.mkdirSync(path.join(gameDir, 'logs'), { recursive: true })
    fs.mkdirSync(path.join(gameDir, 'crash-reports'), { recursive: true })
    fs.writeFileSync(pclExe, 'stub')
    fs.writeFileSync(
      path.join(pclDir, 'PCL', 'Setup.ini'),
      [`LaunchFolderSelect:${gameDir}`, 'LaunchRamType:1', 'LaunchRamCustom:6'].join('\n')
    )
    fs.copyFileSync(
      path.join(__dirname, '../test/fixture-src/logs/latest.log'),
      path.join(gameDir, 'logs', 'latest.log')
    )
    fs.copyFileSync(
      path.join(__dirname, '../test/fixture-src/crash-reports/crash-2026-10-20_12.04.31-client.txt'),
      path.join(gameDir, 'crash-reports', 'crash-2026-10-20_12.04.31-client.txt')
    )

    const result = await win.webContents.executeJavaScript(`
      (async () => {
        const launcherBefore = await window.api.launcher.get()
        const profile = await window.api.launcher.refresh({
          enabled: true,
          kind: 'auto',
          exePath: ${JSON.stringify(pclExe)}
        })

        const run = await window.api.analysis.run({ path: ${JSON.stringify(fixture)}, name: 'fixture.zip', size: ${size} })
        if (!run.ok) return { stage: 'run-failed', error: run.error }

        const auto = await window.api.analysis.ai({ trigger: 'auto' })
        const lines = await window.api.analysis.lines({ file: 'logs/latest.log', line: 17, count: 4 })
        const dirRun = await window.api.analysis.runDir({ path: ${JSON.stringify(gameDir)} })
        const javaList = await window.api.java.list()
        return {
          archive: run.data.archiveName,
          files: run.data.files.length,
          stage: run.data.stageGuess.stage,
          loader: run.data.environment.loader,
          findings: run.data.findings.map((f) => f.title),
          suspects: run.data.suspects.slice(0, 3).map((s) => s.name + ':' + s.score),
          autoGuard: auto.ok ? 'LEAKED' : auto.error,
          linesOk: lines.ok,
          firstLine: lines.ok ? lines.data.lines[0].slice(0, 60) : lines.error,
          launcherDefault: launcherBefore.state,
          launcherState: profile.state,
          launcherKind: profile.kind,
          launcherGameDirOk: profile.gameDir === ${JSON.stringify(gameDir)},
          launcherMemory: profile.maxMemoryMb,
          envMemory: run.data.environment.memoryMaxMb,
          envLauncher: run.data.environment.launcher,
          launcherNote: run.data.notes.some((n) => n.includes('PCL2')),
          dirOk: dirRun.ok,
          dirFiles: dirRun.ok ? dirRun.data.files.length : dirRun.error,
          dirStage: dirRun.ok ? dirRun.data.stageGuess.stage : '',
          javaCached: javaList.runtimes.length
        }
      })()
    `)

    console.log('E2E:', JSON.stringify(result, null, 2))
    fs.rmSync(tmpRoot, { recursive: true, force: true })
    app.exit(0)
  } catch (error) {
    if (tmpRoot) {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
    console.log('E2E: FAILED', error && error.stack ? error.stack : error)
    app.exit(1)
  }
})
