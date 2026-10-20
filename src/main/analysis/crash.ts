import type { CrashSummary } from '../../shared/types'

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
  'net.fabricmc.loader.'
]

function isForeign(frame: string): boolean {
  const className = frame.split('(')[0]?.trim() ?? ''
  if (!className.includes('.')) return false
  return !STACK_PREFIXES.some((prefix) => className.startsWith(prefix))
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

  const modCountRaw = /^Mod Count:\s*(\d+)/m.exec(text)?.[1]

  return {
    file,
    description,
    rootCause: causedByChain.length > 0 ? causedByChain[causedByChain.length - 1] : exceptionType,
    causedByChain,
    firstForeignFrame,
    exceptionType,
    modCount: modCountRaw ? Number(modCountRaw) : undefined,
    head: lines.slice(0, 45).join('\n')
  }
}
