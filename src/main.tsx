import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import { applyTheme } from './app/theme'
import { loadPrefs } from './core/prefs'
import { appStore } from './core/store'
import './styles.css'

const root = document.getElementById('root')
if (!root) throw new Error('No #root element in index.html')

// Before the first render, and read straight from storage: the store has not been initialised yet,
// and waiting for it would paint one frame in the wrong palette.
let theme = loadPrefs().theme
applyTheme(theme)
appStore.subscribe(() => {
  const next = appStore.getState().prefs.theme
  if (next === theme) return
  theme = next
  applyTheme(next)
})

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
