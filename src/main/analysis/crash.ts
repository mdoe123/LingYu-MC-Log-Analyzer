import type { CrashSummary, LoaderMod } from '../../shared/types'

/**
 * 崩溃报告解析。
 *
 * 四个加载器都沿用原版的 `---- Minecraft Crash Report ----` 骨架
 * （`Description:` / `Caused by:` / `-- System Details --`），差异在于各自追加的区块：
 *
 * | 加载器 | 追加内容 | 本模块处理 |
 * | --- | --- | --- |
 * | Fabric | `-- System Details --` 下的 `Fabric Mods:` 清单 | `loaderMods` |
 * | Quilt | `Fabric Mods:`（Quilt 沿用了 Fabric 的键名以兼容工具链） | `loaderMods` |
 * | Forge | `Suspected Mods:` 区块、`-- NO MOD INFO AVAILABLE --`、Mod List 的 `ERRORED` 标记 | `suspectedMods` |
 * | NeoForge | `-- Mod loading issue for: <modid> --` 区块 | `suspectedMods` |
 *
 * 此外 Fabric Loader 的入口点失败会以 `provided by '<mod>' at '<class>'` 直接点名模组，
 * Quilt 的依赖解析失败用 `Dependency for mod '<mod>' on …`，两者都写入 `failedMods`。
 */

const STACK_PREFIXES = [
  'net.minecraft.',
  'net.minecraftforge.',
  'net.neoforged.',
  'cpw.mods.',
  'org.spongepowered.',
  'com.mojang.',
  'java.',
  'javax.',
  'jdk.',
  'sun.',
  'com.sun.',
  'org.lwjgl.',
  'io.netty.',
  'com.google.',
  'org.apache.',
  'it.unimi.',
  'org.slf4j.',
  'ch.qos.logback.',
  'net.fabricmc.loader.',
  'net.fabricmc.api.',
  'net.fabricmc.mappingio.',
  'org.quiltmc.loader.',
  'org.quiltmc.qsl.'
]

function isForeign(frame: string): boolean {
  const className = frame.split('(')[0]?.trim() ?? ''
  if (!className.includes('.')) return false
  return !STACK_PREFIXES.some((prefix) => className.startsWith(prefix))
}

/** 去掉方括号/引号与版本后缀，得到可用于匹配模组 jar 名的 id */
function normalizeModId(value: string): string {
  return value
    .trim()
    .replace(/^['"`]|['"`]$/g, '')
    .replace(/\[[^\]]*\]/g, '')
    .toLowerCase()
}

/**
 * Forge 的 `Suspected Mods:`。两种写法都存在过：
 *   Suspected Mods: NONE
 *   Suspected Mods:
 *       Snownee's Library (snownee)
 * 括号里可能是 modid 也可能是版本号，因此两个 token 都作为候选返回，交给上层做模糊比对。
 */
function parseSuspectedMods(text: string): string[] {
  const header = /^[ \t]*Suspected Mods:(.*)$/m.exec(text)
  if (!header) return []

  const inline = header[1].trim()
  if (inline && /^none$/i.test(inline)) return []

  const out: string[] = []
  const push = (value: string): void => {
    const id = normalizeModId(value)
    if (id && !out.includes(id)) out.push(id)
  }

  if (inline) {
    for (const part of inline.split(',')) push(part)
  }

  const rest = text.slice((header.index ?? 0) + header[0].length)
  for (const line of rest.split('\n')) {
    if (!line.trim()) {
      if (out.length > 0) break
      continue
    }
    if (!/^[ \t]/.test(line)) break
    const value = line.trim()
    if (/^Stacktrace:/i.test(value)) break

    // 括号里通常是 modid（`Example Library (examplelib)`），外侧是显示名。
    // 只保留像 modid 的那一侧：显示名带空格，无法与 jar 名比对，塞进嫌疑表只会稀释排序。
    const paren = /^(.+?)\s*\(([^)]+)\)\s*$/.exec(value)
    if (paren) {
      const left = paren[1].trim()
      const right = paren[2].trim()
      const isId = (token: string): boolean => /^[a-z0-9_.-]+$/.test(token.toLowerCase())
      if (isId(right)) push(right)
      else if (isId(left)) push(left)
      else {
        push(left)
        push(right)
      }
    } else {
      push(value)
    }
    if (out.length >= 24) break
  }

  return out
}

/** NeoForge 的 `-- Mod loading issue for: <modid> --` */
function parseModLoadingIssues(text: string): string[] {
  const out: string[] = []
  const re = /^--\s*Mod loading issue for:\s*(.+?)\s*--\s*$/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const id = normalizeModId(match[1])
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** Forge Mod List 里被标记为 ERRORED 的模组（`modid:name:version:ERRORED:…`） */
function parseErroredMods(text: string): string[] {
  const out: string[] = []
  const re = /^\t([\w.-]+):[^\n]*:ERRORED(?::[^\n]*)?$/gm
  let match: RegExpExecArray | null
  while ((match = re.exec(text)) !== null) {
    const id = normalizeModId(match[1])
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}

/** Fabric / Quilt 的 `Fabric Mods:` 清单：`\t\t<modid>: <name> <version>` */
function parseLoaderMods(text: string): LoaderMod[] {
  const header = /^[ \t]*Fabric Mods:\s*$/m.exec(text)
  if (!header) return []

  const out: LoaderMod[] = []
  const seen = new Set<string>()
  const rest = text.slice((header.index ?? 0) + header[0].length)

  for (const line of rest.split('\n')) {
    if (!line.trim()) continue
    // 区块以缩进表达层级：清单项固定两个制表符，之后是单缩进的下一字段或顶格的下一区块。
    // 两种情况都意味着清单结束——若不在这里停住，会把后面 `-- Affected level --` 之类的
    // 双层缩进内容误当成模组。
    if (!/^\t/.test(line)) break

    const match = /^\t\t([\w.\-]+):\s*(.+?)\s*$/.exec(line)
    if (!match) break

    const id = match[1].toLowerCase()
    if (seen.has(id)) continue
    seen.add(id)

    const rest2 = match[2]
    const versionMatch = /(\d[\w.+-]*)$/.exec(rest2)
    const version = versionMatch?.[1]
    const name = version ? rest2.slice(0, rest2.length - version.length).trim() : rest2

    out.push({ id, name: name || undefined, version })
    if (out.length >= 400) break
  }

  return out
}

/** Fabric `provided by '<mod>'` / Quilt `Dependency for mod '<mod>' on …` */
function parseFailedMods(text: string): string[] {
  const out: string[] = []
  const push = (value: string): void => {
    const id = normalizeModId(value)
    if (id && !out.includes(id)) out.push(id)
  }

  const entrypointRe = /provided by '([^']+)'(?:\s+at\s+'[^']*')?/g
  let match: RegExpExecArray | null
  while ((match = entrypointRe.exec(text)) !== null) push(match[1])

  const dependencyRe = /Dependency for mod '([^']+)' on /g
  while ((match = dependencyRe.exec(text)) !== null) push(match[1])

  return out
}

export function parseCrashReport(file: string, text: string): CrashSummary {
  const lines = text.split('\n')

  const description = /^Description:\s*(.+)$/m.exec(text)?.[1]?.trim() ?? ''

  const causedByChain: string[] = []
  const causedByRe = /^\s*Caused by:\s*(.+)$/gm
  let caused: RegExpExecArray | null
  while ((caused = causedByRe.exec(text)) !== null) {
    const value = caused[1].trim()
    if (value && !causedByChain.includes(value)) causedByChain.push(value)
  }

  const exceptionType = /(?:^|\s)((?:[a-zA-Z_$][\w$]*\.)*[A-Z][\w$]*(?:Exception|Error|Throwable))/.exec(
    text
  )?.[1]

  let firstForeignFrame: string | undefined
  for (const line of lines) {
    const match = /^\s*at\s+([\w.$<>]+)\(/.exec(line)
    if (!match) continue
    if (isForeign(match[1])) {
      firstForeignFrame = match[1]
      break
    }
  }

  const loaderMods = parseLoaderMods(text)
  const modCountRaw = /^Mod Count:\s*(\d+)/m.exec(text)?.[1]
  const modCount = modCountRaw ? Number(modCountRaw) : loaderMods.length > 0 ? loaderMods.length : undefined

  const suspected = [
    ...parseSuspectedMods(text),
    ...parseModLoadingIssues(text),
    ...parseErroredMods(text)
  ]
  const failed = parseFailedMods(text)

  return {
    file,
    description,
    rootCause: causedByChain.length > 0 ? causedByChain[causedByChain.length - 1] : exceptionType,
    causedByChain,
    firstForeignFrame,
    exceptionType,
    modCount,
    suspectedMods: suspected.length > 0 ? suspected : undefined,
    failedMods: failed.length > 0 ? failed : undefined,
    loaderMods: loaderMods.length > 0 ? loaderMods : undefined,
    head: lines.slice(0, 45).join('\n')
  }
}
