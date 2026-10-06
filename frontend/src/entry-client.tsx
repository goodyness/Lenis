import { StrictMode } from 'react'
import { createRoot, hydrateRoot } from 'react-dom/client'
import { createBrowserRouter, RouterProvider } from 'react-router-dom'
import { ToastProvider } from './components/ui/Toaster'
import { ErrorBoundary } from './components/errors/ErrorBoundary'
import './index.css'
import App from './App'

// createBrowserRouter provides the data router context required by hooks such
// as useBlocker. A single splat route renders our existing <Routes>-based App,
// which handles all route matching internally.
const router = createBrowserRouter([
  { path: '*', element: <App /> },
])

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Root element not found')
}

const tree = (
  <StrictMode>
    <ErrorBoundary>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </ErrorBoundary>
  </StrictMode>
)

// Only hydrate when the server pre-rendered real DOM elements (landing page).
// querySelector returns null for comment nodes, so the <!--app-html--> template
// placeholder never triggers hydrateRoot on non-pre-rendered routes.
const hasServerContent = rootElement.querySelector('*') !== null

if (hasServerContent) {
  hydrateRoot(rootElement, tree)
} else {
  createRoot(rootElement).render(tree)
}
