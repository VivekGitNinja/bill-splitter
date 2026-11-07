import { createRootRoute, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => <Outlet />,
  errorComponent: ({ error }) => (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Something went wrong</h1>
      <p role="alert">{error instanceof Error ? error.message : 'An unexpected error occurred.'}</p>
      <p>
        <a href="/">Back to the bill splitter</a>
      </p>
    </main>
  ),
  notFoundComponent: () => (
    <main style={{ padding: 24, fontFamily: 'system-ui, sans-serif' }}>
      <h1>Page not found</h1>
      <p>This page does not exist.</p>
      <p>
        <a href="/">Back to the bill splitter</a>
      </p>
    </main>
  ),
})
