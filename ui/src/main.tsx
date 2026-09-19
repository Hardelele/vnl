import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'

import { App } from './App'
import { startTheme } from './state/theme'
import './styles/theme.css'

// Тема -- до первой отрисовки: иначе светлый экран моргнёт тёмным.
startTheme()

const root = document.getElementById('root')
if (!root) throw new Error('нет контейнера #root')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
