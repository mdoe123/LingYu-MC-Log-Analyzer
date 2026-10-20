import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { analyzeArchive, analyzeGameDir } from '../src/main/analysis/base'
import { looksLikeGameDir } from '../src/main/analysis/scan'
import { identifyJavaHome, normalizeJavaArch, parseJavaVersion } from '../src/main/java/identify'
import { scanJavaRuntimes } from '../src/main/java/scan'
import { buildEvidencePack } from '../src/main/analysis/ai'
import { applyLauncherDefaults, resolveLauncherProfile } from '../src/main/launcher'
import type { BaseAnalysis, Settings } from '../src/shared/types'

const settings: Settings = {
  provider: 'deepseek',
  baseUrl: '',
  model: 'deepseek-chat',
  apiKey: '',
  temperature: 0.2,
  maxTokens: 2048,
  language: 'zh',
  useRuleEngine: true,
  redact: true,
  maxEvidence: 8,
  autoAi: false,
  maxArchiveMb: 200,
  launcher: { enabled: false, kind: 'auto', exePath: '' }
}

async function main(): Promise<void> {
  const file = resolve('test/fixture.zip')
  const stat = await fs.stat(file)

  const output = await analyzeArchive(file, 'fixture.zip', stat.size, (event) => {
    console.log(`  [${event.stage}] ${event.progress}% ${event.label}${event.detail ? ` — ${event.detail}` : ''}`)
  })

  const base = output.base
  console.log('\n=== 文件 ===')
  for (const item of base.files) {
    console.log(`  ${item.kind.padEnd(8)} ${item.path}  ${item.lines} 行  ${item.encoding}`)
  }

  console.log('\n=== 环境 ===')
  console.log(JSON.stringify(base.environment, null, 2))

  console.log('\n=== 阶段 ===')
  console.log(`${base.stageGuess.stage} / ${base.stageGuess.label} / ${base.stageGuess.confidence}`)
  console.log(base.stageGuess.reason)

  console.log('\n=== 崩溃报告 ===')
  for (const crash of base.crashReports) {
    console.log(`  Description: ${crash.description}`)
    console.log(`  rootCause: ${crash.rootCause}`)
    console.log(`  firstForeignFrame: ${crash.firstForeignFrame}`)
    console.log(`  chain: ${crash.causedByChain.length} 条`)
  }

  console.log('\n=== 规则命中 ===')
  for (const hit of base.findings) {
    console.log(`  [${hit.severity}] ${hit.title} (${hit.evidence.length} 证据)`)
    for (const ev of hit.evidence.slice(0, 2)) {
      console.log(`      ${ev.file}:${ev.line}`)
    }
  }

  console.log('\n=== 嫌疑 ===')
  for (const suspect of base.suspects) {
    console.log(`  ${suspect.score.toString().padStart(3)} ${suspect.name} ${suspect.version ?? ''} — ${suspect.reason}`)
  }

  console.log('\n=== 关键词 ===')
  for (const sig of base.signatures) {
    console.log(`  ${sig.keyword}: ${sig.count}`)
  }

  console.log('\n=== 说明 ===')
  for (const note of base.notes) console.log(`  - ${note}`)

  const pack = buildEvidencePack({ base, sources: output.sources, modJars: output.modJars }, settings)
  console.log(`\n=== 证据包 ${pack.length} 字符 ===`)
  console.log(pack.slice(0, 2200))

  console.log('\n=== 启动器配置联动 ===')
  await runLauncherChecks(base)

  console.log('\n=== 目录直接分析 ===')
  await runDirectoryChecks()

  console.log('\n=== Java 运行时扫描 ===')
  await runJavaChecks()
}

async function runJavaChecks(): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), 'mclog-java-'))
  const failures: string[] = []

  const check = (name: string, condition: boolean, detail?: string): void => {
    if (condition) {
      console.log(`  PASS ${name}`)
      return
    }
    failures.push(name)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }

  const writeJdk = async (
    name: string,
    release: string[],
    withBinary = true
  ): Promise<string> => {
    const home = join(root, name)
    await fs.mkdir(join(home, 'bin'), { recursive: true })
    if (withBinary) {
      await fs.writeFile(join(home, 'bin', process.platform === 'win32' ? 'java.exe' : 'java'), 'stub')
    }
    if (release.length > 0) await fs.writeFile(join(home, 'release'), release.join('\n'))
    return home
  }

  try {
    const jdk17 = await writeJdk('jdk-17.0.8', [
      'JAVA_VERSION="17.0.8"',
      'IMPLEMENTOR="Eclipse Adoptium"',
      'OS_ARCH="x86_64"'
    ])
    const jdk8 = await writeJdk('jdk8', ['JAVA_VERSION="1.8.0_392"', 'OS_ARCH="x86"'])
    const broken = await writeJdk('broken', ['JAVA_VERSION="21"'], false)

    check('版本归一：1.8.0_392 → 8', parseJavaVersion('1.8.0_392')?.major === 8)
    check('版本归一：17.0.8 → 17', parseJavaVersion('17.0.8')?.major === 17)
    check('版本归一：21 → 21', parseJavaVersion('21')?.major === 21)
    check('非法版本返回 null', parseJavaVersion('not-a-version') === null)
    check('架构归一：amd64 → x64', normalizeJavaArch('amd64') === 'x64')
    check('架构归一：aarch64', normalizeJavaArch('aarch64') === 'aarch64')

    const info17 = await identifyJavaHome(jdk17, 'custom')
    check('识别 Java 17', info17.valid && info17.major === 17, info17.error)
    check('读取厂商', info17.vendor === 'Eclipse Adoptium', info17.vendor)
    check('读取架构', info17.arch === 'x64', info17.arch)

    const info8 = await identifyJavaHome(jdk8, 'custom')
    check('识别 Java 8', info8.valid && info8.major === 8, info8.error)
    check('识别 32 位', info8.arch === 'x86', info8.arch)

    const brokenInfo = await identifyJavaHome(broken, 'custom')
    check('缺少可执行文件标记无效', !brokenInfo.valid && Boolean(brokenInfo.error))

    const scan = await scanJavaRuntimes({
      extraRoots: [root],
      includeEnv: false,
      includePath: false,
      includeStandard: false,
      includeRegistry: false
    })
    check('扫描发现 3 个候选', scan.runtimes.length === 3, String(scan.runtimes.length))
    check('其中 2 个有效', scan.runtimes.filter((item) => item.valid).length === 2)
    check('按主版本倒序', scan.runtimes[0].major === 17, String(scan.runtimes[0].major))

    const again = await scanJavaRuntimes({
      extraRoots: [root, root],
      includeEnv: false,
      includePath: false,
      includeStandard: false,
      includeRegistry: false
    })
    check('重复根目录去重', again.runtimes.length === 3, String(again.runtimes.length))

    const fromEnv = await scanJavaRuntimes({
      env: { JAVA_HOME: jdk17 },
      includeEnv: true,
      includePath: false,
      includeStandard: false,
      includeRegistry: false
    })
    check('JAVA_HOME 被采纳', fromEnv.runtimes.some((item) => item.home === jdk17))

    const empty = await scanJavaRuntimes({
      includeEnv: false,
      includePath: false,
      includeStandard: false,
      includeRegistry: false
    })
    check('无候选时给出提示', empty.runtimes.length === 0 && empty.warnings.length > 0)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    throw new Error(`Java 扫描检查失败：${failures.join('；')}`)
  }
}

async function runDirectoryChecks(): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), 'mclog-dir-'))
  const failures: string[] = []

  const check = (name: string, condition: boolean, detail?: string): void => {
    if (condition) {
      console.log(`  PASS ${name}`)
      return
    }
    failures.push(name)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }

  try {
    const game = join(root, 'game')
    await fs.mkdir(join(game, 'logs'), { recursive: true })
    await fs.mkdir(join(game, 'crash-reports'), { recursive: true })
    await fs.mkdir(join(game, 'mods'), { recursive: true })
    await fs.mkdir(join(game, 'versions', '1.20.1'), { recursive: true })
    await fs.mkdir(join(game, 'assets'), { recursive: true })

    await fs.copyFile(resolve('test/fixture-src/logs/latest.log'), join(game, 'logs', 'latest.log'))
    await fs.copyFile(
      resolve('test/fixture-src/crash-reports/crash-2026-10-20_12.04.31-client.txt'),
      join(game, 'crash-reports', 'crash-2026-10-20_12.04.31-client.txt')
    )
    await fs.writeFile(join(game, 'mods', 'embeddium-0.3.31.jar'), 'stub')
    await fs.writeFile(join(game, 'mods', 'embeddium-0.3.25.jar'), 'stub')
    await fs.writeFile(join(game, 'versions', '1.20.1', '1.20.1.json'), '{}')
    await fs.writeFile(join(game, 'assets', 'ignored.log'), 'should be skipped')

    check('目录结构识别', await looksLikeGameDir(game))
    check('普通目录不误判', !(await looksLikeGameDir(root)))

    const output = await analyzeGameDir(game, 'game', () => undefined)
    const result = output.base

    check('分析出日志文件', result.files.length >= 2, String(result.files.length))
    check('识别崩溃报告', result.crashReports.length === 1, String(result.crashReports.length))
    check('命中重复模组', result.findings.some((item) => item.id === 'duplicate-mods'))
    check('命中 Mixin 失败', result.findings.some((item) => item.id === 'mixin'))
    check('读取加载器版本', result.environment.loader === 'Forge 47.3.0', result.environment.loader)
    check('阶段判定为初始化', result.stageGuess.stage === 'init', result.stageGuess.stage)
    check('说明标注目录来源', result.notes.some((note) => note.includes('直接读取游戏目录')))
    check('跳过 assets 目录', !result.files.some((file) => file.path.includes('assets')))

    const empty = join(root, 'empty')
    await fs.mkdir(empty, { recursive: true })
    let rejected = false
    try {
      await analyzeGameDir(empty, 'empty', () => undefined)
    } catch {
      rejected = true
    }
    check('空目录给出错误', rejected)
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    throw new Error(`目录分析检查失败：${failures.join('；')}`)
  }
}

async function runLauncherChecks(base: BaseAnalysis): Promise<void> {
  const root = await fs.mkdtemp(join(tmpdir(), 'mclog-launcher-'))
  const failures: string[] = []

  const check = (name: string, condition: boolean, detail?: string): void => {
    if (condition) {
      console.log(`  PASS ${name}`)
      return
    }
    failures.push(name)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }

  try {
    const disabled = await resolveLauncherProfile({ enabled: false, kind: 'auto', exePath: '' })
    check('关闭时不读取配置', disabled.state === 'disabled')

    const missing = await resolveLauncherProfile({
      enabled: true,
      kind: 'auto',
      exePath: join(root, 'nope.exe')
    })
    check('路径无效时回退', missing.state === 'error' && Boolean(missing.error))

    const pclDir = join(root, 'pcl')
    const pclGame = join(pclDir, 'game')
    await fs.mkdir(join(pclDir, 'PCL'), { recursive: true })
    await fs.mkdir(pclGame, { recursive: true })
    await fs.writeFile(join(pclDir, 'Plain Craft Launcher 2.exe'), 'stub')
    await fs.writeFile(
      join(pclDir, 'PCL', 'Setup.ini'),
      [`LaunchFolderSelect:${pclGame}`, 'LaunchRamType:1', 'LaunchRamCustom:6'].join('\n')
    )

    const pcl = await resolveLauncherProfile({
      enabled: true,
      kind: 'auto',
      exePath: join(pclDir, 'Plain Craft Launcher 2.exe')
    })
    check('PCL2 自动识别', pcl.kind === 'pcl' && pcl.state === 'ok', `${pcl.state}/${pcl.kind}`)
    check('PCL2 读取游戏目录', pcl.gameDir === pclGame, pcl.gameDir)
    check('PCL2 内存 GB 转 MB', pcl.maxMemoryMb === 6144, String(pcl.maxMemoryMb))

    const hmclDir = join(root, 'hmcl')
    const game = join(hmclDir, 'game')
    const instance = '1.20.1-forge'
    await fs.mkdir(join(hmclDir, 'config'), { recursive: true })
    await fs.mkdir(join(game, 'versions', instance, '.hmcl', 'config'), { recursive: true })
    await fs.writeFile(join(hmclDir, 'HMCL-3.17.0.exe'), 'stub')
    await fs.writeFile(
      join(hmclDir, 'config', 'launcher-settings.json'),
      JSON.stringify({ selectedGameDirectory: 'g1', selectedInstance: { g1: instance } })
    )
    await fs.writeFile(
      join(hmclDir, 'config', 'game-directories.json'),
      JSON.stringify({ directories: [{ id: 'g1', path: game }] })
    )
    await fs.writeFile(
      join(game, 'versions', instance, '.hmcl', 'config', 'instance-game-settings.json'),
      JSON.stringify({ maxMemory: 6144, customJavaPath: 'C:/Java/bin/java.exe' })
    )

    const hmcl = await resolveLauncherProfile({
      enabled: true,
      kind: 'auto',
      exePath: join(hmclDir, 'HMCL-3.17.0.exe')
    })
    check('HMCL 自动识别', hmcl.kind === 'hmcl' && hmcl.state === 'ok', `${hmcl.state}/${hmcl.kind}`)
    check('HMCL 解析游戏目录映射', hmcl.gameDir === game, hmcl.gameDir)
    check('HMCL 解析选中实例', hmcl.instance === instance, hmcl.instance)
    check('HMCL 读取实例内存', hmcl.maxMemoryMb === 6144, String(hmcl.maxMemoryMb))
    check('HMCL 读取 Java 路径', hmcl.javaPath === 'C:/Java/bin/java.exe', hmcl.javaPath)

    const blank: BaseAnalysis = {
      ...base,
      environment: { launcher: undefined, memoryMaxMb: undefined },
      notes: []
    }
    applyLauncherDefaults(blank, pcl)
    check(
      '补全日志缺失的环境字段',
      blank.environment.launcher === 'PCL2' && blank.environment.memoryMaxMb === 6144
    )
    check('说明中标注来源', blank.notes.some((note) => note.includes('PCL2')))

    const existing: BaseAnalysis = {
      ...base,
      environment: { launcher: 'HMCL', memoryMaxMb: 2048 },
      notes: []
    }
    applyLauncherDefaults(existing, pcl)
    check(
      '不覆盖日志已有值',
      existing.environment.launcher === 'HMCL' &&
        existing.environment.memoryMaxMb === 2048 &&
        existing.notes.length === 0
    )

    const brokenDir = join(root, 'broken')
    await fs.mkdir(brokenDir, { recursive: true })
    await fs.writeFile(join(brokenDir, 'HMCL.exe'), 'stub')
    await fs.mkdir(join(brokenDir, 'config'), { recursive: true })
    await fs.writeFile(join(brokenDir, 'config', 'launcher-settings.json'), '{ not json')
    const broken = await resolveLauncherProfile({
      enabled: true,
      kind: 'auto',
      exePath: join(brokenDir, 'HMCL.exe')
    })
    check('配置损坏时回退', broken.state === 'error' && Boolean(broken.error))
  } finally {
    await fs.rm(root, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    throw new Error(`启动器配置检查失败：${failures.join('；')}`)
  }
}

main().catch((error) => {
  console.error('FAILED:', error)
  process.exit(1)
})
