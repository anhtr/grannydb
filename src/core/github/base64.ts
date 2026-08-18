/**
 * UTF-8 text (or raw bytes) to base64, which is what the Git blob API wants.
 *
 * Chunked because `String.fromCharCode(...bytes)` blows the argument limit somewhere around
 * 100 KB, and a 400-row CSV plus future photos will pass that.
 */
export function toBase64(input: string | Uint8Array): string {
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input
  const CHUNK = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}
