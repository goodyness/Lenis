// Prerender script: generates static HTML for the landing page at build time.
// Run after `vite build` and `vite build --ssr src/entry-server.tsx`.
// Usage: node prerender.js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const toPrerender = ['/']

async function run() {
  const template = fs.readFileSync(
    path.resolve(__dirname, 'dist/client/index.html'),
    'utf-8',
  )

  const { render } = await import('./dist/server/entry-server.js')

  for (const url of toPrerender) {
    const appHtml = render(url)
    const html = template.replace('<!--app-html-->', appHtml)

    const filePath =
      url === '/'
        ? path.resolve(__dirname, 'dist/client/index.html')
        : path.resolve(__dirname, `dist/client${url}/index.html`)

    const dir = path.dirname(filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }

    fs.writeFileSync(filePath, html)
    console.log(`Pre-rendered: ${url} -> ${filePath}`)
  }
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})
