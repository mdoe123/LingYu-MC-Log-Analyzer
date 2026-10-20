const fs = require('node:fs')
const path = require('node:path')
const zlib = require('node:zlib')
const iconv = require('iconv-lite')

const src = path.join(__dirname, 'fixture-src')
const build = path.join(__dirname, 'fixture-build')

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

console.log('fixture-build ready')
