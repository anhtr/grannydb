/**
 * Colour maths shared by the analysis scripts (`plot-yarn-colours.ts`, `plot-blanket.ts`), so "how
 * light is this yarn" has one answer across every printout. Script-side only: the app draws hex
 * strings straight into CSS and never needs hue or lightness.
 */
import type { Rgb } from './pdf'

// Mirrors the (module-private) regex in src/core/schema/validate.ts. A yarn's `hex` is a colorlist,
// so "single colour" means exactly one valid entry once split — there is no separate flag for it.
export const HEX_RE = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function hexToRgb(hex: string): Rgb {
  const h = hex.slice(1)
  const full = h.length === 3 ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2] : h
  const v = parseInt(full, 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

/** HSV hue in degrees. Undefined for greys, where max === min; reported as 0. */
export function hue(rgb: Rgb): number {
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

/** HSV saturation, 0..1. */
export function saturation(rgb: Rgb): number {
  const max = Math.max(...rgb)
  return max === 0 ? 0 : (max - Math.min(...rgb)) / max
}

/** sRGB inverse companding: gamma-encoded channel to linear light. */
function linearise(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

/** sRGB companding, the inverse of `linearise`. */
function compand(c: number): number {
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

/** CIE L*, 0..100. Perceptual lightness under D65. */
export function lstar(rgb: Rgb): number {
  // Y of CIE XYZ; chromaticity does not enter into lightness.
  const y = 0.2126 * linearise(rgb[0]) + 0.7152 * linearise(rgb[1]) + 0.0722 * linearise(rgb[2])
  const f = y > 216 / 24389 ? Math.cbrt(y) : ((24389 / 27) * y) / 116 + 16 / 116
  return 116 * f - 16
}

/** The neutral grey with a given L* — for drawing a lightness scale that matches `lstar`. */
export function greyAtLstar(l: number): Rgb {
  const f = (l + 16) / 116
  const y = f ** 3 > 216 / 24389 ? f ** 3 : (116 * f - 16) / (24389 / 27)
  const c = Math.min(1, Math.max(0, compand(y)))
  return [c, c, c]
}

/** Fully saturated colour at a given hue, for legend strips. */
export function hueToRgb(deg: number): Rgb {
  const h = (((deg % 360) + 360) % 360) / 60
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
