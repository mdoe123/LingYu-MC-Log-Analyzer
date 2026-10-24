import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { analyzeArchive, analyzeGameDir } from '../src/main/analysis/base'
import { looksLikeGameDir } from '../src/main/analysis/scan'
import { identifyJavaHome, normalizeJavaArch, parseJavaVersion } from '../src/main/java/identify'
import { scanJavaRuntimes } from '../src/main/java/scan'
import { buildEvidencePack } from '../src/main/analysis/ai'
import { detectLoader } from '../src/main/analysis/loader'
import { parseLine, parseLog } from '../src/main/analysis/parse'
import { parseCrashReport } from '../src/main/analysis/crash'
import { runRules, type LogSource } from '../src/main/analysis/rules'
import { applyLauncherDefaults, resolveLauncherProfile } from '../src/main/launcher'
import type { BaseAnalysis, LogFileKind, ScannedFile, Settings } from '../src/shared/types'

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

  console.log('\n=== 规则引擎开关 ===')
  await runRuleEngineChecks()

  console.log('\n=== 加载器适配（Fabric / Quilt / Forge / NeoForge） ===')
  await runLoaderChecks()

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

const FABRIC_LOG = [
  '[12:00:00] [main/INFO]: Loading Minecraft 1.20.1 with Fabric Loader 0.15.7',
  '[12:00:01] [main/ERROR]: Incompatible mods found!',
  "[12:00:01] [main/ERROR]: \t- Mod 'sodium' (sodium) 0.5.8 requires version 0.92.0 or later of fabric-api, which is missing!",
  '[12:00:01] [main/ERROR]: A potential solution has been determined:',
  '[12:00:01] [main/ERROR]:    - Install fabric-api, version 0.92.0 or later.'
].join('\n')

const QUILT_LOG = [
  '[12:00:00] [main/INFO] (QuiltLoader) Loading Minecraft 1.19.4 with Quilt Loader 0.20.0',
  '[12:00:01] [main/ERROR] (QuiltLoader) Incompatible mod set!',
  "[12:00:01] [main/ERROR] (QuiltLoader) Dependency for mod 'sodium' on quilt_loader"
].join('\n')

const NEOFORGE_LOG = [
  '[12:00:00] [modloading-worker-0/INFO] [ne.ne.fm.lo.ModLoader/]: Found arguments: --fml.mcVersion 1.21.1 --fml.neoForgeVersion 21.1.80',
  '[12:00:01] [main/ERROR] [ne.ne.fm.lo.ModLoadingException/]: Mod loading failures have occurred',
  '[12:00:01] [main/ERROR] [ne.ne.fm.lo.ModLoadingException/]: -- Mod loading issue for: examplemod --',
  '[12:00:01] [main/ERROR] [ne.ne.fm.lo.ModLoadingException/]: oldmod.jar is not a valid mod file'
].join('\n')

const FORGE_LOG = [
  '[12:04:26] [main/INFO] [minecraft/Main]: Launching target \'forgeclient\' with 47 mods',
  '[12:04:27] [main/INFO] [net.minecraftforge.fml.loading.ModSorter/]: Found mod file embeddium-0.3.31.jar'
].join('\n')

const FORGE_CRASH = [
  '---- Minecraft Crash Report ----',
  '// Uh...',
  'Time: 2026-10-20 12:04:31',
  'Description: Mod loading error has occurred',
  'java.lang.RuntimeException: Mod loading has failed',
  'Caused by: java.lang.NoClassDefFoundError: com/example/Lib',
  '-- System Details --',
  'Details:',
  '\tMinecraft Version: 1.20.1',
  '\tJava Version: 17.0.8, Microsoft',
  '\tFML: 47.3.0',
  '\tSuspected Mods: ',
  '\t\tExample Library (examplelib)',
  ''
].join('\n')

const FABRIC_CRASH = [
  '---- Minecraft Crash Report ----',
  'Description: Initializing game',
  "java.lang.RuntimeException: Could not execute entrypoint stage 'main' due to errors, provided by 'examplemod' at 'com.example.ExampleMod'!",
  'at net.fabricmc.loader.impl.game.minecraft.Hooks.startClient(Hooks.java:52)',
  '-- System Details --',
  'Details:',
  '\tMinecraft Version: 1.21.1',
  '\tFabric Mods: ',
  '\t\tfabric-api: Fabric API 0.92.0+1.21.1',
  '\t\texamplemod: Example Mod 1.0.0',
  '\tJava Version: 21.0.1, Microsoft'
].join('\n')

const NEOFORGE_CRASH = [
  '---- Minecraft Crash Report ----',
  'Description: Mod loading failures have occurred',
  'net.neoforged.fml.ModLoadingException: Mod loading has failed',
  '-- Mod loading issue for: examplemod --',
  'Details:',
  '-- System Details --',
  'Details:',
  '\tMinecraft Version: 1.21.1',
  '\tNeoForge: 21.1.80'
].join('\n')

function makeSource(name: string, text: string, kind: LogFileKind = 'latest'): LogSource {
  const log = parseLog(name, text, false)
  const file: ScannedFile = {
    id: name,
    name,
    path: name,
    size: text.length,
    bytesRead: text.length,
    lines: log.lines.length,
    kind,
    encoding: 'utf-8',
    included: true,
    note: '',
    truncated: false
  }
  return { file, log }
}

async function runLoaderChecks(): Promise<void> {
  const failures: string[] = []
  const check = (name: string, condition: boolean, detail?: string): void => {
    if (condition) {
      console.log(`  PASS ${name}`)
      return
    }
    failures.push(name)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }

  // ---- 识别 ----
  const fabric = detectLoader([FABRIC_LOG])
  check('识别 Fabric', fabric.family === 'fabric', String(fabric.family))
  check('读取 Fabric 版本', fabric.version === '0.15.7', String(fabric.version))

  const quilt = detectLoader([QUILT_LOG])
  check('识别 Quilt', quilt.family === 'quilt', String(quilt.family))
  check('读取 Quilt 版本', quilt.version === '0.20.0', String(quilt.version))

  const neo = detectLoader([NEOFORGE_LOG])
  check('识别 NeoForge', neo.family === 'neoforge', String(neo.family))
  check('读取 NeoForge 版本', neo.version === '21.1.80', String(neo.version))

  const forge = detectLoader([FORGE_LOG, FORGE_CRASH])
  check('识别 Forge', forge.family === 'forge', String(forge.family))
  check('从 System Details 读取 Forge 版本', forge.version === '47.3.0', String(forge.version))

  // NeoForge 1.20.1 由 Forge 分叉而来，包名仍是 net.minecraftforge.*；必须靠权重判定为 NeoForge
  const ambiguous = detectLoader([
    NEOFORGE_CRASH,
    'at net.minecraftforge.fml.loading.FMLClientLaunchProvider.launch(FMLClientLaunchProvider.java:37)'
  ])
  check('NeoForge 优先于 Forge 的残留包名', ambiguous.family === 'neoforge', String(ambiguous.family))

  // NeoForge 1.20.1 的坐标用冒号分隔（net.neoforged:forge:…），也要压过残留的 net.minecraftforge.*
  const neoCoordinate = detectLoader([
    '\tForge: net.neoforged:forge:47.1.106',
    'at net.minecraftforge.fml.loading.FMLClientLaunchProvider.launch(FMLClientLaunchProvider.java:37)'
  ])
  check('NeoForge 冒号坐标可识别', neoCoordinate.family === 'neoforge', String(neoCoordinate.family))

  // 只有 Forge 特征时不能被误判为 NeoForge
  const forgeOnly = detectLoader([
    '\tForge: net.minecraftforge:47.2.0',
    'at net.minecraftforge.fml.loading.FMLClientLaunchProvider.launch(FMLClientLaunchProvider.java:37)'
  ])
  check('纯 Forge 特征不被误判为 NeoForge', forgeOnly.family === 'forge', String(forgeOnly.family))

  // Quilt 兼容 Fabric 模组，日志里会同时出现 net.fabricmc.*
  const quiltOverFabric = detectLoader([
    QUILT_LOG,
    'at net.fabricmc.loader.impl.launch.FabricLauncherBase.launch(FabricLauncherBase.java:70)'
  ])
  check('Quilt 优先于 Fabric 的兼容痕迹', quiltOverFabric.family === 'quilt', String(quiltOverFabric.family))

  check('无特征时返回 unknown', detectLoader(['[12:00:00] [main/INFO]: Done']).family === 'unknown')

  // ---- 行前缀 ----
  const forgeLine = parseLine(
    '[12:04:27] [main/INFO] [net.minecraftforge.fml.loading.ModSorter/]: Found mod file a.jar'
  )
  check('Forge 前缀：级别', forgeLine.level === 'INFO', forgeLine.level)
  check(
    'Forge 前缀：logger 去掉结尾斜杠',
    forgeLine.logger === 'net.minecraftforge.fml.loading.ModSorter',
    forgeLine.logger
  )
  check('Forge 前缀：消息', forgeLine.message === 'Found mod file a.jar', forgeLine.message)

  const vanillaLine = parseLine('[12:00:00] [main/INFO]: Loading Minecraft 1.20.1 with Fabric Loader 0.15.7')
  check('原版 / Fabric 前缀：级别', vanillaLine.level === 'INFO', vanillaLine.level)
  check(
    '原版 / Fabric 前缀：消息不带前缀',
    vanillaLine.message.startsWith('Loading Minecraft'),
    vanillaLine.message
  )

  const quiltLine = parseLine('[12:00:00] [main/INFO] (QuiltLoader) Loading Minecraft 1.19.4')
  check('Quilt 括号前缀：logger', quiltLine.logger === 'QuiltLoader', quiltLine.logger)
  check('Quilt 括号前缀：消息', quiltLine.message === 'Loading Minecraft 1.19.4', quiltLine.message)

  const bareLine = parseLine('[main/INFO] [FML]: Done (1.2s)!')
  check('无时间戳前缀：级别', bareLine.level === 'INFO', bareLine.level)
  check('无时间戳前缀：logger', bareLine.logger === 'FML', bareLine.logger)
  check('无时间戳前缀：消息', bareLine.message === 'Done (1.2s)!', bareLine.message)

  const warnLine = parseLine('[12:00:00] [Render thread/WARN]: Missing sound')
  check('WARNING 归一为 WARN', parseLine('[12:00:00] [main/WARNING]: x').level === 'WARN')
  check('多级前缀不被误切', warnLine.level === 'WARN' && warnLine.thread === 'Render thread', warnLine.thread)

  // ---- 规则（按加载器开关）----
  const ruleOf = (text: string, family: 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'unknown') =>
    runRules({
      sources: [makeSource('latest.log', text)],
      crashReports: [],
      hasHsErr: false,
      modJars: [],
      loader: { family }
    })

  check('Fabric 触发不兼容规则', ruleOf(FABRIC_LOG, 'fabric').findings.some((f) => f.id === 'fabric-quilt-incompatible'))
  check(
    'Fabric 同时触发缺前置规则',
    ruleOf(FABRIC_LOG, 'fabric').findings.some((f) => f.id === 'missing-dep')
  )
  check(
    'Quilt 触发不兼容规则',
    ruleOf(QUILT_LOG, 'quilt').findings.some((f) => f.id === 'fabric-quilt-incompatible')
  )
  check(
    '加载器为 Forge 时不套用 Fabric/Quilt 规则',
    !ruleOf(FABRIC_LOG, 'forge').findings.some((f) => f.id === 'fabric-quilt-incompatible')
  )
  check(
    '加载器未识别时不设门槛（规则仍生效）',
    ruleOf(FABRIC_LOG, 'unknown').findings.some((f) => f.id === 'fabric-quilt-incompatible')
  )
  check(
    'NeoForge 触发加载中止规则',
    ruleOf(NEOFORGE_LOG, 'neoforge').findings.some((f) => f.id === 'forge-neoforge-mod-loading')
  )
  check(
    'NeoForge 触发构建不匹配规则',
    ruleOf(NEOFORGE_LOG, 'neoforge').findings.some((f) => f.id === 'loader-wrong-build')
  )
  check(
    'NeoForge 规则不对 Fabric 生效',
    !ruleOf(NEOFORGE_LOG, 'fabric').findings.some((f) => f.id === 'forge-neoforge-mod-loading')
  )

  // ---- 崩溃报告区块 ----
  const forgeCrash = parseCrashReport('crash-forge.txt', FORGE_CRASH)
  check(
    'Forge：解析 Suspected Mods',
    Boolean(forgeCrash.suspectedMods?.includes('examplelib')),
    JSON.stringify(forgeCrash.suspectedMods)
  )
  check('Forge：读取 Mod 数量缺省时不臆造', forgeCrash.modCount === undefined, String(forgeCrash.modCount))

  const fabricCrash = parseCrashReport('crash-fabric.txt', FABRIC_CRASH)
  check(
    'Fabric：解析 Fabric Mods 清单',
    fabricCrash.loaderMods?.length === 2,
    JSON.stringify(fabricCrash.loaderMods)
  )
  check('Fabric：modid 与名称、版本分离', fabricCrash.loaderMods?.[0]?.id === 'fabric-api')
  check('Fabric：Mod 数量由清单推导', fabricCrash.modCount === 2, String(fabricCrash.modCount))
  check(
    'Fabric：解析 provided by 点名',
    Boolean(fabricCrash.failedMods?.includes('examplemod')),
    JSON.stringify(fabricCrash.failedMods)
  )

  const neoCrash = parseCrashReport('crash-neo.txt', NEOFORGE_CRASH)
  check(
    'NeoForge：解析 Mod loading issue 区块',
    Boolean(neoCrash.suspectedMods?.includes('examplemod')),
    JSON.stringify(neoCrash.suspectedMods)
  )
  check(
    'NeoForge：不产生 Fabric Mods 清单',
    neoCrash.loaderMods === undefined && neoCrash.modCount === undefined
  )

  // ---- 嫌疑评分：加载器点名优先于堆栈推断 ----
  const suspectRules = runRules({
    sources: [makeSource('latest.log', FABRIC_LOG)],
    crashReports: [forgeCrash],
    hasHsErr: false,
    modJars: ['embeddium-0.3.31.jar'],
    loader: { family: 'forge' }
  })
  check(
    '加载器点名的模组排在首位',
    suspectRules.suspects[0]?.name === 'examplelib',
    JSON.stringify(suspectRules.suspects.slice(0, 2))
  )
  check('加载器点名分值 76', suspectRules.suspects[0]?.score === 76, String(suspectRules.suspects[0]?.score))

  const quiltSuspects = runRules({
    sources: [makeSource('latest.log', QUILT_LOG)],
    crashReports: [],
    hasHsErr: false,
    modJars: [],
    loader: { family: 'quilt' }
  })
  check(
    'Quilt 依赖缺失项进入嫌疑表',
    quiltSuspects.suspects.some((item) => item.name === 'quilt_loader'),
    JSON.stringify(quiltSuspects.suspects.map((item) => item.name))
  )

  if (failures.length > 0) {
    throw new Error(`加载器适配检查失败：${failures.join('；')}`)
  }
}

async function runRuleEngineChecks(): Promise<void> {
  const failures: string[] = []
  const check = (name: string, condition: boolean, detail?: string): void => {
    if (condition) {
      console.log(`  PASS ${name}`)
      return
    }
    failures.push(name)
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`)
  }

  const file = resolve('test/fixture.zip')
  const stat = await fs.stat(file)
  const silent = (): undefined => undefined

  const on = await analyzeArchive(file, 'fixture.zip', stat.size, silent, { useRuleEngine: true })
  const off = await analyzeArchive(file, 'fixture.zip', stat.size, silent, { useRuleEngine: false })

  check('默认（不传 options）等同开启', on.base.findings.length > 0, String(on.base.findings.length))
  check('开启时有命中', on.base.findings.some((item) => item.id === 'mixin'))
  check('开启时有嫌疑', on.base.suspects.length > 0)
  check('开启时有关键词统计', on.base.signatures.length > 0)

  check('关闭后无命中', off.base.findings.length === 0, String(off.base.findings.length))
  check('关闭后无嫌疑', off.base.suspects.length === 0, String(off.base.suspects.length))
  check('关闭后无关键词统计', off.base.signatures.length === 0, String(off.base.signatures.length))
  check('关闭后在说明中告知', off.base.notes.some((note) => note.includes('规则引擎')))
  check(
    '关闭后仍保留文件与环境',
    off.base.files.length === on.base.files.length && off.base.environment.loader === on.base.environment.loader
  )
  check('关闭后阶段判定不受影响', off.base.stageGuess.stage === on.base.stageGuess.stage)

  const dirOff = await analyzeGameDir(resolve('test/fixture-build'), 'fixture-build', silent, {
    useRuleEngine: false
  })
  check('目录模式同样受开关控制', dirOff.base.findings.length === 0, String(dirOff.base.findings.length))

  if (failures.length > 0) {
    throw new Error(`规则引擎开关检查失败：${failures.join('；')}`)
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
