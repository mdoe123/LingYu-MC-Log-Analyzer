import chardet from 'chardet'
import iconv from 'iconv-lite'

export interface DecodedText {
  text: string
  encoding: string
}

function normalize(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Minecraft 日志在中文 Windows 下常见 GBK/GB18030，
 * 崩溃报告与启动器日志多为 UTF-8。先看 BOM，再用统计探测兜底。
 */
export function decodeBuffer(buffer: Buffer): DecodedText {
  if (buffer.length === 0) return { text: '', encoding: 'empty' }

  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return { text: normalize(buffer.subarray(3).toString('utf8')), encoding: 'UTF-8 BOM' }
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { text: normalize(buffer.subarray(2).toString('utf16le')), encoding: 'UTF-16LE' }
  }

  const detected = (chardet.detect(buffer) ?? 'UTF-8').toUpperCase()

  if (detected.includes('UTF-8')) {
    const text = buffer.toString('utf8')
    if (!text.includes('\uFFFD')) return { text: normalize(text), encoding: 'UTF-8' }
  }

  if (detected.includes('BIG5')) {
    return { text: normalize(iconv.decode(buffer, 'big5')), encoding: 'BIG5' }
  }

  if (detected.includes('GB') || detected.includes('GB18030') || detected.includes('EUC-CN')) {
    return { text: normalize(iconv.decode(buffer, 'gb18030')), encoding: 'GB18030' }
  }

  const utf8 = buffer.toString('utf8')
  if (!utf8.includes('\uFFFD')) return { text: normalize(utf8), encoding: 'UTF-8' }

  return { text: normalize(iconv.decode(buffer, 'gb18030')), encoding: 'GB18030' }
}
