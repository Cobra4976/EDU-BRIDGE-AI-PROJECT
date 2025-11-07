import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { register } from './utils/serviceWorkerRegistration.js'
import { registerServiceWorker } from './utils/pwaHelpers'

registerServiceWorker();
createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
register()
