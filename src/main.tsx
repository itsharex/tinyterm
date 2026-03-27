import ReactDOM from 'react-dom/client'
import App from './App'
import './styles/global.css'

// Disable default context menu in production
if (import.meta.env.PROD) {
  document.addEventListener('contextmenu', (e) => {
    e.preventDefault()
  })
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <App />,
)
