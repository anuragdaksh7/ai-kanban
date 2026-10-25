import React from 'react'
import { createRoot } from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import './index.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <div className="h-full">
      <App />
      <Toaster theme="dark" richColors position="bottom-right" />
    </div>
  </React.StrictMode>,
)
