/**
 * 生成测试夹具：test/fixture-build/（目录形式）+ test/fixture.zip（压缩包形式）。
 *
 * 夹具此前只产出目录、不负责压缩，而 fixture.zip 又被 .gitignore 忽略，
 * 导致干净仓库执行 `npm run test:pipeline` 必然失败。现在压缩并入本脚本，
 * 由 `pretest:pipeline` / `pretest:e2e` 自动调用，保证任何一次克隆都能复现。
 *
 * 压缩用 Node 标准库手写最小 ZIP（deflate + 中央目录），不引入 yazl/archiver，
 * 也不依赖 PowerShell，保证 Windows / macOS / Linux 行为一致。
 */
const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const iconv = require('iconv-lite')

const src = path.join(__dirname, 'fixture-src')
const build = path.join(__dirname, 'fixture-build')
const zipPath = path.join(__dirname, 'fixture.zip')

fs.rmSync(build, { recursive: true, force: true })
fs.cpSync(src, build, { recursive: true })

const latest = path.join(build, 'logs', 'latest.log')
fs.writeFileSync(latest, iconv.encode(fs.readFileSync(latest, 'utf8'), 'gb18030'))

const history = path.join(build, 'logs', '2026-10-19-2.log')
fs.writeFileSync(`${history}.gz`, zlib.gzipSync(fs.readFileSync(history)))
fs.unlinkSync(history)

fs.mkdirSync(path.join(build, 'mods'), { recursive: true })
for (const name of [
  'embeddium-0.3.31.jar',
  'embeddium-0.3.25.jar',
  'oculus-1.7.0.jar',
  'geckolib-forge-1.20.1-4.4.4.jar'
]) {
  fs.writeFileSync(path.join(build, 'mods', name), 'fake jar')
}

/* ----------------------------- 最小 ZIP 写入器 ----------------------------- */

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let i = 0; i < 256; i += 1) {
    let c = i
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[i] = c
  }
  return table
})()

function crc32(buffer) {
  let c = -1
  for (let i = 0; i < buffer.length; i += 1) c = CRC_TABLE[(c ^ buffer[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

// 固定时间戳（2026-01-01 00:00），让每次生成的 zip 字节一致。
const DOS_TIME = 0
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1

function walk(dir, base, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(full, base, out)
    } else if (entry.isFile()) {
      out.push(path.relative(base, full).split(path.sep).join('/'))
    }
  }
  return out
}

function writeZip(target, rootDir) {
  const names = walk(rootDir, rootDir).sort()
  const localParts = []
  const centralParts = []
  let offset = 0

  for (const name of names) {
    const raw = fs.readFileSync(path.join(rootDir, name))
    const nameBuf = Buffer.from(name, 'utf8')
    const deflated = zlib.deflateRawSync(raw, { level: 9 })
    const useDeflate = deflated.length < raw.length
    const body = useDeflate ? deflated : raw
    const method = useDeflate ? 8 : 0
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28) // extra len

    localParts.push(local, nameBuf, body)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(nameBuf.length, 28)
    central.writeUInt16LE(0, 30) // extra len
    central.writeUInt16LE(0, 32) // comment len
    central.writeUInt16LE(0, 34) // disk number start
    central.writeUInt16LE(0, 36) // internal attrs
    central.writeUInt32LE(0, 38) // external attrs
    central.writeUInt32LE(offset, 42)

    centralParts.push(central, nameBuf)
    offset += local.length + nameBuf.length + body.length
  }

  const centralSize = centralParts.reduce((sum, part) => sum + part.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(names.length, 8)
  end.writeUInt16LE(names.length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  end.writeUInt16LE(0, 20)

  fs.writeFileSync(target, Buffer.concat([...localParts, ...centralParts, end]))
  return names.length
}

const count = writeZip(zipPath, build)
console.log(`fixture-build ready（${count} 个文件）`)
console.log(`fixture.zip ready（${fs.statSync(zipPath).size} 字节）`)
