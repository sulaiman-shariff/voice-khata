import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// ?reset=1: start from an empty ledger (wipes this browser's KhataBhai data, then reloads)
if (new URLSearchParams(location.search).has('reset')) {
  try { localStorage.clear(); sessionStorage.clear() } catch { /* storage blocked */ }
  const del = indexedDB.deleteDatabase('voice-khata')
  del.onsuccess = del.onerror = del.onblocked = () => location.replace(location.pathname)
  throw new Error('resetting') // stop here; the page reloads empty
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
