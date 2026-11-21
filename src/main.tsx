import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'

/** ?reset=1: wipe this browser's KhataBhai data (ledger + settings), then load the app empty. */
async function resetIfAsked(): Promise<boolean> {
  if (!new URLSearchParams(location.search).has('reset')) return false
  try { localStorage.clear(); sessionStorage.clear() } catch { /* storage blocked */ }
  await new Promise<void>((done) => {
    const del = indexedDB.deleteDatabase('voice-khata')
    del.onsuccess = del.onerror = () => done()
    // other open tabs close their copy on 'versionchange'; never wait forever on one that doesn't
    del.onblocked = () => setTimeout(done, 1500)
  })
  location.replace(location.pathname)
  return true
}

// the app (and its ledger connection) loads only after any reset is done
void resetIfAsked().then(async (resetting) => {
  if (resetting) return
  const { default: App } = await import('./App.tsx')
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
