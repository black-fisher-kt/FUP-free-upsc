import { readdir, readFile, mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = join(projectRoot, 'dist')
const pages = JSON.parse(await readFile(join(projectRoot, 'src/seo-pages.json'), 'utf8'))
const template = await readFile(join(distRoot, 'index.html'), 'utf8')
const baseUrl = 'https://freeupsc.online'
const imageUrl = `${baseUrl}/og-image.png`

function escapeAttribute(value) {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;')
}

function escapeXml(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function setMeta(html, attribute, key, value) {
  const tagPattern = new RegExp(`<meta\\s+${attribute}=(['"])${escapeRegExp(key)}\\1[^>]*>`, 'i')
  const tag = `<meta ${attribute}="${escapeAttribute(key)}" content="${escapeAttribute(value)}" />`
  return tagPattern.test(html)
    ? html.replace(tagPattern, tag)
    : html.replace('</head>', `    ${tag}\n  </head>`)
}

function structuredData(page) {
  if (page.kind === 'website') {
    return {
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'FUP | Free UPSC Preparation', url: `${baseUrl}/` },
        {
          '@type': 'Organization',
          name: 'FUP - Free UPSC Preparation',
          url: `${baseUrl}/`,
          sameAs: [
            'https://t.me/upscfreecoursess',
            'https://discord.gg/qahMmrBuA',
            'https://www.reddit.com/r/upsciea/s/iknbD8nzMv',
          ],
        },
      ],
    }
  }
  if (page.kind === 'blogPosting') {
    return {
      '@context': 'https://schema.org',
      '@type': 'BlogPosting',
      headline: page.title,
      description: page.description,
      mainEntityOfPage: `${baseUrl}${page.path}`,
      datePublished: page.datePublished,
      dateModified: page.datePublished,
      author: { '@type': 'Organization', name: 'FUP' },
      publisher: { '@type': 'Organization', name: 'FUP', url: `${baseUrl}/` },
      image: imageUrl,
    }
  }
  return null
}

function withSeo(templateHtml, page) {
  const canonicalUrl = `${baseUrl}${page.path}`
  let html = templateHtml.replace(/<title>[\s\S]*?<\/title>/i, `<title>${escapeAttribute(page.title)}</title>`)
  html = setMeta(html, 'name', 'description', page.description)
  html = setMeta(html, 'property', 'og:type', page.kind === 'blogPosting' ? 'article' : 'website')
  html = setMeta(html, 'property', 'og:url', canonicalUrl)
  html = setMeta(html, 'property', 'og:site_name', 'FUP | Free UPSC Preparation')
  html = setMeta(html, 'property', 'og:title', page.title)
  html = setMeta(html, 'property', 'og:description', page.description)
  html = setMeta(html, 'property', 'og:image', imageUrl)
  html = setMeta(html, 'name', 'twitter:card', 'summary_large_image')
  html = setMeta(html, 'name', 'twitter:title', page.title)
  html = setMeta(html, 'name', 'twitter:description', page.description)
  html = setMeta(html, 'name', 'twitter:image', imageUrl)

  const canonicalTag = `<link rel="canonical" href="${escapeAttribute(canonicalUrl)}" />`
  const canonicalPattern = /<link\s+rel=(['"])canonical\1[^>]*>/i
  html = canonicalPattern.test(html)
    ? html.replace(canonicalPattern, canonicalTag)
    : html.replace('</head>', `    ${canonicalTag}\n  </head>`)

  const data = structuredData(page)
  const scriptTag = data
    ? `<script id="seo-structured-data" type="application/ld+json">${JSON.stringify(data).replaceAll('<', '\\u003c')}</script>`
    : ''
  const scriptPattern = /\s*<script\b(?=[^>]*type=(['"])application\/ld\+json\1)[^>]*>[\s\S]*?<\/script>/i
  html = scriptPattern.test(html)
    ? html.replace(scriptPattern, scriptTag)
    : scriptTag ? html.replace('</head>', `    ${scriptTag}\n  </head>`) : html
  return html
}

for (const page of pages) {
  const outputPath = page.path === '/'
    ? join(distRoot, 'index.html')
    : join(distRoot, page.path.replace(/^\/+|\/+$/g, ''), 'index.html')
  await mkdir(dirname(outputPath), { recursive: true })
  await writeFile(outputPath, withSeo(template, page))
}

async function findHtmlFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(entries.map(async entry => {
    const entryPath = join(directory, entry.name)
    if (entry.isDirectory()) return findHtmlFiles(entryPath)
    return entry.isFile() && entry.name.endsWith('.html') ? [entryPath] : []
  }))
  return files.flat()
}

const htmlFiles = await findHtmlFiles(distRoot)
const urls = []
for (const filePath of htmlFiles) {
  const filePathRelative = relative(distRoot, filePath).replaceAll('\\', '/')
  if (filePathRelative === '404.html') continue
  const html = await readFile(filePath, 'utf8')
  const canonical = html.match(/<link\s+rel=(['"])canonical\1\s+href=(['"])(.*?)\2/i)?.[3]
  if (!canonical) continue
  const lastmod = (await stat(filePath)).mtime.toISOString().slice(0, 10)
  urls.push({ canonical, lastmod })
}

urls.sort((first, second) => first.canonical.localeCompare(second.canonical))
const sitemap = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(({ canonical, lastmod }) => `  <url><loc>${escapeXml(canonical)}</loc><lastmod>${lastmod}</lastmod></url>`).join('\n')}\n</urlset>\n`
await writeFile(join(distRoot, 'sitemap.xml'), sitemap)
await writeFile(join(projectRoot, 'public/sitemap.xml'), sitemap)
console.log(`Generated ${urls.length} sitemap URLs from ${htmlFiles.length} HTML files.`)
