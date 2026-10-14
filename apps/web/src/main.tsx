import { StrictMode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { Toaster } from 'sonner'
import './index.css'
import { router } from './App'
import { setSessionHandler } from './lib/api'
import { queryClient } from './lib/query'
import { useAuthStore } from './stores/auth'
import { initTheme } from './stores/ui'

initTheme()
setSessionHandler((user) => useAuthStore.getState().handleSession(user))
void useAuthStore.getState().bootstrap()

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster richColors position="bottom-right" closeButton />
    </QueryClientProvider>
  </StrictMode>,
)
