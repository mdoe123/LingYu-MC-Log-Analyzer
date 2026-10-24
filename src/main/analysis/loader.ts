import type { LoaderFamily } from '../../shared/types'

/**
 * 加载器识别。
 *
 * 四个加载器的日志/崩溃报告结构差异集中在三处，本模块负责第一处：
 *
 * 1. **标识位置**（本模块）
 *    - Fabric：`Loading Minecraft <mc> with Fabric Loader <ver>`；崩溃报告 `-- System Details --` 里
 *      追加 `Fabric Mods:` 清单（官方文档 docs.fabricmc.net「Crash Reports」）。
 *    - Quilt：`Loading Minecraft <mc> with Quilt Loader <ver>`；堆栈出现 `org.quiltmc.loader.*`
 *      （Knot 启动链）；依赖错误用 `Incompatible mod set!` / `Dependency for mod 'x' on quilt_…`。
 *    - NeoForge：启动参数 `--fml.neoForgeVersion`、包名 `net.neoforged.*`、
 *      崩溃报告 `Description: Mod loading failures have occurred`、区块 `-- Mod loading issue for: <id> --`。
 *    - Forge：启动参数 `--fml.forgeVersion`、包名 `net.minecraftforge.*`、
 *      崩溃报告 `Description: Mod loading error has occurred`、区块 `Suspected Mods:`、System Details 的
 *      `Forge: net.minecraftforge:<ver>` 与 `FML: <ver>`。
 *
 * 2. 日志行前缀（parse.ts）
 * 3. 规则签名与证据区块（rules.ts / crash.ts）
 *
 * 判定采用加权打分而非「首个命中」：NeoForge 1.20.1 由 Forge 分叉而来，包名仍是
 * `net.minecraftforge.*`；Quilt 兼容 Fabric 模组，日志里会出现 `net.fabricmc.*`。
 * 单一特征都会误判，必须靠权重区分。
 */

export interface LoaderProfile {
  family: LoaderFamily
  version?: string
  /** 命中的最强特征（正则源码），用于在说明与测试中追溯判定依据 */
  evidence?: string
  /** 各家族累计得分，便于诊断误判 */
  scores?: Partial<Record<LoaderFamily, number>>
}

interface Marker {
  family: Exclude<LoaderFamily, 'unknown'>
  pattern: RegExp
  weight: number
  /** 取第几个捕获组作为版本号 */
  versionGroup?: number
  /** 判定依据的可读描述 */
  evidence: string
}

/** 顺序即同分时的优先级：NeoForge 先于 Forge，Quilt 先于 Fabric。 */
const MARKERS: Marker[] = [
  // ---- NeoForge ----
  {
    family: 'neoforge',
    pattern: /--fml\.neoForgeVersion\s+([\w.+-]+)/,
    weight: 100,
    versionGroup: 1,
    evidence: '启动参数 --fml.neoForgeVersion'
  },
  {
    family: 'neoforge',
    pattern: /net\.neoforged\.fml\./,
    weight: 90,
    evidence: '包名 net.neoforged.fml'
  },
  {
    family: 'neoforge',
    pattern: /neoforge\.mods\.toml/,
    weight: 90,
    evidence: '模组元数据 neoforge.mods.toml'
  },
  {
    family: 'neoforge',
    pattern: /Mod loading failures have occurred/,
    weight: 90,
    evidence: '崩溃报告 Mod loading failures have occurred'
  },
  {
    // NeoForge 1.20.1 的 System Details 采用 `Forge: net.neoforged:forge:<ver>`，
    // 权重必须高于 Forge 的 net.minecraftforge.fml.（90），否则会被残留包名压过。
    family: 'neoforge',
    pattern: /^[ \t]*Forge:\s*net\.neoforged:[\w.-]+:([\w.+-]+)\s*$/m,
    weight: 110,
    versionGroup: 1,
    evidence: 'System Details 的 Forge: net.neoforged 行'
  },
  {
    family: 'neoforge',
    pattern: /^[ \t]*NeoForge:\s*(?:[\w.-]+:)?([\w.+-]+)\s*$/m,
    weight: 85,
    versionGroup: 1,
    evidence: 'System Details 的 NeoForge 行'
  },
  {
    family: 'neoforge',
    pattern: /^--\s*Mod loading issue for:\s*.+?\s*--$/m,
    weight: 80,
    evidence: '崩溃报告 Mod loading issue for 区块'
  },
  {
    // NeoForge 1.20.1 的坐标写作 net.neoforged:forge:<ver>（冒号分隔），
    // 与包名的点号形式不同，必须单独覆盖，否则会被残留的 net.minecraftforge.* 判成 Forge。
    family: 'neoforge',
    pattern: /net\.neoforged[:.]/,
    weight: 75,
    evidence: '坐标或包名 net.neoforged'
  },
  {
    family: 'neoforge',
    pattern: /Launching target 'neoforge(?:client|server)'/,
    weight: 55,
    evidence: '启动目标 neoforgeclient'
  },

  // ---- Forge ----
  {
    family: 'forge',
    pattern: /--fml\.forgeVersion\s+([\w.+-]+)/,
    weight: 100,
    versionGroup: 1,
    evidence: '启动参数 --fml.forgeVersion'
  },
  {
    family: 'forge',
    pattern: /net\.minecraftforge\.fml\./,
    weight: 90,
    evidence: '包名 net.minecraftforge.fml'
  },
  {
    family: 'forge',
    pattern: /Mod loading error has occurred/,
    weight: 90,
    evidence: '崩溃报告 Mod loading error has occurred'
  },
  {
    family: 'forge',
    pattern: /^[ \t]*Forge:\s*(?:net\.minecraftforge:)?([\w.+-]+)\s*$/m,
    weight: 85,
    versionGroup: 1,
    evidence: 'System Details 的 Forge 行'
  },
  {
    family: 'forge',
    pattern: /^[ \t]*FML:\s*([\w.+-]+)\s*$/m,
    weight: 80,
    versionGroup: 1,
    evidence: 'System Details 的 FML 行'
  },
  {
    family: 'forge',
    pattern: /Launching target '(?:forge|fml)client'/,
    weight: 55,
    evidence: '启动目标 forgeclient'
  },
  {
    family: 'forge',
    pattern: /net\.minecraftforge\./,
    weight: 55,
    evidence: '包名 net.minecraftforge'
  },

  // ---- Quilt ----
  {
    family: 'quilt',
    pattern: /Loading Minecraft [\w.+-]+ with Quilt Loader ([\w.+-]+)/,
    weight: 100,
    versionGroup: 1,
    evidence: 'Fabric 风格的 Quilt Loader 启动行'
  },
  {
    family: 'quilt',
    pattern: /Quilt Loader\s+([\w.+-]+)/,
    weight: 95,
    versionGroup: 1,
    evidence: 'Quilt Loader 版本行'
  },
  {
    family: 'quilt',
    pattern: /org\.quiltmc\.loader\./,
    weight: 90,
    evidence: '包名 org.quiltmc.loader'
  },
  {
    family: 'quilt',
    pattern: /Incompatible mod set!/,
    weight: 90,
    evidence: '依赖解析错误 Incompatible mod set!'
  },
  {
    family: 'quilt',
    pattern: /Dependency for mod '[^']+' on quilt_/,
    weight: 90,
    evidence: '依赖错误 Dependency for mod on quilt_'
  },
  {
    family: 'quilt',
    pattern: /quilt_loader/,
    weight: 65,
    evidence: '模组标识 quilt_loader'
  },
  {
    family: 'quilt',
    pattern: /quilt\.mod\.json/,
    weight: 55,
    evidence: '模组元数据 quilt.mod.json'
  },

  // ---- Fabric ----
  {
    family: 'fabric',
    pattern: /Loading Minecraft [\w.+-]+ with Fabric Loader ([\w.+-]+)/,
    weight: 100,
    versionGroup: 1,
    evidence: 'Fabric Loader 启动行'
  },
  {
    family: 'fabric',
    pattern: /net\.fabricmc\.loader\./,
    weight: 90,
    evidence: '包名 net.fabricmc.loader'
  },
  {
    family: 'fabric',
    pattern: /Incompatible mods found!/,
    weight: 90,
    evidence: '依赖解析错误 Incompatible mods found!'
  },
  {
    family: 'fabric',
    pattern: /Fabric Loader\s+([\w.+-]+)/,
    weight: 80,
    versionGroup: 1,
    evidence: 'Fabric Loader 版本行'
  },
  {
    family: 'fabric',
    pattern: /^[ \t]*Fabric Mods:\s*$/m,
    weight: 70,
    evidence: 'System Details 的 Fabric Mods 区块'
  },
  {
    family: 'fabric',
    pattern: /net\.fabricmc\./,
    weight: 50,
    evidence: '包名 net.fabricmc'
  },
  {
    family: 'fabric',
    pattern: /fabric\.mod\.json/,
    weight: 45,
    evidence: '模组元数据 fabric.mod.json'
  }
]

const FAMILY_ORDER: LoaderFamily[] = ['neoforge', 'forge', 'quilt', 'fabric']

const LABEL: Record<LoaderFamily, string> = {
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  unknown: '未知'
}

export function loaderLabel(family: LoaderFamily): string {
  return LABEL[family] ?? '未知'
}

/** 把检测结果渲染成界面上的加载器名称，例如 `Forge 47.3.0` */
export function describeLoader(profile: LoaderProfile): string | undefined {
  if (profile.family === 'unknown') return undefined
  return profile.version ? `${loaderLabel(profile.family)} ${profile.version}` : loaderLabel(profile.family)
}

export function detectLoader(texts: string[]): LoaderProfile {
  const sample = texts.join('\n')
  const scores: Partial<Record<LoaderFamily, number>> = {}
  const best: Partial<Record<LoaderFamily, { version?: string; weight: number; evidence: string }>> = {}

  for (const marker of MARKERS) {
    const match = marker.pattern.exec(sample)
    if (!match) continue

    scores[marker.family] = (scores[marker.family] ?? 0) + marker.weight

    const version = marker.versionGroup ? match[marker.versionGroup] : undefined
    const current = best[marker.family]
    const hasVersion = version !== undefined
    const currentHasVersion = current?.version !== undefined
    // 版本号比权重更稀缺：先保证拿到版本，再在同等「有无版本」下比权重。
    const better =
      !current ||
      (hasVersion && !currentHasVersion) ||
      (hasVersion === currentHasVersion && marker.weight > current.weight)

    if (better) {
      best[marker.family] = { version, weight: marker.weight, evidence: marker.evidence }
    }
  }

  let family: LoaderFamily = 'unknown'
  let topScore = 0
  for (const candidate of FAMILY_ORDER) {
    const score = scores[candidate] ?? 0
    if (score > topScore) {
      topScore = score
      family = candidate
    }
  }

  if (family === 'unknown') return { family, scores }

  const picked = best[family as Exclude<LoaderFamily, 'unknown'>]
  return { family, version: picked?.version, evidence: picked?.evidence, scores }
}

/**
 * 从已加载的文件里抽样给 detectLoader。
 * 崩溃报告的加载器版本行在 System Details（文件靠后），日志的启动行在开头，
 * 所以日志取首尾各 8 KB，崩溃报告放宽到 2 MB。
 */
export function detectionSample(files: { kind: string; text: string }[]): string[] {
  return files.map((file) => {
    const cap = file.kind === 'crash' ? 2_000_000 : 16_000
    if (file.text.length <= cap) return file.text
    const half = Math.floor(cap / 2)
    return `${file.text.slice(0, half)}\n${file.text.slice(file.text.length - half)}`
  })
}
