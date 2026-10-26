/**
 * Lays the squares on file out as a 20 x 20 blanket: construction type checkered, main colour
 * sorted by hue across and lightness down. A preview of how the squares made so far would sit in
 * the finished blanket, long before there are 400 of them.
 *
 * An analysis script, like `plot-yarn-colours.ts` — it reads `data/*.csv` and writes a PDF plus a
 * CSV of positions to `out/`, and never touches the data. It imports the same `src/core` modules the
 * app uses, so a square's construction type is the *effective* one (its own, else its design's)
 * exactly as the Squares page shows it.
 *
 * The layout is an assignment problem, not a sort. Every square gets a target point on the grid
 * from its colour, every cell of the right construction is a slot, and the Hungarian algorithm
 * picks the one-to-one matching with the least total squared distance from square to target. That
 * is what lets the checkerboard and the colour gradient coexist: a sort could honour one axis, but
 * would have to break either the other axis or the checker to fit both. Choices worth stating:
 *
 *   - Positions are rank-based, not linear in hue or L*. Yarn colours bunch (plenty of blues, few
 *     greens, almost nothing below L* 30), and a linear scale would pile the squares into a few
 *     rows and leave the rest of the blanket blank. Ranking spreads them over the whole grid, at the
 *     cost of the axes being uneven — the strips along the top and left edge show the real hue and
 *     lightness each column and row stands for.
 *   - Hue is a circle but a blanket has edges, so the hue axis is cut at the widest gap in the hues
 *     actually present. Whatever sits either side of the cut is the pair least alike anyway.
 *   - A print yarn offers every colour it contains as a target and costs whichever is nearest, so
 *     it is free to sit near any of them. A speckled yarn offers only its base (first) colour, since
 *     that is what it reads as from across a room.
 *   - Near-neutrals keep their nominal HSV hue, same caveat as the yarn plot: a cream's hue is
 *     mostly rounding noise, so it lands by lightness more meaningfully than by column.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCsv } from '../src/core/csv/parse'
import type { CsvRow } from '../src/core/csv/types'
import { buildSchemaSet, effectiveValue, fieldByKey, splitList, titleFor } from '../src/core/schema'
import type { ResolveRef, TableSchema } from '../src/core/schema'
import { greyAtLstar, HEX_RE, hexToRgb, hue, hueToRgb, lstar, saturation } from './lib/colour'
import { measureText, PdfDoc, textAscent } from './lib/pdf'
import type { Rgb } from './lib/pdf'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const DATA_DIR = 'data'

// ---------------------------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------------------------

interface Candidate {
  rgb: Rgb
  hue: number
  lstar: number
}

interface Square {
  id: string
  construction: string
  yarnId: string
  yarnLabel: string
  /** Every colour of the main yarn, in order — what gets drawn. */
  colours: Rgb[]
  pattern: string
  /** The colours this square may be placed near: all of a print's, a speckled yarn's base only. */
  candidates: Candidate[]
  neutral: boolean
}

interface Loaded {
  squares: Square[]
  /** The two construction types, in schema order, that the checkerboard alternates. */
  constructions: [string, string]
  skipped: { noMainYarn: string[]; noColour: string[]; noConstruction: string[] }
}

function readRepoFile(path: string): string {
  return readFileSync(join(repoRoot, path), 'utf8')
}

function loadSquares(): Loaded {
  const manifest = JSON.parse(readRepoFile(`${DATA_DIR}/schema/tables.json`)) as { tables?: string[] }
  const schemas: Record<string, unknown> = {}
  for (const name of manifest.tables ?? []) {
    schemas[name] = JSON.parse(readRepoFile(`${DATA_DIR}/schema/${name}.json`))
  }
  const schemaSet = buildSchemaSet(manifest, schemas)

  // Every table indexed by id, which is all `effectiveValue` needs to follow `design_id` through to
  // the design's construction type.
  const lookups = new Map<string, { schema: TableSchema; rows: Map<string, CsvRow> }>()
  for (const [name, schema] of Object.entries(schemaSet.tables)) {
    const rows = new Map<string, CsvRow>()
    for (const row of parseCsv(readRepoFile(schema.file)).rows) rows.set(row[schema.idField] ?? '', row)
    lookups.set(name, { schema, rows })
  }
  const resolve: ResolveRef = (table) => lookups.get(table)

  const squareLookup = lookups.get('squares')
  const yarnLookup = lookups.get('yarns')
  if (!squareLookup || !yarnLookup) throw new Error('expected "squares" and "yarns" tables in the schema set')
  const squareSchema = squareLookup.schema

  const constructionField = fieldByKey(squareSchema, 'construction_type')
  const options = constructionField?.options ?? []
  // A checkerboard has exactly two colours; a third construction type would need a different tiling.
  if (!constructionField || options.length !== 2) {
    throw new Error(`a checkered layout needs exactly two construction types, found ${options.length}`)
  }

  const squares: Square[] = []
  const skipped: Loaded['skipped'] = { noMainYarn: [], noColour: [], noConstruction: [] }

  for (const row of squareLookup.rows.values()) {
    const id = row[squareSchema.idField] ?? ''
    const construction = effectiveValue(squareSchema, constructionField, row, resolve).value
    if (!options.includes(construction)) {
      skipped.noConstruction.push(id)
      continue
    }
    const yarnId = row.main_yarn ?? ''
    const yarn = yarnLookup.rows.get(yarnId)
    if (!yarn) {
      skipped.noMainYarn.push(id)
      continue
    }
    const colours = splitList(yarn.hex ?? '')
      .filter((h) => HEX_RE.test(h))
      .map(hexToRgb)
    if (colours.length === 0) {
      skipped.noColour.push(id)
      continue
    }
    const pattern = (yarn.pattern ?? '').trim()
    const offered = pattern === 'speckled' ? colours.slice(0, 1) : colours
    squares.push({
      id,
      construction,
      yarnId,
      yarnLabel: titleFor(yarnLookup.schema, yarn),
      colours,
      pattern,
      candidates: offered.map((rgb) => ({ rgb, hue: hue(rgb), lstar: lstar(rgb) })),
      neutral: offered.every((rgb) => saturation(rgb) < 0.08),
    })
  }

  return { squares, constructions: [options[0], options[1]], skipped }
}

// ---------------------------------------------------------------------------------------------
// Rank scales
// ---------------------------------------------------------------------------------------------

/**
 * A weighted empirical CDF: where a value ranks among all the candidate colours, 0..1. Each square
 * carries a total weight of one split across its candidates, so a five-colour print does not count
 * five times towards where the other squares land.
 */
class RankScale {
  private readonly entries: { value: number; weight: number }[]
  private readonly total: number

  constructor(entries: { value: number; weight: number }[]) {
    this.entries = [...entries].sort((a, b) => a.value - b.value)
    this.total = entries.reduce((sum, e) => sum + e.weight, 0)
  }

  /** Mid-rank, so a value shared by many squares sits at the middle of its run, not its start. */
  rank(value: number): number {
    let below = 0
    let equal = 0
    for (const e of this.entries) {
      if (e.value < value) below += e.weight
      else if (e.value === value) equal += e.weight
    }
    return (below + equal / 2) / this.total
  }

  /** The value at a given rank — the inverse, for drawing what each column and row stands for. */
  valueAt(q: number): number {
    const target = q * this.total
    let cumulative = 0
    for (const e of this.entries) {
      cumulative += e.weight
      if (cumulative >= target) return e.value
    }
    return this.entries[this.entries.length - 1]?.value ?? 0
  }
}

/** The hue that starts the axis: the first one after the widest gap round the colour wheel. */
function hueCut(hues: number[]): number {
  const sorted = [...new Set(hues)].sort((a, b) => a - b)
  if (sorted.length < 2) return 0
  let bestGap = sorted[0] + 360 - sorted[sorted.length - 1]
  let cut = sorted[0]
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1]
    if (gap > bestGap) {
      bestGap = gap
      cut = sorted[i]
    }
  }
  return cut
}

// ---------------------------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------------------------

/**
 * Minimum-cost assignment of rows to columns (Hungarian algorithm, Kuhn–Munkres with potentials,
 * O(n²m)). Needs rows <= columns; returns the column each row gets. Hand-written for the same reason
 * as the PDF writer: it is forty lines, and the alternative is a dependency for one script.
 */
function hungarian(cost: number[][]): number[] {
  const n = cost.length
  const m = cost[0]?.length ?? 0
  if (n > m) throw new Error('hungarian: more rows than columns')
  // 1-indexed with a sentinel column 0, as in the textbook formulation.
  const u = new Array<number>(n + 1).fill(0)
  const v = new Array<number>(m + 1).fill(0)
  const p = new Array<number>(m + 1).fill(0)
  const way = new Array<number>(m + 1).fill(0)
  for (let i = 1; i <= n; i++) {
    p[0] = i
    let j0 = 0
    const minv = new Array<number>(m + 1).fill(Infinity)
    const used = new Array<boolean>(m + 1).fill(false)
    do {
      used[j0] = true
      const i0 = p[j0]
      let delta = Infinity
      let j1 = 0
      for (let j = 1; j <= m; j++) {
        if (used[j]) continue
        const cur = cost[i0 - 1][j - 1] - u[i0] - v[j]
        if (cur < minv[j]) {
          minv[j] = cur
          way[j] = j0
        }
        if (minv[j] < delta) {
          delta = minv[j]
          j1 = j
        }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]] += delta
          v[j] -= delta
        } else {
          minv[j] -= delta
        }
      }
      j0 = j1
    } while (p[j0] !== 0)
    do {
      const j1 = way[j0]
      p[j0] = p[j1]
      j0 = j1
    } while (j0 !== 0)
  }
  const result = new Array<number>(n).fill(-1)
  for (let j = 1; j <= m; j++) if (p[j] !== 0) result[p[j] - 1] = j - 1
  return result
}

interface Target {
  /** Grid units: column 0..size from the left, row 0..size from the top. */
  x: number
  y: number
  candidate: Candidate
}

interface Placement {
  square: Square
  row: number
  col: number
  /** The candidate colour this square was placed for — the nearest one to its cell. */
  nearest: Candidate
}

interface Layout {
  placements: Placement[]
  /** Squares left over because their construction had more squares than checker cells. */
  overflow: Square[]
  /** Which construction the cells with (row + col) even are given. */
  evenConstruction: string
  totalCost: number
}

/** Squared distance from a cell centre to a square's nearest target, plus which target that was. */
function cellCost(targets: Target[], row: number, col: number): { cost: number; target: Target } {
  let best = { cost: Infinity, target: targets[0] }
  for (const t of targets) {
    const cost = (t.x - (col + 0.5)) ** 2 + (t.y - (row + 0.5)) ** 2
    if (cost < best.cost) best = { cost, target: t }
  }
  return best
}

function layOut(
  squares: Square[],
  targets: Map<Square, Target[]>,
  constructions: [string, string],
  size: number,
  evenConstruction: string,
): Layout {
  const placements: Placement[] = []
  const overflow: Square[] = []
  let totalCost = 0

  for (const construction of constructions) {
    const group = squares.filter((s) => s.construction === construction)
    const parity = construction === evenConstruction ? 0 : 1
    const cells: { row: number; col: number }[] = []
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) if ((row + col) % 2 === parity) cells.push({ row, col })
    }
    if (group.length === 0) continue

    const cost = group.map((s) => cells.map((c) => cellCost(targets.get(s)!, c.row, c.col).cost))
    let squareToCell: number[]
    if (group.length <= cells.length) {
      squareToCell = hungarian(cost)
    } else {
      // More squares than cells: match the other way round, so every cell gets its best square and
      // the rest are reported rather than silently dropped.
      const transposed = cells.map((_, j) => group.map((_, i) => cost[i][j]))
      const cellToSquare = hungarian(transposed)
      squareToCell = new Array<number>(group.length).fill(-1)
      cellToSquare.forEach((i, j) => (squareToCell[i] = j))
    }

    squareToCell.forEach((j, i) => {
      const square = group[i]
      if (j < 0) {
        overflow.push(square)
        return
      }
      const { row, col } = cells[j]
      const { cost: c, target } = cellCost(targets.get(square)!, row, col)
      totalCost += c
      placements.push({ square, row, col, nearest: target.candidate })
    })
  }

  return { placements, overflow, evenConstruction, totalCost }
}

// ---------------------------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------------------------

const INK: Rgb = [0.13, 0.13, 0.15]
const MUTED: Rgb = [0.45, 0.45, 0.48]
const HAIRLINE: Rgb = [0.35, 0.35, 0.38]
const EMPTY_SOLID: Rgb = [0.9, 0.9, 0.92]
const EMPTY_HOLEY: Rgb = [0.97, 0.97, 0.98]
const WHITE: Rgb = [1, 1, 1]

const TITLE = 'Blanket layout'

/** Fleck positions as fractions of the cell, fixed so the same yarn speckles the same way each run. */
const FLECKS: ReadonlyArray<readonly [number, number]> = [
  [0.2, 0.25],
  [0.7, 0.18],
  [0.45, 0.55],
  [0.82, 0.62],
  [0.15, 0.78],
  [0.6, 0.85],
  [0.32, 0.4],
  [0.88, 0.35],
]

/** The yarn itself, drawn the way the app draws its swatches: flat, speckled, or equal stripes. */
function drawYarn(doc: PdfDoc, square: Square, x: number, y: number, s: number): void {
  const [base, ...rest] = square.colours
  if (rest.length === 0 || square.pattern === 'speckled') {
    doc.setFill(base)
    doc.rect(x, y, s, s)
    rest.forEach((rgb, i) => {
      doc.setFill(rgb)
      for (let k = i; k < FLECKS.length; k += rest.length) {
        const [fx, fy] = FLECKS[k]
        doc.circle(x + fx * s, y + fy * s, s * 0.05)
      }
    })
    return
  }
  const w = s / square.colours.length
  square.colours.forEach((rgb, i) => {
    doc.setFill(rgb)
    // A hair of overlap so no paper-white seam shows between stripes in a viewer that anti-aliases.
    doc.rect(x + i * w, y, w + (i < square.colours.length - 1 ? 0.2 : 0), s)
  })
}

function render(
  layout: Layout,
  size: number,
  hueScale: RankScale,
  cut: number,
  lightScale: RankScale,
  constructions: [string, string],
  holeyConstruction: string,
  subtitle: string[],
  printNote: string,
): PdfDoc {
  // US Letter portrait, 72pt to the inch: a square blanket fits the page's width.
  const width = 612
  const height = 792
  const gridX = 70
  const gridW = width - gridX - 30
  const cell = gridW / size

  // Subtitle items wrap greedily to the grid's width, so any mix of options fits the page.
  const separator = '   ·   '
  const lines: string[] = []
  for (const item of subtitle) {
    const last = lines[lines.length - 1]
    if (last !== undefined && measureText(last + separator + item, 8) <= gridW) {
      lines[lines.length - 1] = last + separator + item
    } else {
      lines.push(item)
    }
  }

  // The grid starts below however many lines the subtitle took, so more options push it down
  // rather than into the hue strip. Every option at once is four lines, which still fits a page.
  const gridTop = height - 92 - lines.length * 11
  const gridY = gridTop - gridW
  const doc = new PdfDoc(width, height)
  const gutter = Math.max(0.5, cell * 0.03)
  const holeR = cell * 0.17

  doc.setFill(WHITE)
  doc.rect(0, 0, width, height)

  doc.setFill(INK)
  doc.text(gridX, height - 36, TITLE, 13, true)
  doc.setFill(MUTED)
  lines.forEach((line, i) => doc.text(gridX, height - 50 - i * 11, line, 8))

  const cellOrigin = (row: number, col: number): [number, number] => [
    gridX + col * cell,
    // PDF's origin is bottom-left; row 0 is the top of the blanket.
    gridTop - (row + 1) * cell,
  ]

  // Hue strip: the actual hue each column stands for, since the rank scale stretches the axis.
  for (let col = 0; col < size; col++) {
    const h = (hueScale.valueAt((col + 0.5) / size) + cut) % 360
    doc.setFill(hueToRgb(h))
    doc.rect(gridX + col * cell + gutter / 2, gridTop + 6, cell - gutter, 8)
  }
  doc.setFill(MUTED)
  doc.text(gridX, gridTop + 20, 'hue, ranked', 7)

  // Lightness strip down the left: the grey of each row's L*.
  for (let row = 0; row < size; row++) {
    const l = lightScale.valueAt(1 - (row + 0.5) / size)
    doc.setFill(greyAtLstar(l))
    doc.rect(gridX - 14, gridTop - (row + 1) * cell + gutter / 2, 8, cell - gutter)
    if (row % 4 === 0 || row === size - 1) {
      const text = String(Math.round(l))
      doc.setFill(MUTED)
      doc.text(gridX - 18 - measureText(text, 6), gridTop - (row + 0.5) * cell - textAscent(6) / 2, text, 6)
    }
  }
  doc.setFill(MUTED)
  doc.text(gridX - 54, gridTop + 6, 'L* lighter', 7)
  doc.text(gridX - 54, gridY - 12, 'L* darker', 7)

  // Empty cells first, so the checker shows where the blanket still has room.
  const placed = new Map(layout.placements.map((p) => [`${p.row},${p.col}`, p]))
  doc.setLineWidth(0.4)
  for (let row = 0; row < size; row++) {
    for (let col = 0; col < size; col++) {
      if (placed.has(`${row},${col}`)) continue
      const [x, y] = cellOrigin(row, col)
      const holey = ((row + col) % 2 === 0) === (layout.evenConstruction === holeyConstruction)
      doc.setFill(holey ? EMPTY_HOLEY : EMPTY_SOLID)
      doc.rect(x + gutter / 2, y + gutter / 2, cell - gutter, cell - gutter)
      if (holey) {
        doc.setStroke(EMPTY_SOLID)
        doc.circle(x + cell / 2, y + cell / 2, holeR, 'stroke')
      }
    }
  }

  for (const p of layout.placements) {
    const [x, y] = cellOrigin(p.row, p.col)
    drawYarn(doc, p.square, x + gutter / 2, y + gutter / 2, cell - gutter)
    // The hole reads as "holey" at a glance without a legend lookup, and shows paper through it the
    // way the real motif would show whatever is behind the blanket.
    if (p.square.construction === holeyConstruction) {
      doc.setFill(WHITE)
      doc.setStroke(HAIRLINE)
      doc.setLineWidth(0.3)
      doc.circle(x + cell / 2, y + cell / 2, holeR, 'both')
    }
    const lightness = p.square.colours.reduce((sum, rgb) => sum + lstar(rgb), 0) / p.square.colours.length
    const label = p.square.id
    const labelSize = Math.min(5, cell * 0.2)
    doc.setFill(lightness > 55 ? INK : WHITE)
    doc.text(x + (cell - measureText(label, labelSize)) / 2, y + gutter + 1.2, label, labelSize)
  }

  // Legend.
  const legendY = gridY - 40
  const swatch = 14
  const items: { label: string; holey: boolean; empty: boolean }[] = [
    { label: `${holeyConstruction} square (hole marker)`, holey: true, empty: false },
    { label: `${constructions.find((c) => c !== holeyConstruction)} square`, holey: false, empty: false },
    { label: 'empty cell, by the construction it awaits', holey: true, empty: true },
  ]
  let lx = gridX
  for (const item of items) {
    if (item.empty) {
      doc.setFill(EMPTY_SOLID)
      doc.rect(lx, legendY, swatch, swatch)
      doc.setFill(EMPTY_HOLEY)
      doc.rect(lx + swatch + 2, legendY, swatch, swatch)
      doc.setStroke(EMPTY_SOLID)
      doc.setLineWidth(0.4)
      doc.circle(lx + swatch * 1.5 + 2, legendY + swatch / 2, swatch * 0.17, 'stroke')
      lx += swatch + 2
    } else {
      doc.setFill(MUTED)
      doc.rect(lx, legendY, swatch, swatch)
      if (item.holey) {
        doc.setFill(WHITE)
        doc.setStroke(HAIRLINE)
        doc.setLineWidth(0.3)
        doc.circle(lx + swatch / 2, legendY + swatch / 2, swatch * 0.17, 'both')
      }
    }
    doc.setFill(INK)
    doc.text(lx + swatch + 5, legendY + 4, item.label, 7.5)
    lx += swatch + 5 + measureText(item.label, 7.5) + 18
  }

  doc.setFill(MUTED)
  const notes = [
    'Columns and rows are ranked, not linear: each holds an equal share of the squares, and the strips',
    `show the real hue and lightness at each. ${printNote}`,
  ]
  notes.forEach((line, i) => doc.text(gridX, legendY - 18 - i * 10, line, 7))

  return doc
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------

/** Mulberry32: a tiny seeded PRNG, so `--seed 3` draws the same layout on every run and machine. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items]
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

function rgbHex(rgb: Rgb): string {
  return `#${rgb.map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('')}`
}

function main(): void {
  const args = process.argv.slice(2)
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name)
    return i >= 0 ? args[i + 1] : undefined
  }
  const size = Number(flag('--size') ?? 20)
  if (!Number.isInteger(size) || size < 2) throw new Error('--size must be a whole number of at least 2')
  const seedArg = flag('--seed')
  const seed = seedArg === undefined ? undefined : Number(seedArg)
  if (seed !== undefined && !Number.isInteger(seed)) throw new Error('--seed must be a whole number')
  // How far, in cells, a seed may nudge each target. Half a cell keeps every square in the colour
  // neighbourhood it belongs to while still letting near-equal arrangements trade places.
  const jitter = Number(flag('--jitter') ?? 0.5)
  if (!(jitter >= 0)) throw new Error('--jitter must be a number of cells, 0 or more')
  const defaultName = seed === undefined ? 'blanket-layout.pdf' : `blanket-layout-seed${seed}.pdf`
  const outPath = flag('--out') ?? join(repoRoot, 'out', defaultName)
  const csvPath = outPath.replace(/\.pdf$/i, '') + '.csv'

  const loaded = loadSquares()
  const { constructions, skipped } = loaded
  // A seed reorders the squares too, so exact ties between interchangeable squares (same yarn,
  // same construction) break differently — which square id lands in which of their cells.
  const random = seed === undefined ? undefined : seededRandom(seed)
  const squares = random ? shuffle(loaded.squares, random) : loaded.squares
  if (squares.length === 0) throw new Error('no squares with both a main colour and a construction type')

  const allCandidates = squares.flatMap((s) => s.candidates)
  const cut = hueCut(allCandidates.map((c) => c.hue))
  const shifted = (h: number): number => (h - cut + 360) % 360
  const weighted = (value: (c: Candidate) => number) =>
    squares.flatMap((s) => s.candidates.map((c) => ({ value: value(c), weight: 1 / s.candidates.length })))
  const hueScale = new RankScale(weighted((c) => shifted(c.hue)))
  const lightScale = new RankScale(weighted((c) => c.lstar))

  const targets = new Map<Square, Target[]>()
  for (const s of squares) {
    targets.set(
      s,
      s.candidates.map((candidate) => ({
        x: hueScale.rank(shifted(candidate.hue)) * size,
        // Lightest at the top.
        y: (1 - lightScale.rank(candidate.lstar)) * size,
        candidate,
      })),
    )
  }

  // Without a seed the matching sees the true targets and returns the single best layout. With
  // one, every target is nudged a little first: many layouts are within a hair of the best (a print
  // yarn could sit by either of its colours, two blocks could trade a column), and the nudge is
  // what lets one of those win instead. The layout is still scored against the true targets below.
  const matchTargets = random
    ? new Map(
        [...targets].map(([s, ts]) => [
          s,
          ts.map((t) => ({ ...t, x: t.x + (random() * 2 - 1) * jitter, y: t.y + (random() * 2 - 1) * jitter })),
        ]),
      )
    : targets

  // Either corner of the checkerboard could start with either construction; keep whichever lets
  // the squares sit closer to their colours. Ties keep the schema's first option in the corner.
  const [a, b] = constructions
  const layouts = [a, b].map((even) => layOut(squares, matchTargets, constructions, size, even))
  const chosen = layouts[1].totalCost < layouts[0].totalCost ? layouts[1] : layouts[0]
  const rescored = chosen.placements.map((p) => {
    const { cost, target } = cellCost(targets.get(p.square)!, p.row, p.col)
    return { placement: { ...p, nearest: target.candidate }, cost }
  })
  const layout: Layout = {
    ...chosen,
    placements: rescored.map((r) => r.placement),
    totalCost: rescored.reduce((sum, r) => sum + r.cost, 0),
  }

  const holey = constructions.includes('holey') ? 'holey' : constructions[1]
  const counts = constructions.map((c) => `${squares.filter((s) => s.construction === c).length} ${c}`)
  const generatedAt = new Date().toISOString().slice(0, 10)
  const subtitle = [
    `${layout.placements.length} of ${size * size} squares placed (${counts.join(', ')})`,
    'construction checkered',
    'main colour: hue across, lightness down',
    seed === undefined ? 'best fit' : `seed ${seed}`,
    generatedAt,
  ]
  const printNote = 'A print yarn sits near whichever of its colours is closest.'

  const doc = render(layout, size, hueScale, cut, lightScale, constructions, holey, subtitle, printNote)
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, doc.toBuffer())

  // Positions as a CSV too, 1-based like a crocheter counts, so the layout can be read off without
  // squinting at the PDF — or pasted into `position` once the blanket is actually being joined.
  const sorted = [...layout.placements].sort((p, q) => p.row - q.row || p.col - q.col)
  const csv = [
    'row,col,square,construction,main_yarn,yarn,placed_for_colour',
    ...sorted.map((p) =>
      [p.row + 1, p.col + 1, p.square.id, p.square.construction, p.square.yarnId, p.square.yarnLabel, rgbHex(p.nearest.rgb)]
        .map((v) => csvCell(String(v)))
        .join(','),
    ),
  ].join('\n')
  writeFileSync(csvPath, csv + '\n')

  const capacity = (size * size) / 2
  const prints = squares.filter((s) => s.candidates.length > 1).length
  const neutrals = squares.filter((s) => s.neutral).length
  const rms = Math.sqrt(layout.totalCost / Math.max(1, layout.placements.length))
  console.log(`placed ${layout.placements.length} squares on a ${size}x${size} grid (${counts.join(', ')})`)
  console.log(`${prints} on print yarns (placed near any of their colours), ${neutrals} near-neutral`)
  console.log(`hue axis starts at ${Math.round(cut)}°; ${layout.evenConstruction} in the top-left corner`)
  console.log(
    `average distance from target colour: ${rms.toFixed(2)} cells (root mean square)` +
      (seed === undefined ? '' : `, seed ${seed} with targets nudged up to ${jitter} cell`),
  )
  console.log(
    `skipped: ${skipped.noMainYarn.length} no main colour, ${skipped.noColour.length} main yarn has no colour, ` +
      `${skipped.noConstruction.length} no construction type`,
  )
  if (layout.overflow.length > 0) {
    console.warn(
      `warning: ${layout.overflow.length} square(s) did not fit — only ${capacity} cells of each construction: ` +
        layout.overflow.map((s) => s.id).join(', '),
    )
  }
  console.log(`-> ${outPath}`)
  console.log(`-> ${csvPath}`)
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
