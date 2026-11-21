import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { hideSplash } from './lib/native'
import { applySavedTheme } from './ui/theme'

applySavedTheme() // themed from the first paint, before the encrypted settings load

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
requestAnimationFrame(hideSplash) // splash goes after the first frame
