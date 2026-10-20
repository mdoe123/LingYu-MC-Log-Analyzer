import * as yauzl from 'yauzl'

export interface ZipEntry {
  path: string
  size: number
}

const MAX_ENTRIES = 20000

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '')
}

function isUnsafePath(path: string): boolean {
  if (path.startsWith('/') || /^[a-zA-Z]:\//.test(path)) return true
  return path.split('/').some((segment) => segment === '..')
}

export function listZip(filePath: string): Promise<ZipEntry[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('无法打开压缩包'))
        return
      }

      const entries: ZipEntry[] = []
      let aborted = false

      zipfile.on('entry', (entry: yauzl.Entry) => {
        if (entries.length >= MAX_ENTRIES) {
          aborted = true
          zipfile.close()
          resolve(entries)
          return
        }
        const path = normalizePath(entry.fileName)
        if (!path.endsWith('/') && !isUnsafePath(path)) {
          entries.push({ path, size: entry.uncompressedSize })
        }
        zipfile.readEntry()
      })

      zipfile.on('end', () => resolve(entries))
      zipfile.on('error', (zipErr) => {
        if (!aborted) reject(zipErr)
      })

      zipfile.readEntry()
    })
  })
}

export function readEntry(
  filePath: string,
  target: string,
  maxBytes: number
): Promise<{ buffer: Buffer; truncated: boolean }> {
  return new Promise((resolve, reject) => {
    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err || !zipfile) {
        reject(err ?? new Error('无法打开压缩包'))
        return
      }

      let settled = false
      const finish = (buffer: Buffer, truncated: boolean): void => {
        if (settled) return
        settled = true
        try {
          zipfile.close()
        } catch {
          // ignore close errors
        }
        resolve({ buffer, truncated })
      }

      zipfile.on('entry', (entry: yauzl.Entry) => {
        const path = normalizePath(entry.fileName)
        if (path !== target) {
          zipfile.readEntry()
          return
        }

        zipfile.openReadStream(entry, (streamErr, stream) => {
          if (streamErr || !stream) {
            settled = true
            reject(streamErr ?? new Error('读取压缩包条目失败'))
            return
          }

          const chunks: Buffer[] = []
          let size = 0
          let truncated = false

          stream.on('data', (chunk: Buffer) => {
            if (size >= maxBytes) return
            const remaining = maxBytes - size
            if (chunk.length > remaining) {
              chunks.push(chunk.subarray(0, remaining))
              size = maxBytes
              truncated = true
              finish(Buffer.concat(chunks), true)
              return
            }
            chunks.push(chunk)
            size += chunk.length
          })

          stream.on('end', () => finish(Buffer.concat(chunks), truncated))
          stream.on('error', (readErr) => {
            if (!settled) {
              settled = true
              reject(readErr)
            }
          })
        })
      })

      zipfile.on('end', () => finish(Buffer.alloc(0), false))
      zipfile.on('error', (zipErr) => {
        if (!settled) {
          settled = true
          reject(zipErr)
        }
      })

      zipfile.readEntry()
    })
  })
}
