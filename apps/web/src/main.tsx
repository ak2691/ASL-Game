import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './themes/pixel.css'
import './themes/cartoon.css'

// Visual theme: ?theme=pixel, ?theme=cartoon or ?theme=classic (remembered). Cartoon is the default.
const THEMES = ['pixel', 'cartoon', 'classic']
let theme = new URLSearchParams(location.search).get('theme')
try {
  if (theme && THEMES.includes(theme)) localStorage.setItem('theme', theme)
  else theme = localStorage.getItem('theme')
} catch {
  /* ignore */
}
document.documentElement.dataset.theme = theme && THEMES.includes(theme) ? theme : 'cartoon'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
