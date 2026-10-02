/**
 * Builds the extension into dist/ for "Load unpacked" in chrome://extensions.
 * `npm run build:extension` from the repo root.
 */
import { build } from 'esbuild'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'

const root = import.meta.dirname
const dist = join(root, 'dist')
rmSync(dist, { recursive: true, force: true })
mkdirSync(join(dist, 'icons'), { recursive: true })

await build({
  entryPoints: { background: join(root, 'src/background.ts'), popup: join(root, 'src/popup.ts') },
  outdir: dist,
  bundle: true,
  format: 'esm',
  target: 'chrome120',
  logLevel: 'warning',
})
await build({
  entryPoints: { content: join(root, 'src/content.ts') },
  outdir: dist,
  bundle: true,
  format: 'iife',
  target: 'chrome120',
  logLevel: 'warning',
})
copyFileSync(join(root, 'manifest.json'), join(dist, 'manifest.json'))
copyFileSync(join(root, 'src/popup.html'), join(dist, 'popup.html'))
copyFileSync(join(root, 'src/popup.css'), join(dist, 'popup.css'))

/** A rounded evergreen square with a white check, drawn pixel by pixel. */
function icon(size: number): Buffer {
  const crc = (buf: Buffer) => {
    let c = ~0
    for (const byte of buf) {
      c ^= byte
      for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
    return ~c >>> 0
  }
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(8)
    head.writeUInt32BE(data.length)
    head.write(type, 4, 'ascii')
    const tail = Buffer.alloc(4)
    tail.writeUInt32BE(crc(Buffer.concat([head.subarray(4), data])))
    return Buffer.concat([head, data, tail])
  }
  const distToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number) => {
    const t = Math.max(
      0,
      Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)),
    )
    return Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)))
  }
  const rows: Buffer[] = []
  const r = size * 0.22
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4)
    for (let x = 0; x < size; x++) {
      const u = (x + 0.5) / size
      const v = (y + 0.5) / size
      const cx = Math.max(r, Math.min(size - r, x + 0.5))
      const cy = Math.max(r, Math.min(size - r, y + 0.5))
      const inside = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) <= r
      const stroke =
        Math.min(distToSegment(u, v, 0.28, 0.54, 0.43, 0.69), distToSegment(u, v, 0.43, 0.69, 0.73, 0.35)) < 0.055
      const [red, green, blue, alpha] = !inside ? [0, 0, 0, 0] : stroke ? [255, 255, 255, 255] : [29, 107, 87, 255]
      row.set([red, green, blue, alpha], 1 + x * 4)
    }
    rows.push(row)
  }
  const header = Buffer.alloc(13)
  header.writeUInt32BE(size, 0)
  header.writeUInt32BE(size, 4)
  header.set([8, 6, 0, 0, 0], 8)
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ])
}
for (const size of [16, 48, 128]) writeFileSync(join(dist, 'icons', `${size}.png`), icon(size))
console.log(`Built the extension into ${dist}. Load it unpacked from chrome://extensions.`)
