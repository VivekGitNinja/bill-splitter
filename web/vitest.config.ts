import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    // Component tests run in jsdom; api.test.ts opts into the node
    // environment with a `// @vitest-environment node` comment.
    environment: 'jsdom',
  },
})
