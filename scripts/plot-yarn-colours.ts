/**
 * Plots the current single-colour yarn stash as a colour space: hue across, perceptual lightness up.
 *
 * An analysis script, not part of the app or the deploy — it reads `data/*.csv` and writes a PDF.
 * Like `build-data.ts` it imports the *same* `src/core` modules the browser uses, so "which yarns
 * count" and "what is this yarn called" are answered by the app's own functions rather than by a
 * second implementation that could drift from what the Yarns page shows.
 *
 * Two axis choices worth stating, since both have defensible alternatives:
 *
 *   - Lightness is CIE L*, not HSV value. Under HSV every fully saturated colour ties at the top,
 *     which would stack pure blue level with pure yellow. L* is what the eye reports, so the
 *     vertical order matches how dark the yarn actually looks in the hand.
 *   - Hue is plain HSV hue, including for near-neutrals. A cream's hue is mostly rounding noise, so
 *     the greys are positioned less meaningfully than the vivid yarns. Kept anyway: dropping them
 *     would hide a real part of the stash.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../src/core/csv/parse'
import type { CsvTable } from '../src/core/csv/types'
import { buildSchemaSet, isYarnActive, splitList, titleFor, yarnUsageCounts } from '../src/core/schema'
import type { TableSchema } from '../src/core/schema'
import { measureText, PdfDoc, textAscent, textDescent, textHeight } from './lib/pdf'
import type { Rgb } from './lib/pdf'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = 'data'

// Mirrors the (module-private) regex in src/core/schema/validate.ts. A yarn's `hex` is a colorlist,
// so "single colour" means exactly one valid entry once split — there is no separate flag for it.
const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

// ---------------------------------------------------------------------------------------------
// Colour maths
// ---------------------------------------------------------------------------------------------

function hexToRgb(hex: string): Rgb {
  const h = hex.slice(1)
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h
  const v = parseInt(full, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/** HSV hue in degrees. Undefined for greys, where max === min; reported as 0. */
function hue(rgb: Rgb): number {
  const [r, g, b] = rgb
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return (((h * 60) % 360) + 360) % 360
}

/** HSV saturation, 0..1 — reported in the summary so the neutral caveat above is quantified. */
function saturation(rgb: Rgb): number {
  const max = Math.max(...rgb)
  return max === 0 ? 0 : (max - Math.min(...rgb)) / max
}

/** sRGB inverse companding: gamma-encoded channel to linear light. */
function linearise(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** CIE L*, 0..100. Perceptual lightness under D65 — the y axis. */
function lstar(rgb: Rgb): number {
  // Y of CIE XYZ; chromaticity does not enter into lightness.
  const y = 0.2126 * linearise(rgb[0]) + 0.7152 * linearise(rgb[1]) + 0.0722 * linearise(rgb[2])
  const f = y > 216 / 24389 ? Math.cbrt(y) : ((24389 / 27) * y) / 116 + 16 / 116
  return 116 * f - 16
}

/** Fully saturated colour at a given hue, for the legend strip under the x axis. */
function hueToRgb(deg: number): Rgb {
  const h = (deg % 360) / 60
  const x = 1 - Math.abs((h % 2) - 1)
  const table: Rgb[] = [
    [1, x, 0],
    [x, 1, 0],
    [0, 1, x],
    [0, x, 1],
    [x, 0, 1],
    [1, 0, x],
  ]
  return table[Math.floor(h) % 6]
}

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

interface Point {
  id: string
  label: string
  rgb: Rgb
  hue: number
  lstar: number
  saturation: number
  x: number
  y: number
}

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

function loadTables(): { yarns: CsvTable; squares: CsvTable; yarnSchema: TableSchema } {
  const manifest = JSON.parse(readRepoFile(`${DATA_DIR}/schema/tables.json`)) as { tables?: string[] }
  const names = manifest.tables ?? []
  const schemas: Record<string, unknown> = {}
  for (const name of names) {
    schemas[name] = JSON.parse(readRepoFile(`${DATA_DIR}/schema/${name}.json`))
  }
  const schemaSet = buildSchemaSet(manifest, schemas)
  const yarnSchema = schemaSet.tables.yarns
  const squareSchema = schemaSet.tables.squares
  if (!yarnSchema || !squareSchema) {
    throw new Error('expected "yarns" and "squares" tables in the schema set')
  }
  return {
    yarns: parseCsv(readRepoFile(yarnSchema.file)),
    squares: parseCsv(readRepoFile(squareSchema.file)),
    yarnSchema,
  }
}

interface Selection {
  points: Point[]
  skippedNoColour: string[]
  skippedMultiColour: string[]
  skippedInactive: string[]
}

function selectYarns(): Selection {
  const { yarns, squares, yarnSchema } = loadTables()
  const usage = yarnUsageCounts(squares)

  const points: Point[] = []
  const skippedNoColour: string[] = []
  const skippedMultiColour: string[] = []
  const skippedInactive: string[] = []

  for (const row of yarns.rows) {
    const id = row[yarnSchema.idField] ?? ''
    // The app's own "still in play" rule, so this matches the Yarns page's Active filter exactly.
    if (!isYarnActive(row, usage.get(id))) {
      skippedInactive.push(id)
      continue
    }
    const colours = splitList(row.hex ?? '').filter((h) => HEX_RE.test(h))
    if (colours.length === 0) {
      skippedNoColour.push(id)
      continue
    }
    if (colours.length > 1) {
      skippedMultiColour.push(id)
      continue
    }
    const rgb = hexToRgb(colours[0])
    points.push({
      id,
      // The app's own title rule, so a label here reads exactly as it does on the Yarns page.
      label: titleFor(yarnSchema, row),
      rgb,
      hue: hue(rgb),
      lstar: lstar(rgb),
      saturation: saturation(rgb),
      x: 0,
      y: 0,
    })
  }

  return { points, skippedNoColour, skippedMultiColour, skippedInactive }
}

// ---------------------------------------------------------------------------------------------
// Label placement
// ---------------------------------------------------------------------------------------------

interface Box {
  x: number
  y: number
  w: number
  h: number
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
}

/** Overlapping area of two boxes — used only to pick the least-bad spot when everything collides. */
function overlapArea(a: Box, b: Box): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y)
  return w > 0 && h > 0 ? w * h : 0
}

/** Unit vectors: E, W, N, S then the diagonals — tried in this order, so labels prefer sideways. */
const DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [0.707, 0.707],
  [-0.707, 0.707],
  [0.707, -0.707],
  [-0.707, -0.707],
]

interface Placed {
  point: Point
  box: Box
  /** Set when the label had to be pushed clear of the crowd and needs a line back to its circle. */
  leader: boolean
}

/**
 * Greedy label placement. Each label tries eight directions at growing distances and takes the
 * first position that hits nothing — no other label, no circle, and none of the fixed furniture
 * (title, axis ticks, legend) seeded into `obstacles`. Densest neighbourhoods go first, because a
 * point with room to spare can still find a spot after the crowded ones have taken theirs, but not
 * the other way round.
 */
function placeLabels(
  points: Point[],
  obstacles: Box[],
  bounds: Box,
  fontSize: number,
  radius: number,
): Placed[] {
  const circleBoxes: Box[] = points.map((p) => ({
    x: p.x - radius - 1,
    y: p.y - radius - 1,
    w: (radius + 1) * 2,
    h: (radius + 1) * 2,
  }))

  const crowding = (p: Point): number =>
    points.filter((q) => q !== p && Math.hypot(q.x - p.x, q.y - p.y) < 60).length
  const order = [...points].sort((a, b) => crowding(b) - crowding(a))

  const placed: Placed[] = []
  const taken: Box[] = [...obstacles]
  const h = textHeight(fontSize)

  for (const point of order) {
    const w = measureText(point.label, fontSize)
    // The near distances sit the label against its circle; the longer ones are the escape hatch
    // for a crowded neighbourhood, and earn a leader line so the pairing stays readable.
    const distances = [radius + 3, radius + 7, radius + 13, radius + 21, radius + 32, radius + 46]

    let best: { box: Box; leader: boolean } | undefined
    let fallback: { box: Box; leader: boolean; cost: number } | undefined

    search: for (const [di, distance] of distances.entries()) {
      for (const [dx, dy] of DIRECTIONS) {
        const cx = point.x + dx * distance
        const cy = point.y + dy * distance
        // A sideways offset anchors the label's near edge; a vertical one centres it on the circle.
        const box: Box = {
          x: dx > 0 ? cx : dx < 0 ? cx - w : cx - w / 2,
          y: dy > 0 ? cy : dy < 0 ? cy - h : cy - h / 2,
          w,
          h,
        }
        // Off the page is not a placement, however little else it collides with.
        if (
          box.x < bounds.x ||
          box.y < bounds.y ||
          box.x + box.w > bounds.x + bounds.w ||
          box.y + box.h > bounds.y + bounds.h
        ) {
          continue
        }
        const cost =
          taken.reduce((sum, t) => sum + overlapArea(box, t), 0) +
          circleBoxes.reduce((sum, c) => sum + overlapArea(box, c), 0)
        if (cost === 0) {
          best = { box, leader: di >= 3 }
          break search
        }
        if (!fallback || cost < fallback.cost) fallback = { box, leader: true, cost }
      }
    }

    const chosen = best ?? fallback
    if (!chosen) continue
    placed.push({ point, box: chosen.box, leader: chosen.leader })
    taken.push(chosen.box)
  }

  return placed
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

const INK: Rgb = [0.13, 0.13, 0.15]
const MUTED: Rgb = [0.45, 0.45, 0.48]
const GRID: Rgb = [0.88, 0.88, 0.9]
const FRAME: Rgb = [0.75, 0.75, 0.78]
const LEADER: Rgb = [0.62, 0.62, 0.65]
const HAIRLINE: Rgb = [0.35, 0.35, 0.38]
const WHITE: Rgb = [1, 1, 1]

const HUE_NAMES: Record<number, string> = {
  0: 'red',
  60: 'yellow',
  120: 'green',
  180: 'cyan',
  240: 'blue',
  300: 'magenta',
  360: 'red',
}

interface Layout {
  width: number
  height: number
  plotX: number
  plotY: number
  plotW: number
  plotH: number
}

const TITLE = 'Yarn stash by colour'

function render(points: Point[], layout: Layout, generatedAt: string): { doc: PdfDoc; placed: Placed[] } {
  const { width, height, plotX, plotY, plotW, plotH } = layout
  const doc = new PdfDoc(width, height)
  const labelSize = 6.5
  const tickSize = 7
  const radius = 4.6

  // Explicit white ground, so the sheet prints the same whatever a viewer paints behind the page.
  doc.setFill(WHITE)
  doc.rect(0, 0, width, height)

  const titleSize = 13
  const subtitleSize = 8
  const titleY = height - 34
  const subtitleY = titleY - 14
  const subtitle =
    `${points.length} current single-colour yarns   ·   x: hue   ·   ` +
    `y: CIE L* lightness, darker at the bottom   ·   ${generatedAt}`

  doc.setFill(INK)
  doc.text(plotX, titleY, TITLE, titleSize, true)
  doc.setFill(MUTED)
  doc.text(plotX, subtitleY, subtitle, subtitleSize)

  // Everything already committed to the page, so label placement can route around it.
  const obstacles: Box[] = [
    {
      x: plotX,
      y: titleY - textDescent(titleSize),
      w: measureText(TITLE, titleSize, true),
      h: textHeight(titleSize),
    },
    {
      x: plotX,
      y: subtitleY - textDescent(subtitleSize),
      w: measureText(subtitle, subtitleSize),
      h: textHeight(subtitleSize),
    },
  ]

  // Horizontal gridlines and L* ticks.
  doc.setLineWidth(0.4)
  for (let l = 0; l <= 100; l += 20) {
    const y = plotY + (l / 100) * plotH
    doc.setStroke(GRID)
    doc.line(plotX, y, plotX + plotW, y)
    const text = String(l)
    const tw = measureText(text, tickSize)
    const baseline = y - textAscent(tickSize) / 2
    doc.setFill(MUTED)
    doc.text(plotX - tw - 6, baseline, text, tickSize)
    obstacles.push({
      x: plotX - tw - 6,
      y: baseline - textDescent(tickSize),
      w: tw,
      h: textHeight(tickSize),
    })
  }

  // Vertical gridlines and hue ticks.
  for (let h = 0; h <= 360; h += 60) {
    const x = plotX + (h / 360) * plotW
    doc.setStroke(GRID)
    doc.line(x, plotY, x, plotY + plotH)
    const text = `${h}° ${HUE_NAMES[h] ?? ''}`.trim()
    const tw = measureText(text, tickSize)
    const tx = Math.min(Math.max(x - tw / 2, 4), width - tw - 4)
    const ty = plotY - 32
    doc.setFill(MUTED)
    doc.text(tx, ty, text, tickSize)
    obstacles.push({ x: tx, y: ty - textDescent(tickSize), w: tw, h: textHeight(tickSize) })
  }

  // The hue legend: a continuous spectrum strip, so the x axis reads without consulting the ticks.
  const stripY = plotY - 22
  const stripH = 7
  const steps = 180
  for (let i = 0; i < steps; i++) {
    doc.setFill(hueToRgb((i / steps) * 360))
    doc.rect(plotX + (i / steps) * plotW, stripY, plotW / steps + 0.6, stripH)
  }
  obstacles.push({ x: plotX, y: stripY, w: plotW, h: stripH })

  const axisLabel = 'lighter'
  doc.setFill(MUTED)
  doc.text(plotX - measureText(axisLabel, tickSize) - 6, plotY + plotH + 6, axisLabel, tickSize)
  doc.text(plotX - measureText('darker', tickSize) - 6, plotY - 11, 'darker', tickSize)

  doc.setLineWidth(0.6)
  doc.setStroke(FRAME)
  doc.rect(plotX, plotY, plotW, plotH, 'stroke')

  for (const p of points) {
    p.x = plotX + (p.hue / 360) * plotW
    p.y = plotY + (p.lstar / 100) * plotH
  }

  const margin = 6
  const bounds: Box = { x: margin, y: margin, w: width - margin * 2, h: height - margin * 2 }
  const placed = placeLabels(points, obstacles, bounds, labelSize, radius)

  // Leader lines first, so every circle sits on top of its own line rather than under it.
  doc.setLineWidth(0.35)
  doc.setStroke(LEADER)
  for (const { point, box, leader } of placed) {
    if (!leader) continue
    // Aim at the point on the label box nearest the circle.
    const tx = Math.max(box.x, Math.min(point.x, box.x + box.w))
    const ty = Math.max(box.y, Math.min(point.y, box.y + box.h))
    if (Math.hypot(tx - point.x, ty - point.y) > radius + 1) doc.line(point.x, point.y, tx, ty)
  }

  // The hairline keeps a near-white yarn visible against the paper.
  doc.setLineWidth(0.4)
  doc.setStroke(HAIRLINE)
  for (const p of points) {
    doc.setFill(p.rgb)
    doc.circle(p.x, p.y, radius, 'both')
  }

  doc.setFill(INK)
  for (const { point, box } of placed) {
    doc.text(box.x, box.y + textDescent(labelSize), point.label, labelSize)
  }

  return { doc, placed }
}

/** Counts label pairs that still touch, so "no overlapping text" is measured rather than assumed. */
function countOverlaps(placed: Placed[]): number {
  let n = 0
  for (let i = 0; i < placed.length; i++) {
    for (let j = i + 1; j < placed.length; j++) {
      if (overlaps(placed[i].box, placed[j].box)) n++
    }
  }
  return n
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

function main(): void {
  const args = process.argv.slice(2)
  const outIndex = args.indexOf('--out')
  const outPath = outIndex >= 0 ? args[outIndex + 1] : join(repoRoot, 'out', 'yarn-colours.pdf')
  const portrait = args.includes('--portrait')

  // US Letter at 72pt to the inch. Landscape by default: the hue axis is wide and shallow, and the
  // labels need the horizontal room more than the plot needs the height.
  const width = portrait ? 612 : 792
  const height = portrait ? 792 : 612
  const layout: Layout = {
    width,
    height,
    plotX: 56,
    plotY: 64,
    plotW: width - 56 - 28,
    plotH: height - 64 - 64,
  }

  const { points, skippedNoColour, skippedMultiColour, skippedInactive } = selectYarns()
  points.sort((a, b) => a.hue - b.hue)

  const generatedAt = new Date().toISOString().slice(0, 10)
  const { doc, placed } = render(points, layout, generatedAt)

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, doc.toBuffer())

  const overlapCount = countOverlaps(placed)
  const leaders = placed.filter((p) => p.leader).length
  const neutrals = points.filter((p) => p.saturation < 0.08).length

  console.log(`plotted ${points.length} yarns (${neutrals} near-neutral, nominal hue for those)`)
  console.log(
    `skipped: ${skippedNoColour.length} no colour, ` +
      `${skippedMultiColour.length} multi-colour` +
      `${skippedMultiColour.length ? ` (${skippedMultiColour.join(', ')})` : ''}, ` +
      `${skippedInactive.length} not current`,
  )
  console.log(`labels: ${placed.length} placed, ${leaders} with leader lines, ${overlapCount} overlaps`)
  if (overlapCount > 0) console.warn(`warning: ${overlapCount} label pair(s) still overlap`)
  console.log(`${portrait ? 'portrait' : 'landscape'} letter ${width}x${height}pt -> ${outPath}`)
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (invokedDirectly) {
  try {
    main()
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}
