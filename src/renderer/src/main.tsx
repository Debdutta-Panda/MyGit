import React from 'react'
import ReactDOM from 'react-dom/client'
import '@mantine/core/styles.css'
import './styles.css'
import { MantineProvider } from '@mantine/core'
import { App } from './App'
import { theme } from './theme'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <MantineProvider theme={theme} defaultColorScheme="dark">
      <App />
    </MantineProvider>
  </React.StrictMode>,
)
