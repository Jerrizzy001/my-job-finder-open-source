/**
 * Builds the README's demo GIF from PNG screenshots, with no image tools
 * installed: a small PNG decoder, a median-cut palette and a GIF89a encoder.
 *
 *   node scripts/make-gif.ts out.gif 960 frame1.png:8 frame2.png:6 …
 *
 * Each frame is `path:seconds`. Frames are scaled to the given width.
 * docs/screenshots.md says how the screenshots themselves are captured.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

type Image = { width: number; height: number; rgb: Uint8Array }

export function decodePng(file: Buffer): Image {
  if (file.readUInt32BE(0) !== 0x89504e47) throw new Error('Not a PNG.')
  let offset = 8
  let width = 0
  let height = 0
  let colorType = 0
  const data: Buffer[] = []
  while (offset < file.length) {
    const length = file.readUInt32BE(offset)
    const type = file.toString('ascii', offset + 4, offset + 8)
    const body = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const depth = body[8]
      colorType = body[9]!
      if (depth !== 8 || (colorType !== 2 && colorType !== 6) || body[12] !== 0)
        throw new Error('Only 8-bit, non-interlaced RGB or RGBA PNGs are supported.')
    } else if (type === 'IDAT') data.push(body)
    else if (type === 'IEND') break
    offset += 12 + length
  }
  const channels = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const pixels = new Uint8Array(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? pixels[y * stride + x - channels]! : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x]! : 0
      const upLeft = y > 0 && x >= channels ? pixels[(y - 1) * stride + x - channels]! : 0
      let value = line[x]!
      if (filter === 1) value += left
      else if (filter === 2) value += up
      else if (filter === 3) value += (left + up) >> 1
      else if (filter === 4) {
        const p = left + up - upLeft
        const pa = Math.abs(p - left)
        const pb = Math.abs(p - up)
        const pc = Math.abs(p - upLeft)
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : upLeft
      }
      pixels[y * stride + x] = value & 0xff
    }
  }
  const rgb = new Uint8Array(width * height * 3)
  for (let i = 0; i < width * height; i++) rgb.set(pixels.subarray(i * channels, i * channels + 3), i * 3)
  return { width, height, rgb }
}

/** Area-average downscale. */
export function scale(image: Image, width: number): Image {
  const height = Math.round((image.height * width) / image.width)
  const rgb = new Uint8Array(width * height * 3)
  const sx = image.width / width
  const sy = image.height / height
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const x0 = Math.floor(x * sx)
      const x1 = Math.max(x0 + 1, Math.floor((x + 1) * sx))
      const y0 = Math.floor(y * sy)
      const y1 = Math.max(y0 + 1, Math.floor((y + 1) * sy))
      const sum = [0, 0, 0]
      for (let yy = y0; yy < y1; yy++)
        for (let xx = x0; xx < x1; xx++)
          for (let c = 0; c < 3; c++) sum[c]! += image.rgb[(yy * image.width + xx) * 3 + c]!
      const n = (x1 - x0) * (y1 - y0)
      for (let c = 0; c < 3; c++) rgb[(y * width + x) * 3 + c] = Math.round(sum[c]! / n)
    }
  return { width, height, rgb }
}

/** A 256-colour palette by median cut over all frames' pixels. */
export function palette(images: readonly Image[]): number[][] {
  const samples: number[][] = []
  for (const image of images)
    for (let i = 0; i < image.rgb.length; i += 3 * 7)
      samples.push([image.rgb[i]!, image.rgb[i + 1]!, image.rgb[i + 2]!])
  let boxes = [samples]
  while (boxes.length < 256) {
    boxes.sort((a, b) => b.length - a.length)
    const box = boxes.shift()!
    if (box.length < 2) {
      boxes.push(box)
      break
    }
    const ranges = [0, 1, 2].map((c) => {
      let low = 255
      let high = 0
      for (const p of box) {
        low = Math.min(low, p[c]!)
        high = Math.max(high, p[c]!)
      }
      return high - low
    })
    const channel = ranges.indexOf(Math.max(...ranges))
    box.sort((a, b) => a[channel]! - b[channel]!)
    const mid = box.length >> 1
    boxes.push(box.slice(0, mid), box.slice(mid))
  }
  boxes = boxes.filter((box) => box.length)
  const colors = boxes.map((box) =>
    [0, 1, 2].map((c) => Math.round(box.reduce((sum, p) => sum + p[c]!, 0) / box.length)),
  )
  while (colors.length < 256) colors.push([0, 0, 0])
  return colors
}

function indexImage(image: Image, colors: number[][]): Uint8Array {
  const cache = new Map<number, number>()
  const out = new Uint8Array(image.width * image.height)
  for (let i = 0; i < out.length; i++) {
    const r = image.rgb[i * 3]!
    const g = image.rgb[i * 3 + 1]!
    const b = image.rgb[i * 3 + 2]!
    const key = (r << 16) | (g << 8) | b
    let best = cache.get(key)
    if (best === undefined) {
      let distance = Infinity
      for (let c = 0; c < colors.length; c++) {
        const [cr, cg, cb] = colors[c]!
        const d = (r - cr!) ** 2 * 2 + (g - cg!) ** 2 * 4 + (b - cb!) ** 2 * 3
        if (d < distance) {
          distance = d
          best = c
        }
      }
      cache.set(key, best!)
    }
    out[i] = best!
  }
  return out
}

/** GIF's variable-width LZW, 8-bit minimum code size. */
export function lzw(indices: Uint8Array): Buffer {
  const clear = 256
  const end = 257
  const bytes: number[] = []
  let bitBuffer = 0
  let bitCount = 0
  let codeSize = 9
  const emit = (code: number) => {
    bitBuffer |= code << bitCount
    bitCount += codeSize
    while (bitCount >= 8) {
      bytes.push(bitBuffer & 0xff)
      bitBuffer >>>= 8
      bitCount -= 8
    }
  }
  let table = new Map<number, number>()
  let next = 258
  emit(clear)
  let prefix = indices[0]!
  for (let i = 1; i < indices.length; i++) {
    const k = indices[i]!
    const key = (prefix << 8) | k
    const found = table.get(key)
    if (found !== undefined) {
      prefix = found
      continue
    }
    emit(prefix)
    if (next < 4096) {
      table.set(key, next++)
      if (next > 1 << codeSize && codeSize < 12) codeSize++
    } else {
      emit(clear)
      table = new Map()
      next = 258
      codeSize = 9
    }
    prefix = k
  }
  emit(prefix)
  emit(end)
  if (bitCount > 0) bytes.push(bitBuffer & 0xff)
  const blocks: number[] = [8]
  for (let i = 0; i < bytes.length; i += 255) {
    const chunk = bytes.slice(i, i + 255)
    blocks.push(chunk.length, ...chunk)
  }
  blocks.push(0)
  return Buffer.from(blocks)
}

export function encodeGif(frames: { image: Image; seconds: number }[]): Buffer {
  const { width, height } = frames[0]!.image
  const colors = palette(frames.map((frame) => frame.image))
  const parts: Buffer[] = [Buffer.from('GIF89a', 'ascii')]
  const screen = Buffer.alloc(7)
  screen.writeUInt16LE(width, 0)
  screen.writeUInt16LE(height, 2)
  screen[4] = 0xf7 // global colour table, 256 entries
  parts.push(screen, Buffer.from(colors.flat()))
  parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 0x03, 0x01, 0x00, 0x00, 0x00])) // loop forever
  for (const frame of frames) {
    const control = Buffer.from([0x21, 0xf9, 0x04, 0x04, 0, 0, 0, 0])
    control.writeUInt16LE(Math.round(frame.seconds * 100), 4)
    const descriptor = Buffer.alloc(10)
    descriptor[0] = 0x2c
    descriptor.writeUInt16LE(width, 5)
    descriptor.writeUInt16LE(height, 7)
    parts.push(control, descriptor, lzw(indexImage(frame.image, colors)))
  }
  parts.push(Buffer.from([0x3b]))
  return Buffer.concat(parts)
}

if (import.meta.main) {
  const [out, widthText, ...specs] = process.argv.slice(2)
  if (!out || !widthText || !specs.length) {
    console.error('usage: node scripts/make-gif.ts out.gif <width> frame.png:seconds …')
    process.exit(2)
  }
  const frames = specs.map((spec) => {
    const at = spec.lastIndexOf(':')
    const image = scale(decodePng(readFileSync(spec.slice(0, at))), Number(widthText))
    return { image, seconds: Number(spec.slice(at + 1)) }
  })
  const gif = encodeGif(frames)
  writeFileSync(out, gif)
  console.log(
    `Wrote ${out}: ${frames.length} frames, ${frames.reduce((s, f) => s + f.seconds, 0)} s, ${(gif.length / 1024).toFixed(0)} KB.`,
  )
}
