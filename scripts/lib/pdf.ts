/**
 * A minimal PDF writer, enough for one page of vector shapes and text.
 *
 * Hand-rolled rather than added as a dependency: the repo carries no PDF library, this needs only
 * the handful of operators below, and a build-time script pulling in a transitive dependency tree
 * to draw circles is a poor trade. It is deliberately not general — one page, one content stream,
 * the two base-14 Helvetica faces, no compression.
 *
 * The one part that has to be exact is `measureText`. Label placement can only promise "no
 * overlaps" if it knows how wide a string actually renders, so the Helvetica advance widths from
 * the Adobe AFM files are embedded below rather than approximated by a character count.
 */

/** RGB in 0..1, the range PDF's `rg`/`RG` operators take. */
export type Rgb = readonly [number, number, number]

/**
 * Adobe Helvetica advance widths, 1/1000 em, for the printable ASCII range (32..126) in order.
 * Helvetica-Bold differs, so both are kept — a title measured with the regular table would be
 * under-measured and could collide.
 */
// prettier-ignore
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
]

// prettier-ignore
const HELVETICA_BOLD_WIDTHS = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
]

/**
 * Helvetica widths for WinAnsi 160..255 — the Latin-1 block. Included so an accented colourway name
 * measures and prints correctly instead of degrading to "?", and so the degree and middle-dot signs
 * the axis labels use are real glyphs. Bold differs slightly up here, but the only bold text is the
 * ASCII title, so one table serves both.
 */
// prettier-ignore
const LATIN1_WIDTHS = [
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500,
]

/**
 * Characters WinAnsi places in 128..159, where Latin-1 has control codes. Only the punctuation that
 * plausibly turns up in a pasted colourway name — curly quotes, dashes — plus their widths.
 */
const WIN_ANSI_PUNCTUATION: Record<string, readonly [number, number]> = {
  '…': [0x85, 1000],
  '‘': [0x91, 222],
  '’': [0x92, 222],
  '“': [0x93, 333],
  '”': [0x94, 333],
  '•': [0x95, 350],
  '–': [0x96, 556],
  '—': [0x97, 1000],
}

/** The WinAnsi byte and advance width for one character, or undefined if it has no glyph. */
function glyph(ch: string, bold: boolean): readonly [number, number] | undefined {
  const code = ch.codePointAt(0) ?? 32
  if (code >= 32 && code <= 126) {
    const widths = bold ? HELVETICA_BOLD_WIDTHS : HELVETICA_WIDTHS
    return [code, widths[code - 32]]
  }
  if (code >= 160 && code <= 255) return [code, LATIN1_WIDTHS[code - 160]]
  return WIN_ANSI_PUNCTUATION[ch]
}

/** Width of `text` in points at `size`, from the embedded AFM tables. */
export function measureText(text: string, size: number, bold = false): number {
  let total = 0
  for (const ch of text) {
    // Anything with no glyph is drawn as "?" by `escapeText`, so measure it as one too.
    total += (glyph(ch, bold) ?? glyph('?', bold)!)[1]
  }
  return (total * size) / 1000
}

/** Cap height of Helvetica, 1/1000 em — the visual top of an uppercase glyph. */
const CAP_HEIGHT = 0.717
/** Descender depth, 1/1000 em, so a label box covers the tail of a "y" or "g". */
const DESCENDER = 0.207

/** Height a single line of text occupies, ascender to descender, at `size`. */
export function textHeight(size: number): number {
  return (CAP_HEIGHT + DESCENDER) * size
}

/** How far the visual top of a line sits above its baseline. */
export function textAscent(size: number): number {
  return CAP_HEIGHT * size
}

/** How far the visual bottom of a line sits below its baseline. */
export function textDescent(size: number): number {
  return DESCENDER * size
}

/**
 * Escape a string for a PDF literal. Backslash and both parens are the only characters that break
 * the syntax. Bytes above ASCII are written as octal escapes rather than raw, so the stream stays
 * 7-bit and cannot be mangled by anything that touches it as text. Characters WinAnsiEncoding has
 * no glyph for become "?" — matching what `measureText` assumed.
 */
function escapeText(text: string, bold: boolean): string {
  let out = ''
  for (const ch of text) {
    if (ch === '\\' || ch === '(' || ch === ')') {
      out += `\\${ch}`
      continue
    }
    const code = glyph(ch, bold)?.[0] ?? '?'.charCodeAt(0)
    out += code <= 126 ? String.fromCharCode(code) : `\\${code.toString(8).padStart(3, '0')}`
  }
  return out
}

/** Trim float noise out of the content stream; PDF has no use for 15 decimal places. */
function n(value: number): string {
  return Number(value.toFixed(3)).toString()
}

/** Bezier constant for approximating a quarter circle with a cubic curve. */
const KAPPA = 0.5523

export class PdfDoc {
  private readonly ops: string[] = []

  constructor(
    readonly width: number,
    readonly height: number,
  ) {}

  setFill(rgb: Rgb): void {
    this.ops.push(`${n(rgb[0])} ${n(rgb[1])} ${n(rgb[2])} rg`)
  }

  setStroke(rgb: Rgb): void {
    this.ops.push(`${n(rgb[0])} ${n(rgb[1])} ${n(rgb[2])} RG`)
  }

  setLineWidth(w: number): void {
    this.ops.push(`${n(w)} w`)
  }

  /** Filled and/or stroked rectangle, origin bottom-left. */
  rect(x: number, y: number, w: number, h: number, mode: 'fill' | 'stroke' | 'both' = 'fill'): void {
    const paint = mode === 'fill' ? 'f' : mode === 'stroke' ? 'S' : 'B'
    this.ops.push(`${n(x)} ${n(y)} ${n(w)} ${n(h)} re ${paint}`)
  }

  line(x1: number, y1: number, x2: number, y2: number): void {
    this.ops.push(`${n(x1)} ${n(y1)} m ${n(x2)} ${n(y2)} l S`)
  }

  /** Circle as four cubic Beziers — PDF has no arc operator. */
  circle(cx: number, cy: number, r: number, mode: 'fill' | 'stroke' | 'both' = 'fill'): void {
    const k = r * KAPPA
    const paint = mode === 'fill' ? 'f' : mode === 'stroke' ? 'S' : 'B'
    this.ops.push(
      `${n(cx + r)} ${n(cy)} m`,
      `${n(cx + r)} ${n(cy + k)} ${n(cx + k)} ${n(cy + r)} ${n(cx)} ${n(cy + r)} c`,
      `${n(cx - k)} ${n(cy + r)} ${n(cx - r)} ${n(cy + k)} ${n(cx - r)} ${n(cy)} c`,
      `${n(cx - r)} ${n(cy - k)} ${n(cx - k)} ${n(cy - r)} ${n(cx)} ${n(cy - r)} c`,
      `${n(cx + k)} ${n(cy - r)} ${n(cx + r)} ${n(cy - k)} ${n(cx + r)} ${n(cy)} c`,
      paint,
    )
  }

  /** Draw `text` with its baseline starting at (x, y). */
  text(x: number, y: number, text: string, size: number, bold = false): void {
    const font = bold ? '/F2' : '/F1'
    this.ops.push(`BT ${font} ${n(size)} Tf ${n(x)} ${n(y)} Td (${escapeText(text, bold)}) Tj ET`)
  }

  /** Serialise to PDF bytes: objects, then the xref table their offsets index. */
  toBuffer(): Buffer {
    const content = this.ops.join('\n')
    const objects = [
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(this.width)} ${n(this.height)}] ` +
        '/Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>',
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    ]

    let pdf = '%PDF-1.4\n'
    const offsets: number[] = []
    for (const [i, body] of objects.entries()) {
      offsets.push(Buffer.byteLength(pdf, 'latin1'))
      pdf += `${i + 1} 0 obj\n${body}\nendobj\n`
    }

    const xrefOffset = Buffer.byteLength(pdf, 'latin1')
    pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
    for (const offset of offsets) {
      pdf += `${offset.toString().padStart(10, '0')} 00000 n \n`
    }
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`

    return Buffer.from(pdf, 'latin1')
  }
}
