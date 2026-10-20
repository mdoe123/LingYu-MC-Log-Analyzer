/**
 * 端到端冒烟：在真实 Electron 中通过 preload 调用 IPC，并对关键字段断言。
 *
 * 此前该脚本只打印结果，`run-failed` 与 `LEAKED`（自动 AI 门禁被绕过）
 * 也会以 0 退出，回归问题会被忽略。现在任何一条断言失败都以 1 退出。
 */
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

require('../out/main/index.js')

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

const failures = []

function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS ${name}`)
    return
  }
  failures.push(name)
  console.log(`  FAIL ${name}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
}

function eq(name, actual, expected) {
  check(name, actual === expected, { actual, expected })
}

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
          findings: run.data.findings.map((f) => f.id),
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
          javaCached: javaList.runtimes.length,
          // 渲染层与 preload 的存活证明：CSP 收紧或 sandbox 打开后，
          // 这两项会直接变成 false / undefined，是回归的第一道哨兵。
          rendered: document.getElementById('root').children.length > 0,
          apiPlatform: typeof window.api === 'object' && typeof window.api.platform === 'string'
        }
      })()
    `)

    console.log('E2E:', JSON.stringify(result, null, 2))
    console.log('')

    // --- 渲染层与 preload ---
    check('渲染层已挂载（CSP 未拦下脚本）', result.rendered === true, result.rendered)
    check('preload 桥接可用（sandbox 下 contextBridge 正常）', result.apiPlatform === true)

    // --- 压缩包分析 ---
    check('压缩包分析成功', result.stage !== 'run-failed', result.error)
    if (result.stage === 'run-failed') throw new Error(`分析失败：${result.error}`)

    eq('归档名', result.archive, 'fixture.zip')
    check('识别出多个日志文件', result.files >= 4, result.files)
    eq('阶段判定为初始化', result.stage, 'init')
    eq('加载器版本', result.loader, 'Forge 47.3.0')
    check('命中 Mixin 规则', result.findings.includes('mixin'), result.findings)
    check('命中重复模组规则', result.findings.includes('duplicate-mods'), result.findings)
    check('嫌疑首位为 oculus', (result.suspects[0] ?? '').startsWith('oculus'), result.suspects)

    // --- AI 自动调用门禁 ---
    check('自动 AI 未被放行', result.autoGuard !== 'LEAKED', result.autoGuard)
    check(
      '自动 AI 给出明确拒绝原因',
      typeof result.autoGuard === 'string' && result.autoGuard.includes('自动 AI 分析'),
      result.autoGuard
    )

    // --- 日志回看 ---
    check('日志行读取成功', result.linesOk === true, result.firstLine)

    // --- 启动器联动 ---
    eq('默认关闭启动器联动', result.launcherDefault, 'disabled')
    eq('刷新后解析成功', result.launcherState, 'ok')
    eq('自动识别为 PCL2', result.launcherKind, 'pcl')
    check('解析出游戏目录', result.launcherGameDirOk === true)
    eq('PCL2 内存 GB 转 MB', result.launcherMemory, 6144)
    eq('不覆盖日志中的内存值', result.envMemory, 8192)
    eq('不覆盖日志中的启动器', result.envLauncher, 'HMCL')
    check('未注入启动器说明', result.launcherNote === false)

    // --- 目录直接分析 ---
    check('目录分析成功', result.dirOk === true, result.dirFiles)
    check('目录内文件数', typeof result.dirFiles === 'number' && result.dirFiles >= 2, result.dirFiles)
    eq('目录分析阶段', result.dirStage, 'init')

    fs.rmSync(tmpRoot, { recursive: true, force: true })
    tmpRoot = ''

    if (failures.length > 0) {
      console.log(`\nE2E: FAILED（${failures.length} 项）`)
      app.exit(1)
      return
    }
    console.log('E2E: OK')
    app.exit(0)
  } catch (error) {
    if (tmpRoot) {
      try {
        fs.rmSync(tmpRoot, { recursive: true, force: true })
      } catch {
        // ignore cleanup errors
      }
    }
    console.log('E2E: ERROR', error && error.stack ? error.stack : error)
    app.exit(1)
  }
})
