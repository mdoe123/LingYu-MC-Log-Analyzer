import { promises as fs } from 'node:fs'
import { join, relative, sep } from 'node:path'
import type { ZipEntry } from './extract'

const MAX_ENTRIES = 20000
const MAX_DEPTH = 3
const KEEP_FILE = /\.(log|txt|json|jar|gz)$/i

/** 明显与日志无关、且体积或数量很大的目录，直接跳过。 */
const SKIP_DIRS = new Set([
  'assets',
  'libraries',
  'runtime',
  'natives',
  'saves',
  'screenshots',
  'shaderpacks',
  'resourcepacks',
  'downloads',
  'backups',
  'config',
  'defaultconfigs',
  'kubejs',
  'scripts'
])

export async function looksLikeGameDir(dir: string): Promise<boolean> {
  for (const probe of ['logs', 'crash-reports', 'versions']) {
    try {
      if ((await fs.stat(join(dir, probe))).isDirectory()) return true
    } catch {
      // 继续探测下一个标志目录
    }
  }
  return false
}

/**
 * 遍历游戏目录，产出与 zip 条目同构的路径列表（相对路径、正斜杠）。
 * 只保留可能参与分类的扩展名，避免把 assets 之外的杂项也带进来。
 */
export async function listGameDir(root: string): Promise<{ entries: ZipEntry[]; truncated: boolean }> {
  const entries: ZipEntry[] = []
  let truncated = false

  const walk = async (dir: string, depth: number): Promise<void> => {
    if (truncated || depth > MAX_DEPTH) return

    let items
    try {
      items = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }

    for (const item of items) {
      if (truncated) return

      const full = join(dir, item.name)

      if (item.isDirectory()) {
        if (SKIP_DIRS.has(item.name.toLowerCase())) continue
        if (depth === MAX_DEPTH) continue
        await walk(full, depth + 1)
        continue
      }

      if (!item.isFile() || !KEEP_FILE.test(item.name)) continue

      if (entries.length >= MAX_ENTRIES) {
        truncated = true
        return
      }

      try {
        const stat = await fs.stat(full)
        entries.push({
          path: relative(root, full).split(sep).join('/'),
          size: stat.size
        })
      } catch {
        // 单个文件无权限时跳过，不影响其余文件
      }
    }
  }

  await walk(root, 0)
  return { entries, truncated }
}

/** 读取文件前 maxBytes 字节，避免把超大日志整体载入内存。 */
export async function readFileCapped(path: string, maxBytes: number): Promise<Buffer> {
  const handle = await fs.open(path, 'r')
  try {
    const stat = await handle.stat()
    const length = Math.min(stat.size, maxBytes)
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}
