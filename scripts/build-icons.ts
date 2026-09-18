/**
 * Generates the home-screen icons from one description of the artwork.
 *
 * Run by hand (`npm run build-icons`) with the output committed, *not* wired into the build: the
 * icons change roughly never, and regenerating binaries on every CI run would put a new blob in
 * every deploy for no reason.
 *
 * It writes the PNGs itself rather than pulling in an image library. A granny square is concentric
 * bands of colour, which is about fifteen lines of pixel arithmetic, and a PNG of flat colour is a
 * zlib stream with a header — both already in Node. Given the repo's no-third-party-runtime posture
 * and four production dependencies, an image toolchain to draw squares would be the odd thing.
 *
 * `icon.svg` is the source of truth for the artwork and is written from the same numbers, so the
 * vector and the rasters cannot drift.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_DIR = join(repoRoot, 'public')

/** Light-theme paper, then rings worked outward from the centre, as you would crochet them. */
const BACKGROUND = '#faf7f2'
const RINGS = ['#9a5b4c', '#eda100', '#1baf7a', '#e87ba4', '#2a78d6']

/** Fraction of the canvas the square occupies, leaving a margin inside a maskable safe zone. */
const INSET = 0.14

type Rgb = [number, number, number]

function rgb(hex: string): Rgb {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Colour of one pixel: a Chebyshev distance from the centre is exactly a set of nested squares,
 * which is what a granny square is.
 */
function pixel(x: number, y: number, size: number): Rgb {
  const centre = (size - 1) / 2
  const half = size / 2
  const d = Math.max(Math.abs(x - centre), Math.abs(y - centre)) / half

  const outer = 1 - INSET
  if (d > outer) return rgb(BACKGROUND)

  const band = Math.floor((d / outer) * RINGS.length)
  const within = ((d / outer) * RINGS.length) % 1
  // A hairline of paper between rings reads as the gap between rounds.
  if (within > 0.88 && band < RINGS.length - 1) return rgb(BACKGROUND)
  return rgb(RINGS[Math.min(band, RINGS.length - 1)])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer: Buffer): number {
  let c = 0xffffffff
  for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([length, body, crc])
}

/** Truecolour, 8 bits per channel, one filter byte per scanline. No alpha: the icon is full-bleed. */
function png(size: number): Buffer {
  const raw = Buffer.alloc(size * (size * 3 + 1))
  let offset = 0
  for (let y = 0; y < size; y++) {
    raw[offset++] = 0 // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y, size)
      raw[offset++] = r
      raw[offset++] = g
      raw[offset++] = b
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 2 // colour type: truecolour

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

/** The same rings as nested `<rect>`s, so the vector and the rasters stay one drawing. */
function svg(): string {
  const size = 512
  const outer = size * (1 - INSET)
  const step = outer / 2 / RINGS.length
  const square = (side: number, fill: string): string => {
    const origin = ((size - side) / 2).toFixed(1)
    return `  <rect x="${origin}" y="${origin}" width="${side.toFixed(1)}" height="${side.toFixed(1)}" fill="${fill}" />`
  }
  const gap = step * 0.12
  const rects = RINGS.flatMap((_ring, index) => {
    const side = (outer / 2 - index * step) * 2
    const colour = RINGS[RINGS.length - 1 - index]
    // Paper first, then the round on top of it: that hairline is the gap between rounds, and it is
    // drawn the same way the raster does it.
    return index === 0 ? [square(side, colour)] : [square(side, BACKGROUND), square(side - gap * 2, colour)]
  })
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    `  <rect width="${size}" height="${size}" fill="${BACKGROUND}" />`,
    ...rects,
    '</svg>',
    '',
  ].join('\n')
}

mkdirSync(OUT_DIR, { recursive: true })

// 192 and 512 are what the manifest asks for; 180 is what iOS uses for the home screen, and it
// ignores SVG, which is why the rasters exist at all.
for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
] as const) {
  writeFileSync(join(OUT_DIR, name), png(size))
  console.log(`wrote public/${name} (${size}×${size})`)
}

writeFileSync(join(OUT_DIR, 'icon.svg'), svg())
console.log('wrote public/icon.svg')
