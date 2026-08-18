import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

// Chrome can fire 'beforeinstallprompt' the instant the page loads — often
// before React has mounted and useInstallPrompt's listener is attached.
// Capture it globally, immediately, so the hook can pick it up whenever it
// mounts instead of missing the one-time event.
window.__deferredInstallPrompt = null
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault()
  window.__deferredInstallPrompt = e
  window.dispatchEvent(new Event('__installPromptReady'))
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Registered after mount, and any failure here is caught and ignored — the
// service worker only unlocks "Install app"; it should never be able to
// break the app itself if registration fails for any reason.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {})
  })
}
