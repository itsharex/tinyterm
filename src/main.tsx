import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

function removeBootSplash(minDelay = 400) {
  const splash = document.getElementById('boot-splash')
  if (!splash) return

  const bootAt = (window as any).__BOOT_AT__ ?? 0
  const elapsed = performance.now() - bootAt
  const remaining = Math.max(0, minDelay - elapsed)

  setTimeout(() => {
    splash.style.transition = 'opacity 0.25s ease'
    splash.style.opacity = '0'
    setTimeout(() => splash.remove(), 250)
  }, remaining)
}

// Disable default context menu in production
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault()
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
)

removeBootSplash()
