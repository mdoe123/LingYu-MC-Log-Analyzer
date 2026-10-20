import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'

const LEGACY_DIR = 'mc-log-analyzer'
const MIGRATED_FILES = ['settings.json', 'java-runtimes.json']

/**
 * 项目从 mc-log-analyzer 更名为 lingyu-mc-log-analyzer 后，userData 目录随之变化。
 * 首次启动时把旧目录中的设置与 Java 扫描缓存复制到新目录；只复制，不删除旧数据。
 */
export async function migrateLegacyUserData(): Promise<void> {
  const current = app.getPath('userData')
  const legacy = join(app.getPath('appData'), LEGACY_DIR)
  if (current === legacy) return

  await fs.mkdir(current, { recursive: true })

  for (const name of MIGRATED_FILES) {
    const source = join(legacy, name)
    const target = join(current, name)

    try {
      await fs.access(target)
      continue
    } catch {
      // 目标不存在，继续复制
    }

    try {
      await fs.copyFile(source, target)
    } catch {
      // 旧文件不存在或不可读时跳过，不影响启动
    }
  }
}
