import type { AiAnalysis, BaseAnalysis, LinesResult, Settings } from '../types'

export const BASE_STAGES = [
  { id: 'extract', label: '解压压缩包', hint: '读取中央目录，按需解压文本条目' },
  { id: 'scan', label: '识别日志类型', hint: '匹配崩溃报告、游戏日志、JVM 错误日志' },
  { id: 'decode', label: '编码归一', hint: 'GBK / UTF-8 探测与换行规范化' },
  { id: 'parse', label: '堆栈解析', hint: '合并多行堆栈，提取异常链' },
  { id: 'rules', label: '规则匹配', hint: '签名库匹配与失败阶段判定' }
]

export const DEFAULT_SETTINGS: Settings = {
  provider: 'deepseek',
  baseUrl: 'https://api.deepseek.com/v1',
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

export const PROVIDERS = [
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { id: 'moonshot', name: 'Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-32k' },
  { id: 'zhipu', name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-plus' },
  { id: 'ollama', name: '本地 Ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:14b' },
  { id: 'custom', name: '自定义端点', baseUrl: '', model: '' }
]

export const MOCK_BASE: BaseAnalysis = {
  archiveName: 'crash-2026-10-20_12.04.31-client.zip',
  archiveSize: 13002342,
  entryCount: 87,
  environment: {
    launcher: 'HMCL',
    loader: 'Forge 47.3.0',
    mcVersion: '1.20.1',
    javaVersion: '17.0.8, Microsoft',
    os: 'Windows 11 (amd64)',
    memoryMaxMb: 4096,
    modCount: 47
  },
  stageGuess: {
    stage: 'init',
    label: '游戏 / 模组初始化阶段',
    confidence: 'high',
    reason: '崩溃报告描述为 “Rendering screen”，失败发生在渲染管线初始化阶段，窗口出现后立即退出。'
  },
  stats: {
    totalLines: 26280,
    errors: 6,
    warnings: 71,
    exceptionBlocks: 12
  },
  crashReports: [
    {
      file: 'crash-reports/crash-2026-10-20_12.04.31-client.txt',
      description: 'Rendering screen',
      rootCause:
        "java.lang.NoSuchMethodError: 'org.joml.Matrix4f net.minecraft.client.renderer.GameRenderer.m_109093_()'",
      causedByChain: [
        'org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException: Critical injection failure',
        "java.lang.NoSuchMethodError: 'org.joml.Matrix4f net.minecraft.client.renderer.GameRenderer.m_109093_()'"
      ],
      firstForeignFrame: 'oculus.mixin.GameRendererMixin.onResize',
      exceptionType: 'java.lang.RuntimeException',
      modCount: 47,
      head: [
        '---- Minecraft Crash Report ----',
        '// I\'m sorry, Dave.',
        '',
        'Time: 2026-10-20 12:04:31',
        'Description: Rendering screen',
        '',
        'java.lang.RuntimeException: Mixin transformation of net.minecraft.client.renderer.GameRenderer failed',
        '\tat net.minecraftforge.fml.loading.FMLClientLaunchProvider.launch(FMLClientLaunchProvider.java:37)',
        '',
        '-- System Details --',
        'Minecraft Version: 1.20.1',
        'Operating System: Windows 11 (amd64) version 10.0',
        'Java Version: 17.0.8, Microsoft',
        'Memory: 2048 MB / 4096 MB up to 8192 MB',
        'FML: 47.3.0',
        'Mod Count: 47'
      ].join('\n')
    }
  ],
  files: [
    {
      id: 'crash-0',
      name: 'crash-2026-10-20_12.04.31-client.txt',
      path: 'crash-reports/crash-2026-10-20_12.04.31-client.txt',
      size: 38912,
      bytesRead: 38912,
      lines: 812,
      kind: 'crash',
      encoding: 'UTF-8',
      included: true,
      note: '崩溃报告',
      truncated: false
    },
    {
      id: 'latest-1',
      name: 'latest.log',
      path: 'logs/latest.log',
      size: 4404019,
      bytesRead: 4404019,
      lines: 18204,
      kind: 'latest',
      encoding: 'GB18030',
      included: true,
      note: '主日志',
      truncated: false
    },
    {
      id: 'fml-2',
      name: 'fml-client-latest.log',
      path: 'logs/fml-client-latest.log',
      size: 1153433,
      bytesRead: 1153433,
      lines: 6204,
      kind: 'fml',
      encoding: 'UTF-8',
      included: true,
      note: '加载器日志',
      truncated: false
    },
    {
      id: 'debug-3',
      name: 'debug.log',
      path: 'logs/debug.log',
      size: 8493465,
      bytesRead: 8493465,
      lines: 41260,
      kind: 'debug',
      encoding: 'UTF-8',
      included: true,
      note: '调试日志（信噪比低）',
      truncated: false
    }
  ],
  findings: [
    {
      id: 'mixin',
      severity: 'critical',
      title: 'Mixin 注入失败',
      detail:
        '模组试图在目标方法上注入代码，但目标方法的签名或结构已被其它模组改动，注入点解析失败，渲染或初始化流程被中止。',
      evidence: [
        {
          id: 'latest-1-12041',
          file: 'logs/latest.log',
          line: 12041,
          level: 'ERROR',
          body: [
            '[12:04:31] [Render thread/ERROR] [mixin/]: Mixin apply for mod oculus failed',
            '[12:04:31] [Render thread/ERROR] [mixin/]: oculus.mixins.json:GameRendererMixin -> net.minecraft.client.renderer.GameRenderer',
            "[12:04:31] [Render thread/ERROR] [mixin/]: Caused by: java.lang.NoSuchMethodError: 'org.joml.Matrix4f net.minecraft.client.renderer.GameRenderer.m_109093_()'",
            '[12:04:31] [Render thread/ERROR] [mixin/]: \tat oculus.mixin.GameRendererMixin.onResize(GameRendererMixin.java:88)'
          ].join('\n')
        }
      ],
      suspects: ['oculus'],
      fixes: [
        {
          level: 'immediate',
          title: '更新或回退冲突模组',
          detail:
            '优先调整最近更新过的那个模组——它适配新版本游戏时最脆弱。同类优化模组（OptiFine / Embeddium / Sodium 系）不要共存。'
        },
        {
          level: 'diagnose',
          title: '二分定位并保留当次日志',
          detail: '每次只改一项，保留当次 latest.log，对比 ERROR 首次出现的位置，可快速收敛到具体模组。'
        }
      ]
    },
    {
      id: 'nosuchmethod',
      severity: 'high',
      title: '方法或字段签名不匹配',
      detail:
        '编译期存在的成员在运行期找不到对应签名，几乎总是版本错配：模组对游戏本体，或两个模组之间对同一 API 的版本不一致。',
      evidence: [
        {
          id: 'crash-0-9',
          file: 'crash-reports/crash-2026-10-20_12.04.31-client.txt',
          line: 9,
          level: 'ERROR',
          body: [
            '\tCaused by: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException',
            '\t\tCritical injection failure: @Inject annotation on onResize could not find any targets',
            '\t\tat oculus.mixin.GameRendererMixin.onResize(GameRendererMixin.java:88)'
          ].join('\n')
        }
      ],
      suspects: ['oculus', 'embeddium'],
      fixes: [
        {
          level: 'immediate',
          title: '把相关模组对齐到同一发布周期',
          detail: '让报错模组与它依赖的模组使用同期发布的版本，跨大版本混用极易触发该错误。'
        }
      ]
    }
  ],
  suspects: [
    {
      name: 'oculus',
      version: '1.7.0',
      reason: 'Mixin 注入失败日志直接点名；崩溃堆栈首个非原版帧指向该模组',
      score: 72,
      kind: 'mod'
    },
    {
      name: 'embeddium',
      version: '0.3.31',
      reason: '崩溃堆栈首个非原版帧指向该模组',
      score: 64,
      kind: 'mod'
    },
    { name: 'geckolib', version: '4.4.4', reason: '崩溃前最后加载的模组（弱信号）', score: 12, kind: 'mod' }
  ],
  signatures: [
    { keyword: 'Exception', count: 18, file: 'logs/latest.log', line: 12036 },
    { keyword: 'Mixin apply failed', count: 1, file: 'logs/latest.log', line: 12041 },
    { keyword: 'NoSuchMethodError', count: 2, file: 'logs/latest.log', line: 12044 },
    { keyword: "Couldn't find resource", count: 47, file: 'logs/latest.log', line: 9021 }
  ],
  notes: [
    '包内包含历史日志，默认仅分析最新一份；定位偶发崩溃时可再导出包含历史日志的完整包。',
    '日志中 47 条 “Couldn\'t find resource” 属于资源索引未命中的常规警告，与本次崩溃无因果关系。'
  ],
  durationMs: 1240,
  analyzedAt: '2026-10-20T08:04:35.000Z'
}

export const MOCK_AI: AiAnalysis = {
  severity: 'critical',
  title: 'Oculus 与 Embeddium 渲染方法签名不匹配，导致初始化阶段崩溃',
  summary:
    '两个渲染模组对 GameRenderer 的同一方法重复注入，Embeddium 已重写该方法签名，Oculus 仍按旧版映射查找注入点。',
  category: 'Mixin 注入冲突',
  location: 'GameRendererMixin:88',
  confidence: 0.92,
  rootCause: [
    '崩溃发生在渲染管线初始化阶段（Rendering screen），而不是模组注册或世界加载阶段，因此可以排除存档损坏与资源包问题。',
    'Oculus 1.7.0 的 GameRendererMixin 在注入 renderLevel 时按旧版映射查找投影矩阵方法；Embeddium 0.3.31 已重写该方法所在调用链，注入点解析失败并中止渲染管线初始化。',
    '两个模组单独加载时均可正常启动，仅在共存时触发，说明这是版本组合问题而非配置错误。'
  ],
  evidence: [
    {
      id: 'ai-latest-12041',
      file: 'logs/latest.log',
      line: 12041,
      level: 'ERROR',
      body: [
        '[12:04:31] [Render thread/ERROR] [mixin/]: Mixin apply for mod oculus failed',
        '[12:04:31] [Render thread/ERROR] [mixin/]: oculus.mixins.json:GameRendererMixin -> net.minecraft.client.renderer.GameRenderer',
        "[12:04:31] [Render thread/ERROR] [mixin/]: Caused by: java.lang.NoSuchMethodError: 'org.joml.Matrix4f net.minecraft.client.renderer.GameRenderer.m_109093_()'"
      ].join('\n')
    },
    {
      id: 'ai-crash-9',
      file: 'crash-reports/crash-2026-10-20_12.04.31-client.txt',
      line: 9,
      level: 'FATAL',
      body: [
        '\tCaused by: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException',
        '\t\tCritical injection failure: @Inject annotation on onResize could not find any targets',
        '\t\tat oculus.mixin.GameRendererMixin.onResize(GameRendererMixin.java:88)'
      ].join('\n')
    }
  ],
  components: [
    { name: 'oculus', version: '1.7.0', role: '模组', primary: true },
    { name: 'embeddium', version: '0.3.31', role: '模组', primary: true },
    { name: 'forge', version: '47.3.0', role: '加载器', primary: false },
    { name: 'geckolib', version: '4.4.4', role: '前置', primary: false }
  ],
  fixes: [
    {
      level: 'immediate',
      title: '对齐两个渲染模组的版本',
      detail:
        '将 Embeddium 升级至 0.3.32 或回退到 0.3.25，Oculus 保持 1.7.0。两者必须处于同一发布周期。'
    },
    {
      level: 'immediate',
      title: '移除 Oculus 后启动验证',
      detail: '不使用光影时，删除 oculus-1.7.0.jar 可立即恢复启动，这是最快确认因果关系的方式。'
    },
    {
      level: 'try',
      title: '清理着色器编译缓存',
      detail: '删除 shaderpacks 下的缓存与 config/oculus 目录后重试。'
    },
    {
      level: 'diagnose',
      title: '二分定位其余渲染模组',
      detail: '若上述无效，依次禁用含渲染 Mixin 的模组，每次只改一项并保留当次 latest.log。'
    }
  ],
  secondary: [
    { title: "Couldn't find resource", detail: '资源包索引残留，不影响功能', count: 47 },
    { title: 'Unknown recipe type: create:mechanical_crafting', detail: '数据包引用了未安装模组的配方', count: 3 }
  ],
  model: 'deepseek-chat',
  usage: { input: 8412, output: 1206 },
  durationMs: 6400
}

export const MOCK_LOGS: Record<string, LinesResult> = {
  'logs/latest.log': {
    file: 'logs/latest.log',
    start: 12031,
    total: 18204,
    lines: [
      "[12:04:26] [main/INFO] [minecraft/Main]: Launching target 'forgeclient' with 47 mods",
      '[12:04:27] [main/INFO] [mixin/]: SpongePowered MIXIN Subsystem version 0.8.5',
      '[12:04:27] [main/INFO] [ForgeModLoader/]: Found mod file embeddium-0.3.31.jar',
      '[12:04:27] [main/INFO] [ForgeModLoader/]: Found mod file oculus-1.7.0.jar',
      '[12:04:28] [Render thread/INFO] [minecraft/Minecraft]: Setting user: Steve',
      '[12:04:28] [Render thread/INFO] [embeddium/]: Embeddium 0.3.31 initializing',
      '[12:04:29] [Render thread/INFO] [oculus/]: Oculus 1.7.0 shader pipeline ready',
      '[12:04:29] [Render thread/INFO] [minecraft/GameRenderer]: Loading 42 shader programs',
      '[12:04:30] [Render thread/INFO] [minecraft/TextureManager]: Reloading ResourceManager',
      "[12:04:30] [Worker-Main-3/WARN] [minecraft/ResourceManager]: Couldn't find resource minecraft:missingno",
      '[12:04:31] [Render thread/ERROR] [mixin/]: Mixin apply for mod oculus failed',
      '[12:04:31] [Render thread/ERROR] [mixin/]: oculus.mixins.json:GameRendererMixin -> net.minecraft.client.renderer.GameRenderer',
      '[12:04:31] [Render thread/ERROR] [mixin/]: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException: Critical injection failure',
      "[12:04:31] [Render thread/ERROR] [mixin/]: Caused by: java.lang.NoSuchMethodError: 'org.joml.Matrix4f net.minecraft.client.renderer.GameRenderer.m_109093_()'",
      '[12:04:31] [Render thread/ERROR] [mixin/]: \tat oculus.mixin.GameRendererMixin.onResize(GameRendererMixin.java:88)',
      '[12:04:31] [Render thread/ERROR] [mixin/]: \tat net.minecraft.client.renderer.GameRenderer.m_109093_(GameRenderer.java:412)',
      '[12:04:31] [Render thread/FATAL] [minecraft/Minecraft]: Unreported exception thrown!',
      '[12:04:31] [Render thread/FATAL] [minecraft/Minecraft]: Crash report saved to crash-reports/crash-2026-10-20_12.04.31-client.txt',
      '[12:04:32] [Render thread/WARN] [minecraft/Minecraft]: Stopping worker threads',
      '[12:04:32] [Render thread/INFO] [minecraft/Minecraft]: Stopping!'
    ]
  },
  'crash-reports/crash-2026-10-20_12.04.31-client.txt': {
    file: 'crash-reports/crash-2026-10-20_12.04.31-client.txt',
    start: 1,
    total: 812,
    lines: [
      '---- Minecraft Crash Report ----',
      "// I'm sorry, Dave.",
      '',
      'Time: 2026-10-20 12:04:31',
      'Description: Rendering screen',
      '',
      'java.lang.RuntimeException: Mixin transformation of net.minecraft.client.renderer.GameRenderer failed',
      '\tat net.minecraftforge.fml.loading.FMLClientLaunchProvider.launch(FMLClientLaunchProvider.java:37)',
      '\tCaused by: org.spongepowered.asm.mixin.injection.throwables.InvalidInjectionException',
      '\t\tCritical injection failure: @Inject annotation on onResize could not find any targets',
      '\t\tat oculus.mixin.GameRendererMixin.onResize(GameRendererMixin.java:88)',
      '',
      '-- System Details --',
      'Minecraft Version: 1.20.1',
      'Operating System: Windows 11 (amd64) version 10.0',
      'Java Version: 17.0.8, Microsoft',
      'Memory: 2048 MB / 4096 MB up to 8192 MB',
      'FML: 47.3.0',
      'Mod Count: 47'
    ]
  },
  'logs/fml-client-latest.log': {
    file: 'logs/fml-client-latest.log',
    start: 4180,
    total: 6204,
    lines: [
      '[12:04:22] [main/DEBUG] [mixin/]: Preparing mixin configs for 47 mods',
      '[12:04:23] [main/DEBUG] [mixin/]: Registered mixin config oculus.mixins.json (priority 1000)',
      '[12:04:23] [main/DEBUG] [mixin/]: Registered mixin config embeddium.mixins.json (priority 1000)',
      '[12:04:24] [main/DEBUG] [mixin/]: Applying mixins in phase DEFAULT',
      '[12:04:26] [main/INFO] [ForgeModLoader/]: 47 mods loaded, 0 mods active'
    ]
  },
  'logs/debug.log': {
    file: 'logs/debug.log',
    start: 38410,
    total: 41260,
    lines: [
      '[12:04:30] [Render thread/DEBUG] [embeddium/]: Chunk render dispatcher started with 4 threads',
      '[12:04:30] [Render thread/DEBUG] [oculus/]: Resolving uniform block layout for terrain',
      '[12:04:30] [Render thread/DEBUG] [oculus/]: Binding program 12, attributes 6',
      '[12:04:31] [Render thread/DEBUG] [mixin/]: Rewriting net.minecraft.client.renderer.GameRenderer'
    ]
  }
}
