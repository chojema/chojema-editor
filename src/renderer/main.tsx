import { createRoot } from 'react-dom/client'
import 'katex/dist/katex.min.css'
import './tokens.css'
import './editor.css'
import './app.css'
import { App } from './App'

createRoot(document.getElementById('root')!).render(<App />)
