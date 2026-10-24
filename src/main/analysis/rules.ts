import type {
  CrashSummary,
  Environment,
  EvidenceItem,
  LoaderFamily,
  LoaderMod,
  RuleFix,
  RuleHit,
  ScannedFile,
  Severity,
  SignatureCount,
  StageGuess,
  Suspect
} from '../../shared/types'
import { describeLoader, type LoaderProfile } from './loader'
import { blockAt, lineNumberOf, type ParsedLog } from './parse'

export interface LogSource {
  file: ScannedFile
  log: ParsedLog
}

interface RuleDef {
  id: string
  severity: Severity
  pattern: RegExp
  title: string
  detail: string
  fixes: RuleFix[]
  /**
   * 限定规则只在特定加载器下生效。未声明表示通用规则。
   * 加载器无法判定（`unknown`）时不启用门槛，避免因识别失败而漏报。
   */
  loaders?: LoaderFamily[]
}

const RULES: RuleDef[] = [
  {
    id: 'oom',
    severity: 'critical',
    pattern: /OutOfMemoryError/i,
    title: '堆内存耗尽（OutOfMemoryError）',
    detail:
      '游戏在分配对象时耗尽 JVM 堆内存。整合包模组数量多、渲染距离过高，或某个模组存在内存泄漏时最常见，与模组兼容性无关。',
    fixes: [
      {
        level: 'immediate',
        title: '提高最大内存并确认 64 位 Java',
        detail:
          '在启动器里把最大内存调到当前值的 1.5–2 倍（大型整合包建议 6–8 GB）。同时确认安装的是 64 位 Java，32 位版本最大只能用到约 1.5 GB。'
      },
      {
        level: 'try',
        title: '降低渲染距离与模拟距离',
        detail: '渲染距离降到 12 以内、模拟距离降到 8 以内，并关闭光影，可显著压低内存峰值。'
      },
      {
        level: 'diagnose',
        title: '用 spark 观察堆占用曲线',
        detail:
          '执行 /spark profiler 或 /spark heapsummary，若 GC 后堆占用仍持续上升且不回落，通常指向具体模组的内存泄漏，可结合模组列表逐个排除。'
      }
    ]
  },
  {
    id: 'classdef',
    severity: 'high',
    pattern: /NoClassDefFoundError|ClassNotFoundException/,
    title: '缺少类定义',
    detail:
      'JVM 找不到运行期需要的类。多数情况是前置模组缺失或版本不匹配；也可能是 jar 下载损坏，或 Java 版本过低导致运行库不存在。',
    fixes: [
      {
        level: 'immediate',
        title: '补齐堆栈中出现的包所属前置',
        detail:
          '按堆栈里的包名反查所属模组，安装与当前游戏版本一致的对应版本（常见前置：Cloth Config、Architectury API、Forge / NeoForge API）。'
      },
      {
        level: 'try',
        title: '核对 Java 版本',
        detail: '1.17–1.20.4 需要 Java 17，1.20.5 及以上需要 Java 21。版本不符常以缺类形式暴露。'
      },
      {
        level: 'diagnose',
        title: '重新下载报错模组的 jar',
        detail: '下载中断产生的残缺 jar 同样会表现为缺类，删掉后重新下载可排除。'
      }
    ]
  },
  {
    id: 'nosuchmethod',
    severity: 'high',
    pattern: /NoSuchMethodError|NoSuchFieldError/,
    title: '方法或字段签名不匹配',
    detail:
      '编译期存在的成员在运行期找不到对应签名，几乎总是版本错配：模组对游戏本体，或两个模组之间对同一 API 的版本不一致。',
    fixes: [
      {
        level: 'immediate',
        title: '把相关模组对齐到同一发布周期',
        detail:
          '让报错模组与它依赖的模组使用同期发布的版本。跨大版本混用（例如 0.3.x 与 0.5.x）极易触发该错误。'
      },
      {
        level: 'try',
        title: '移除同功能的重复模组',
        detail: '渲染、优化、配方查看类模组同时装两个时，其中一个会改写另一个依赖的方法签名。'
      },
      {
        level: 'diagnose',
        title: '二分法缩小范围',
        detail: '一次禁用一半模组并启动：能进游戏则问题在被禁用的一半，否则在保留的一半，逐次减半即可锁定。'
      }
    ]
  },
  {
    id: 'mixin',
    severity: 'critical',
    pattern: /Mixin apply failed|InvalidInjectionException|Mixin transformation of/i,
    title: 'Mixin 注入失败',
    detail:
      '模组试图在目标方法上注入代码，但目标方法的签名或结构已被其它模组改动，注入点解析失败，渲染或初始化流程被中止。',
    fixes: [
      {
        level: 'immediate',
        title: '更新或回退冲突模组',
        detail:
          '优先调整最近更新过的那个模组——它适配新版本游戏时最脆弱。同类优化模组（OptiFine / Embeddium / Sodium 系）不要共存。'
      },
      {
        level: 'try',
        title: '只保留一个同类优化模组',
        detail: '同时安装两个渲染优化模组时，两者都会改写同一批渲染方法，冲突概率极高。'
      },
      {
        level: 'diagnose',
        title: '二分定位并保留当次日志',
        detail: '每次只改一项，保留当次 latest.log，对比 ERROR 首次出现的位置，可快速收敛到具体模组。'
      }
    ]
  },
  {
    id: 'missing-dep',
    severity: 'high',
    // 覆盖四种加载器的原文措辞：
    //   Forge / NeoForge: Missing or unsupported mandatory dependencies
    //   Fabric:           ... requires ... which is missing! / requires ... of mod ...
    //   Quilt:            Dependency for mod '<id>' on quilt_loader|quilted_fabric_api|...
    pattern:
      /Missing or unsupported mandatory dependencies|which is missing|requires .* (?:of|from) (?:mod|modid)|Dependency for mod '[^']+' on /i,
    title: '缺少必需的前置模组',
    detail: '加载器在解析依赖时发现某个模组声明的前置不存在，或版本超出声明区间。这类失败发生在加载早期，与游戏内表现无关。',
    fixes: [
      {
        level: 'immediate',
        title: '安装日志点名的前置',
        detail: '日志中通常会直接写出缺失的 modid，按它搜索并安装与当前游戏版本、加载器一致的版本。'
      },
      {
        level: 'try',
        title: '核对前置版本区间',
        detail: '前置装错版本同样会被判定为缺失。注意模组说明里要求的最低版本号。'
      }
    ]
  },
  {
    id: 'modload',
    severity: 'critical',
    pattern: /Failed to load mod|ModLoadingException|ModResolutionException|LoadingFailedException/,
    title: '模组加载阶段失败',
    detail: '加载器在构建模组容器时抛错，游戏尚未进入渲染阶段。真实原因在异常链最后一条 Caused by 里。',
    fixes: [
      {
        level: 'immediate',
        title: '读紧随其后的 Caused by',
        detail: '最顶层的异常通常是加载器包装过的，向下找到最后一条 Caused by，那里才是真正的失败点。'
      },
      {
        level: 'try',
        title: '确认模组与游戏版本匹配',
        detail: '1.20.1 的模组不能用于 1.21；同版本不同加载器（Forge / Fabric / NeoForge）的 jar 也不通用。'
      }
    ]
  },
  {
    id: 'tick',
    severity: 'high',
    pattern: /Ticking entity|Ticking block entity|Ticking screen/,
    title: '运行期实体或方块更新崩溃',
    detail:
      '世界已加载，某个实体或方块实体在 tick 时抛异常。通常是存档内对象的状态与该模组的预期结构不一致，属于运行期问题而非启动问题。',
    fixes: [
      {
        level: 'immediate',
        title: '定位并移除问题实体',
        detail: '用 NBTExplorer 打开存档，按崩溃日志中的坐标删除对应实体或方块实体；也可用区块修复工具处理。'
      },
      {
        level: 'try',
        title: '回退到崩溃前的存档备份',
        detail: '若无法精确定位，回退备份通常比逐个排查模组更快。'
      },
      {
        level: 'diagnose',
        title: '确认该坐标是否为某模组新增内容',
        detail: '若问题位置是某模组新增的方块或生物，优先检查该模组的版本与已知 issue。'
      }
    ]
  },
  {
    id: 'servertick',
    severity: 'critical',
    pattern: /Exception in server tick loop/,
    title: '服务端 tick 循环异常',
    detail: '服务端主循环抛出未捕获异常，世界会被强制关闭。常见于实体 AI、区块加载或异步任务回调。',
    fixes: [
      {
        level: 'immediate',
        title: '查看同一时刻的第一个异常',
        detail: 'tick 循环异常往往是被更早的异常连带抛出的，向上查找时间戳相同的第一条 ERROR 更接近根因。'
      },
      {
        level: 'try',
        title: '禁用最近新增的玩法类模组',
        detail: '生物、结构、任务类模组在 tick 阶段的改动最多，优先排查这类新增内容。'
      }
    ]
  },
  {
    id: 'port',
    severity: 'medium',
    pattern: /Failed to bind to port|Address already in use/,
    title: '端口被占用，服务端无法启动',
    detail: '另一个进程已监听该端口，或上次的服务端进程没有完全退出。',
    fixes: [
      {
        level: 'immediate',
        title: '结束占用进程或换端口',
        detail: '用 netstat -ano | findstr :25565 找到占用进程并结束，或在 server.properties 中修改 server-port。'
      }
    ]
  },
  {
    id: 'javaversion',
    severity: 'high',
    pattern: /UnsupportedClassVersionError|class file version \d+/,
    title: 'Java 版本不匹配',
    detail: '模组或游戏本体以更高版本的 Java 编译，当前运行环境无法加载其字节码。',
    fixes: [
      {
        level: 'immediate',
        title: '切换启动器中的 Java',
        detail: '1.20.5 及以上需要 Java 21，1.17–1.20.4 需要 Java 17。在启动器的 Java 设置中指定对应版本。'
      }
    ]
  },
  {
    id: 'gl',
    severity: 'medium',
    pattern: /GLFW error|Failed to create window|Pixel format not accelerated|Failed to initialize GLFW|OpenGL/,
    title: '图形上下文初始化失败',
    detail: '创建窗口或 OpenGL 上下文失败，多与显卡驱动、核显/独显切换或远程桌面环境有关。',
    fixes: [
      {
        level: 'immediate',
        title: '更新显卡驱动',
        detail: '从显卡厂商官网安装最新驱动，而非依赖系统自动更新。'
      },
      {
        level: 'try',
        title: '强制使用独立显卡',
        detail: '在系统显卡设置中把 Java 进程指定为高性能模式；远程桌面下建议改用本地会话。'
      }
    ]
  },
  {
    id: 'registry',
    severity: 'high',
    pattern: /Registry remapping failed|Missing registry entries|Unknown registry/,
    title: '注册表重映射失败',
    detail: '存档或世界数据引用了当前环境中不存在的注册项，通常是在同一个存档上增删了模组。',
    fixes: [
      {
        level: 'immediate',
        title: '把模组集合恢复到创建存档时的状态',
        detail: '注册表问题几乎都来自中途增删模组。恢复原来的模组组合后再进存档验证。'
      },
      {
        level: 'diagnose',
        title: '用新存档确认是否与存档绑定',
        detail: '新建世界不报错即可确认是存档数据问题，而非模组本身无法加载。'
      }
    ]
  },
  {
    id: 'shader',
    severity: 'medium',
    pattern: /Failed to compile shader|shader compilation failed|Could not compile program/i,
    title: '着色器编译失败',
    detail: '光影包或渲染模组的 GLSL 程序编译失败，多与光影包版本、显卡驱动或渲染模组冲突有关。',
    fixes: [
      {
        level: 'try',
        title: '更换或关闭光影包',
        detail: '先关闭光影确认能启动，再换用与当前渲染模组匹配的光影版本。'
      }
    ]
  },
  {
    id: 'datapack',
    severity: 'low',
    pattern: /Failed to load datapack|Couldn't load .* as it is not a valid/,
    title: '数据包加载异常',
    detail: '数据包格式不合法或引用了未安装模组的命名空间。通常只影响部分配方与进度，不直接导致崩溃。',
    fixes: [
      {
        level: 'try',
        title: '移除最近添加的数据包',
        detail: '把 datapacks 目录中新增的包移出后重启，观察该警告是否消失。'
      }
    ]
  },
  {
    id: 'fabric-quilt-incompatible',
    severity: 'critical',
    // Fabric Loader: Incompatible mods found!  /  Quilt Loader: Incompatible mod set!
    pattern: /Incompatible mods found!|Incompatible mod set!|Some of your mods are incompatible/,
    title: '模组集合不兼容，加载器拒绝启动',
    detail:
      'Fabric / Quilt 在游戏主类启动前完成依赖解析，一旦发现缺失或冲突就直接中止，不会生成 crash-report，因此 latest.log 是唯一证据。日志中逐条列出的 requires 行指名了缺失项，紧跟在 A potential solution has been determined（或中文「确定了一种可能的解决方法」）之后的段落是加载器自己给出的处理建议。',
    fixes: [
      {
        level: 'immediate',
        title: '逐条补齐 requires 行点名的模组',
        detail:
          '形如 "mod X requires fabric-api 0.92.0 or later" 的行，表示 X 需要该前置的指定版本或更高。只安装同 Minecraft 版本、同加载器的构建。'
      },
      {
        level: 'try',
        title: '阅读加载器给出的建议段落',
        detail:
          'A potential solution has been determined: 之后的每条 "- " 建议都由加载器生成，通常直接说明是缺前置、版本不符还是 Java 版本不够。'
      },
      {
        level: 'diagnose',
        title: '确认没有混入其它加载器的 jar',
        detail:
          'Fabric 只能加载 fabric.mod.json 的模组，Forge / NeoForge 的 jar 放进来不会被识别，反而会让依赖解析出现「缺少某模组」的假象。'
      }
    ],
    loaders: ['fabric', 'quilt']
  },
  {
    id: 'forge-neoforge-mod-loading',
    severity: 'critical',
    // Forge: Mod loading error has occurred  /  NeoForge: Mod loading failures have occurred
    pattern:
      /Mod loading error has occurred|Mod loading failures have occurred|An exception was thrown, the game will display an error screen and halt|net\.neoforged\.fml\.ModLoadingException|FatalStartupException/,
    title: '模组加载阶段被加载器中止',
    detail:
      'Forge / NeoForge 在构建模组容器时捕获到致命异常并中止启动，游戏窗口根本不会出现。这条只是加载器的总括说明，真正原因在紧随其后的 Caused by 链末端；NeoForge 还会为每个出问题的模组单独输出 -- Mod loading issue for: <modid> -- 区块。',
    fixes: [
      {
        level: 'immediate',
        title: '从最后一条 Caused by 读起',
        detail:
          '加载器会把原始异常层层包装，「Mod loading has failed」只是最外层。向下找到最后一条 Caused by，那才是第一个真正出错的位置。'
      },
      {
        level: 'try',
        title: '核对报错模组的加载器归属',
        detail:
          'Forge 与 NeoForge 自 1.20.1 之后已经分家，jar 不通用。模组页面标注的是哪个加载器，就必须装哪个版本。'
      },
      {
        level: 'diagnose',
        title: '查看崩溃报告的 Mod List 状态列',
        detail:
          'Forge 崩溃报告的 Mod List 为每个模组标注状态码，出现 ERRORED 的那一项就是加载失败的模组。'
      }
    ],
    loaders: ['forge', 'neoforge']
  },
  {
    id: 'loader-wrong-build',
    severity: 'high',
    // NeoForge 的拒收提示；Forge / NeoForge 共有的构造函数失败
    pattern:
      /is not a valid mod file|is for Minecraft Forge or an older version of NeoForge|Failed to create mod instance/,
    title: '模组构建与当前加载器不匹配',
    detail:
      '加载器在读取模组元数据或执行模组构造函数时失败。is for Minecraft Forge or an older version of NeoForge 说明这个 jar 是 Forge 构建，被放进了 NeoForge；Failed to create mod instance 则是模组构造函数抛错，多见于版本错配或缺少前置。',
    fixes: [
      {
        level: 'immediate',
        title: '换成与加载器一致的构建',
        detail:
          '同一个模组在 Forge 与 NeoForge 上是两份不同的 jar：Forge 用 mods.toml，NeoForge 用 neoforge.mods.toml。按日志点名的文件名替换。'
      },
      {
        level: 'try',
        title: '单独测试该模组',
        detail:
          '把它从 mods 目录移出后启动：能进游戏即确认问题在它，再去找匹配当前加载器版本号的构建。'
      }
    ],
    loaders: ['forge', 'neoforge']
  },
  {
    id: 'fabric-entrypoint',
    severity: 'critical',
    // Fabric: Could not execute entrypoint stage 'main' due to errors, provided by '<mod>' at '<class>'!
    pattern: /Could not execute entrypoint stage|EntrypointNotFoundException|Failed to execute entrypoint/,
    title: '模组入口点执行失败',
    detail:
      'Fabric / Quilt 在调用模组注册的入口点（通常是 onInitialize）时抛出异常。provided by 之后的名字就是出错的模组 id，但真正的异常仍在 Caused by 链里——入口点失败往往只是被波及的表层。',
    fixes: [
      {
        level: 'immediate',
        title: '读取 provided by 后的模组名',
        detail:
          '该模组在初始化阶段就失败了。先确认它的前置是否齐全，再考虑更新或回退它本身。'
      },
      {
        level: 'try',
        title: '确认它不是被 Mixin 失败连带拖垮',
        detail:
          '若同一段日志里先出现 Mixin apply failed，把 Mixin 冲突处理完之后这个入口点错误通常会自行消失。'
      }
    ],
    loaders: ['fabric', 'quilt']
  }
]

function normalizeEvidenceLevel(level: string | undefined): EvidenceItem['level'] {
  if (level === 'FATAL' || level === 'WARN') return level
  return 'ERROR'
}

function buildEvidence(source: LogSource, index: number): EvidenceItem {
  const block = blockAt(source.log, index)
  const level = normalizeEvidenceLevel(source.log.meta[index]?.level)

  if (block && block.lines.length > 1) {
    return {
      id: `${source.file.id}-${block.startLine}`,
      file: source.file.path,
      line: block.startLine,
      level,
      body: block.lines.slice(0, 14).join('\n')
    }
  }

  const start = Math.max(0, index - 2)
  const end = Math.min(source.log.lines.length, index + 6)
  return {
    id: `${source.file.id}-${lineNumberOf(source.log, start)}`,
    file: source.file.path,
    line: lineNumberOf(source.log, start),
    level,
    body: source.log.lines.slice(start, end).join('\n')
  }
}

function candidateIndices(log: ParsedLog): number[] {
  const out: number[] = []
  for (let i = 0; i < log.lines.length; i += 1) {
    const meta = log.meta[i]
    if (meta && (meta.level === 'ERROR' || meta.level === 'FATAL' || meta.level === 'WARN')) {
      out.push(i)
      continue
    }
    if (/Exception|Error|Caused by|Mixin|Missing|Duplicate|OutOfMemory/.test(log.lines[i])) out.push(i)
  }
  return out
}

export function parseJarName(jar: string): { name: string; version?: string } {
  const base = jar.replace(/\.jar$/i, '')
  const parts = base.split('-')
  const index = parts.findIndex((part, i) => i > 0 && /^v?\d/.test(part))
  if (index === -1) return { name: base.toLowerCase() }

  const rawName = parts.slice(0, index).join('-').toLowerCase()
  return {
    name: rawName.replace(/-(forge|fabric|neoforge|quilt|common)$/i, ''),
    version: parts.slice(index).join('-')
  }
}

interface SuspectSeed {
  name: string
  version?: string
  reason: string
  score: number
  kind: Suspect['kind']
}

export function buildSuspects(input: {
  sources: LogSource[]
  crashReports: CrashSummary[]
  modJars: string[]
}): { suspects: Suspect[]; duplicates: string[][] } {
  const mods = input.modJars.map((jar) => ({ jar, ...parseJarName(jar) }))
  const seeds: SuspectSeed[] = []

  // 崩溃报告里的模组清单（Fabric / Quilt 的 `Fabric Mods:`）用于把 modid 还原成
  // 显示名与版本；加载器自己点名的模组优先于堆栈推断。
  const loadedMods = new Map<string, LoaderMod>()
  for (const crash of input.crashReports) {
    for (const mod of crash.loaderMods ?? []) {
      if (!loadedMods.has(mod.id)) loadedMods.set(mod.id, mod)
    }
  }

  for (const crash of input.crashReports) {
    for (const name of crash.suspectedMods ?? []) {
      const known = loadedMods.get(name)
      seeds.push({
        name: known?.id ?? name,
        version: known?.version,
        reason: '崩溃报告点名该模组（加载器自身判定）',
        score: 76,
        kind: 'mod'
      })
    }
    for (const name of crash.failedMods ?? []) {
      const known = loadedMods.get(name)
      seeds.push({
        name: known?.id ?? name,
        version: known?.version,
        reason: '加载器声明该模组加载失败',
        score: 68,
        kind: 'mod'
      })
    }
  }

  for (const source of input.sources) {
    for (let i = 0; i < source.log.lines.length; i += 1) {
      const line = source.log.lines[i]
      const mixin = /Mixin apply for mod ([\w-]+) failed/i.exec(line)
      if (mixin) {
        seeds.push({
          name: mixin[1].toLowerCase(),
          reason: 'Mixin 注入失败日志直接点名',
          score: 72,
          kind: 'mod'
        })
      }
    }
  }

  for (const crash of input.crashReports) {
    const frame = crash.firstForeignFrame
    if (!frame) continue
    const segments = frame.split('.')
    const root = segments[0]?.toLowerCase()
    const matched = mods.find((mod) => root && (mod.name === root || mod.name.includes(root) || root.includes(mod.name)))
    if (matched) {
      seeds.push({
        name: matched.name,
        version: matched.version,
        reason: '崩溃堆栈首个非原版帧指向该模组',
        score: 64,
        kind: 'mod'
      })
    } else if (root) {
      seeds.push({
        name: segments.slice(0, 2).join('.'),
        reason: '崩溃堆栈首个非原版帧出现在该包名下',
        score: 46,
        kind: 'unknown'
      })
    }
  }

  // Quilt 的措辞：Dependency for mod 'X' on quilt_loader 0.x —— X 是缺前置的模组，
  // `on` 之后才是缺失项，两者都要进嫌疑表但分数不同。
  const quiltDepRe = /Dependency for mod '([^']+)' on ([\w-]{3,})/gi

  const dependencyRe = /(?:requires|missing|需|需要)\s+([\w-]{3,})/gi
  for (const source of input.sources) {
    for (const index of candidateIndices(source.log)) {
      const line = source.log.lines[index]
      if (!/missing|requires|依赖|dependency/i.test(line)) continue

      quiltDepRe.lastIndex = 0
      let quiltMatch: RegExpExecArray | null
      while ((quiltMatch = quiltDepRe.exec(line)) !== null) {
        const owner = quiltMatch[1].toLowerCase()
        const missing = quiltMatch[2].toLowerCase()
        if (owner !== missing) {
          seeds.push({ name: owner, reason: '该模组声明的 Quilt 前置未满足', score: 30, kind: 'mod' })
        }
        seeds.push({ name: missing, reason: '日志声明缺少该前置（Quilt 依赖解析）', score: 55, kind: 'mod' })
      }

      dependencyRe.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = dependencyRe.exec(line)) !== null) {
        const name = match[1].toLowerCase()
        if (['mod', 'modid', 'the', 'this', 'that', 'version'].includes(name)) continue
        seeds.push({
          name,
          reason: '日志声明缺少该前置',
          score: 55,
          kind: 'mod'
        })
      }
    }
  }

  const groups = new Map<string, { version?: string }[]>()
  for (const mod of mods) {
    const list = groups.get(mod.name) ?? []
    list.push({ version: mod.version })
    groups.set(mod.name, list)
  }
  const duplicates: string[][] = []
  for (const [name, list] of groups) {
    if (list.length > 1) {
      duplicates.push([name, ...list.map((item) => item.version ?? '')].filter(Boolean) as string[])
      seeds.push({ name, reason: '同一模组存在多个版本', score: 50, kind: 'mod' })
    }
  }

  const latest = input.sources.find((item) => item.file.kind === 'latest')
  if (latest) {
    let lastName: string | undefined
    for (let i = 0; i < latest.log.lines.length; i += 1) {
      const match = /Found mod file ([\w.+-]+\.jar)/.exec(latest.log.lines[i])
      if (match) lastName = parseJarName(match[1]).name
    }
    if (lastName) {
      seeds.push({
        name: lastName,
        reason: '崩溃前最后加载的模组（弱信号）',
        score: 12,
        kind: 'mod'
      })
    }
  }

  const merged = new Map<string, Suspect>()
  for (const seed of seeds) {
    const key = seed.name.toLowerCase()
    const existing = merged.get(key)
    if (existing) {
      existing.score = Math.max(existing.score, seed.score)
      if (!existing.version && seed.version) existing.version = seed.version
      if (!existing.reason.includes(seed.reason)) existing.reason = `${existing.reason}；${seed.reason}`
    } else {
      merged.set(key, {
        name: seed.name,
        version: seed.version,
        reason: seed.reason,
        score: seed.score,
        kind: seed.kind
      })
    }
  }

  const suspects = [...merged.values()].sort((a, b) => b.score - a.score).slice(0, 8)
  return { suspects, duplicates }
}

/**
 * 规则引擎总入口。`useRuleEngine` 为 false 时整体短路：不跑 18 条静态签名、
 * 不跑 hs_err / duplicate-mods 动态检查、不做嫌疑评分与关键词统计。
 * 传入 `loader` 后会按加载器家族开关带 `loaders` 声明的规则。
 * 此时调用方负责在 notes 中说明，避免用户误以为“没有命中”等于“没有问题”。
 */
export function runRules(input: {
  sources: LogSource[]
  crashReports: CrashSummary[]
  hasHsErr: boolean
  modJars: string[]
  useRuleEngine?: boolean
  loader?: LoaderProfile
}): { findings: RuleHit[]; suspects: Suspect[]; signatures: SignatureCount[] } {
  if (input.useRuleEngine === false) {
    return { findings: [], suspects: [], signatures: [] }
  }

  const family = input.loader?.family ?? 'unknown'
  const candidates = input.sources.map((source) => ({ source, indices: candidateIndices(source.log) }))
  const findings: RuleHit[] = []

  for (const rule of RULES) {
    // 加载器已知时按家族过滤；未知时不做门槛，避免识别失败导致整类规则静默失效。
    if (rule.loaders && family !== 'unknown' && !rule.loaders.includes(family)) continue

    const evidence: EvidenceItem[] = []
    for (const { source, indices } of candidates) {
      for (const index of indices) {
        if (!rule.pattern.test(source.log.lines[index])) continue
        const anchor = blockAt(source.log, index)?.startLine ?? lineNumberOf(source.log, index)
        if (evidence.some((item) => item.file === source.file.path && Math.abs(item.line - anchor) < 3)) {
          continue
        }
        evidence.push(buildEvidence(source, index))
        if (evidence.length >= 3) break
      }
      if (evidence.length >= 3) break
    }

    if (evidence.length === 0) continue

    const suspects: string[] = []
    for (const item of evidence) {
      const match = /Mixin apply for mod ([\w-]+) failed/i.exec(item.body)
      if (match) suspects.push(match[1].toLowerCase())
    }

    findings.push({
      id: rule.id,
      severity: rule.severity,
      title: rule.title,
      detail: rule.detail,
      evidence,
      suspects: [...new Set(suspects)],
      fixes: rule.fixes
    })
  }

  if (input.hasHsErr) {
    const hs = input.sources.find((source) => source.file.kind === 'hs_err')
    findings.unshift({
      id: 'hs_err',
      severity: 'critical',
      title: 'JVM 自身崩溃（hs_err_pid）',
      detail:
        '导出包中出现 hs_err_pid 日志，说明是 Java 虚拟机崩溃，而不是 Minecraft 的 Java 代码抛出异常。这类问题与模组逻辑无关，通常指向显卡驱动、原生库冲突或 Java 版本与位数严重不匹配。',
      evidence: hs
        ? [
            {
              id: `${hs.file.id}-head`,
              file: hs.file.path,
              line: 1,
              level: 'FATAL',
              body: hs.log.lines.slice(0, 12).join('\n')
            }
          ]
        : [],
      suspects: [],
      fixes: [
        {
          level: 'immediate',
          title: '先看 hs_err 头部的 Problematic frame',
          detail:
            '文件开头的 "Problematic frame" 一行往往直接指明崩溃发生在哪个原生库（如 nvoglv64.dll 指向显卡驱动），据此判断是驱动还是 Java 问题。'
        },
        {
          level: 'immediate',
          title: '更新显卡驱动并核对 Java 位数',
          detail: '到显卡厂商官网更新驱动；确认启动器使用的是 64 位 Java，且大版本与游戏要求一致。'
        },
        {
          level: 'diagnose',
          title: '临时移除原生加速类模组',
          detail: '若 Problematic frame 指向模组自带的 .dll / .so，先移除该模组再复现。'
        }
      ]
    })
  }

  const { suspects, duplicates } = buildSuspects(input)

  if (duplicates.length > 0) {
    findings.unshift({
      id: 'duplicate-mods',
      severity: 'high',
      title: '检测到重复模组',
      detail: `mods 目录中存在同名模组的多个版本（${duplicates
        .map((group) => group.join(' / '))
        .join('；')}）。加载器只会随机挑选其中一个，行为不可预测，必须先清理。`,
      evidence: [],
      suspects: duplicates.map((group) => group[0]),
      fixes: [
        {
          level: 'immediate',
          title: '删除旧版本，只保留一个',
          detail: '按文件名里的版本号保留最新且与游戏版本匹配的那个，删除其余同名 jar。'
        }
      ]
    })
  }

  const keywords = [
    'Exception',
    'OutOfMemoryError',
    'NoClassDefFoundError',
    'ClassNotFoundException',
    'NoSuchMethodError',
    'Mixin apply failed',
    'Failed to load mod',
    'Ticking entity',
    'Exception in server tick loop',
    "Couldn't find resource",
    'Missing or unsupported mandatory dependencies'
  ]

  const signatures: SignatureCount[] = keywords.map((keyword) => {
    let count = 0
    let file: string | undefined
    let line: number | undefined
    for (const source of input.sources) {
      for (let i = 0; i < source.log.lines.length; i += 1) {
        if (!source.log.lines[i].includes(keyword)) continue
        count += 1
        if (file === undefined) {
          file = source.file.path
          line = lineNumberOf(source.log, i)
        }
      }
    }
    return { keyword, count, file, line }
  }).filter((item) => item.count > 0)

  const severityRank: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity])

  return { findings, suspects, signatures }
}

const STAGE_LABEL: Record<StageGuess['stage'], string> = {
  launcher: '启动器拉起阶段',
  init: '游戏 / 模组初始化阶段',
  runtime: '运行期（世界加载后）',
  unknown: '无法判定'
}

export function guessStage(input: {
  sources: LogSource[]
  crashReports: CrashSummary[]
  hasHsErr: boolean
  env: Environment
}): StageGuess {
  const crash = input.crashReports[0]
  const latest = input.sources.find((source) => source.file.kind === 'latest')
  const launcher = input.sources.find((source) => source.file.kind === 'launcher')

  if (crash) {
    const description = crash.description.toLowerCase()
    if (/ticking|server tick|saving|level|world|player/.test(description)) {
      return {
        stage: 'runtime',
        label: STAGE_LABEL.runtime,
        confidence: 'high',
        reason: `崩溃报告的描述为“${crash.description}”，属于世界已加载后的运行期问题。`
      }
    }
    if (/initializ|constructing|loading|prepar|registry|mixin|rendering|starting/.test(description)) {
      return {
        stage: 'init',
        label: STAGE_LABEL.init,
        confidence: 'high',
        reason: `崩溃报告的描述为“${crash.description}”，失败发生在游戏或模组初始化阶段。`
      }
    }
    return {
      stage: 'init',
      label: STAGE_LABEL.init,
      confidence: 'medium',
      reason: `崩溃报告存在但描述为“${crash.description || '空'}”，按初始化阶段处理。`
    }
  }

  if (input.hasHsErr) {
    return {
      stage: 'runtime',
      label: STAGE_LABEL.runtime,
      confidence: 'medium',
      reason: '存在 hs_err_pid 日志，说明是 JVM 层面崩溃，通常发生在游戏运行过程中。'
    }
  }

  if (latest) {
    const tail = latest.log.lines.slice(-400).join('\n')
    if (/Sound engine started|Created: .*minecraft:textures|Stopping!/.test(tail)) {
      return {
        stage: 'runtime',
        label: STAGE_LABEL.runtime,
        confidence: 'medium',
        reason: '最新日志已进入主菜单或正常关闭流程，失败更可能发生在运行期。'
      }
    }
    if (/Setting user|Reloading ResourceManager|Loading [0-9]+ mods/.test(tail)) {
      return {
        stage: 'init',
        label: STAGE_LABEL.init,
        confidence: 'medium',
        reason: '最新日志停在初始化流程中，未见进入主菜单的标志性输出，判断为初始化阶段失败。'
      }
    }
  }

  if (!latest && launcher) {
    return {
      stage: 'launcher',
      label: STAGE_LABEL.launcher,
      confidence: 'high',
      reason: '导出包中只有启动器日志，没有游戏日志，问题很可能出现在启动器拉起游戏的阶段（如 Java 路径、内存参数）。'
    }
  }

  return {
    stage: 'unknown',
    label: STAGE_LABEL.unknown,
    confidence: 'low',
    reason: '缺少崩溃报告与足够的日志上下文，无法可靠判定失败阶段。'
  }
}

function firstMatch(texts: string[], pattern: RegExp): RegExpExecArray | null {
  for (const text of texts) {
    const match = pattern.exec(text)
    if (match) return match
  }
  return null
}

export function extractEnvironment(input: {
  crashReports: CrashSummary[]
  sources: LogSource[]
  loader?: LoaderProfile
}): Environment {
  const heads = input.crashReports.map((crash) => crash.head)
  const logHeads = input.sources.map((source) => source.log.lines.slice(0, 400).join('\n'))
  const all = [...heads, ...logHeads]

  const env: Environment = {}

  const mcVersion =
    firstMatch(heads, /^Minecraft Version:\s*([^\n]+)$/m) ??
    firstMatch(logHeads, /Loading Minecraft ([\d.]+)/) ??
    firstMatch(logHeads, /--fml\.mcVersion\s+(\S+)/)
  if (mcVersion) env.mcVersion = mcVersion[1].trim()

  const javaVersion = firstMatch(heads, /^Java Version:\s*([^\n,]+)/m)
  if (javaVersion) env.javaVersion = javaVersion[1].trim()

  const os = firstMatch(heads, /^Operating System:\s*([^\n]+)/m)
  if (os) env.os = os[1].trim()

  const memory = firstMatch(heads, /^Memory:\s*\d+\s*bytes.*?up to\s*(\d+)\s*bytes/m)
  if (memory) env.memoryMaxMb = Math.round(Number(memory[1]) / 1048576)

  // 加载器优先取 loader.ts 的加权判定结果；只有完全识别不出时才退回到逐条正则。
  if (input.loader && input.loader.family !== 'unknown') {
    env.loaderFamily = input.loader.family
    env.loader = describeLoader(input.loader)
  } else {
    const forge = firstMatch(all, /--fml\.forgeVersion\s+(\S+)/)
    const neo = firstMatch(all, /--fml\.neoForgeVersion\s+(\S+)/)
    const fabric = firstMatch(all, /Loading Minecraft [\d.]+ with Fabric Loader ([\d.]+)/)
    const fabricAlt = firstMatch(all, /Fabric Loader\s+([\d.]+)/)
    const quilt = firstMatch(all, /Quilt Loader\s+([\d.]+)/)
    const neoHeader = firstMatch(heads, /^[ \t]*NeoForge:\s*(\S+)/m)
    const fmlHeader = firstMatch(heads, /^[ \t]*FML:\s*([\d.]+)/m)

    if (neo) {
      env.loaderFamily = 'neoforge'
      env.loader = `NeoForge ${neo[1]}`
    } else if (neoHeader) {
      env.loaderFamily = 'neoforge'
      env.loader = `NeoForge ${neoHeader[1]}`
    } else if (forge) {
      env.loaderFamily = 'forge'
      env.loader = `Forge ${forge[1]}`
    } else if (fmlHeader) {
      env.loaderFamily = 'forge'
      env.loader = `Forge ${fmlHeader[1]}`
    } else if (quilt) {
      env.loaderFamily = 'quilt'
      env.loader = `Quilt ${quilt[1]}`
    } else if (fabric) {
      env.loaderFamily = 'fabric'
      env.loader = `Fabric ${fabric[1]}`
    } else if (fabricAlt) {
      env.loaderFamily = 'fabric'
      env.loader = `Fabric ${fabricAlt[1]}`
    } else if (/neoforge/i.test(all.join('\n'))) {
      env.loaderFamily = 'neoforge'
      env.loader = 'NeoForge（版本未知）'
    } else if (/net\.minecraftforge|forge mod loader/i.test(all.join('\n'))) {
      env.loaderFamily = 'forge'
      env.loader = 'Forge（版本未知）'
    } else if (/net\.quiltmc|quilt loader/i.test(all.join('\n'))) {
      env.loaderFamily = 'quilt'
      env.loader = 'Quilt（版本未知）'
    } else if (/net\.fabricmc|fabric loader/i.test(all.join('\n'))) {
      env.loaderFamily = 'fabric'
      env.loader = 'Fabric（版本未知）'
    }
  }

  const modCount = input.crashReports.find((crash) => crash.modCount !== undefined)?.modCount
  if (modCount !== undefined) env.modCount = modCount

  const launcherHint = firstMatch(all, /\b(HMCL|PCL2|Plain Craft Launcher|PrismLauncher|MultiMC)\b/)
  if (launcherHint) env.launcher = launcherHint[1] === 'Plain Craft Launcher' ? 'PCL2' : launcherHint[1]

  return env
}
