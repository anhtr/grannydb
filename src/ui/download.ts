/**
 * Hand the browser a piece of text to save as a file. The file is made here, in the page, from data
 * the app already holds: nothing is requested, so it works offline and needs no token.
 *
 * A temporary link is clicked because that is the only way to name a download. The object URL is
 * released on a timer rather than straight away: some browsers start reading it only after the click
 * handler has returned, and a URL revoked by then downloads nothing.
 */
export function downloadText(filename: string, text: string, type: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.style.display = 'none'
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
