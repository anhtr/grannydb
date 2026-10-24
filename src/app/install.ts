import { appStore } from '../core/store'

/**
 * Chromium's install prompt. Not in the DOM lib types because it is not a standard; Safari and
 * Firefox have no equivalent, which is why `InstallState` has a `manual` case.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null

/** Running from the home screen rather than a tab. `navigator.standalone` is iOS's older spelling. */
function isStandalone(): boolean {
  const iosStandalone = (navigator as Navigator & { standalone?: boolean }).standalone === true
  if (iosStandalone) return true
  return typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches
}

/**
 * Hold on to the browser's install prompt so Settings can offer it, instead of the browser's own
 * mini-infobar appearing over the nav at a moment of its choosing.
 */
export function watchInstall(): () => void {
  if (typeof window === 'undefined') return () => {}
  if (isStandalone()) appStore.setInstall('installed')

  const onPrompt = (event: Event): void => {
    event.preventDefault()
    deferred = event as BeforeInstallPromptEvent
    appStore.setInstall('available')
  }
  const onInstalled = (): void => {
    deferred = null
    appStore.setInstall('installed')
  }

  window.addEventListener('beforeinstallprompt', onPrompt)
  window.addEventListener('appinstalled', onInstalled)
  return () => {
    window.removeEventListener('beforeinstallprompt', onPrompt)
    window.removeEventListener('appinstalled', onInstalled)
  }
}

/** Show the browser's install dialog. A prompt can be used once, accepted or not. */
export async function promptInstall(): Promise<void> {
  const prompt = deferred
  if (!prompt) return
  deferred = null
  await prompt.prompt()
  const { outcome } = await prompt.userChoice
  // `appinstalled` reports success; a dismissal means this browser will not offer again soon.
  if (outcome === 'dismissed') appStore.setInstall('manual')
}
