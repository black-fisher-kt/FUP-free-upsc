import { readdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const distRoot = join(projectRoot, 'dist')
const siteUrl = 'https://freeupsc.online'
const seoPages = JSON.parse(await readFile(join(projectRoot, 'src/seo-pages.json'), 'utf8'))
const postsFile = join(projectRoot, 'public/posts.json')
const posts = await readPosts()
const manualArticles = await loadManualArticles()

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

async function readPosts() {
  try {
    const value = JSON.parse(await readFile(postsFile, 'utf8'))
    if (!Array.isArray(value)) throw new Error('public/posts.json must contain an array')
    return value
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

async function loadManualArticles() {
  const source = await readFile(join(projectRoot, 'src/data.ts'), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, { exports })
  if (!Array.isArray(exports.articles)) throw new Error('Could not load manual articles from src/data.ts')
  return exports.articles
}

function dateValue(value) {
  const timestamp = Date.parse(value)
  return Number.isNaN(timestamp) ? 0 : timestamp
}

function allPosts() {
  const dailyPosts = posts.map(post => ({
    title: post.title,
    excerpt: post.excerpt,
    date: post.date,
    href: post.href,
    publishedAt: post.publishedAt,
  }))
  const manualPosts = manualArticles.map(article => ({
    title: article.title,
    excerpt: article.excerpt,
    date: article.date,
    publishedAt: article.date,
    href: `/blog/${article.slug}/`,
  }))
  const byHref = new Map()
  for (const post of [...manualPosts, ...dailyPosts]) {
    if (post.href && post.title) byHref.set(post.href, post)
  }
  return [...byHref.values()].sort((first, second) =>
    dateValue(second.publishedAt || second.date) - dateValue(first.publishedAt || first.date)
      || first.title.localeCompare(second.title))
}

function internalLinks() {
  return `<nav aria-label="Main navigation">
    <a href="/">Home</a>
    <a href="/blog/">Journal</a>
    <a href="/about/">About FUP</a>
    <a href="/watchlist/">Watchlist</a>
    <a href="/privacy/">Privacy</a>
  </nav>`
}

function postList(items) {
  if (!items.length) return '<p>New UPSC preparation notes and current-affairs explainers will appear here.</p>'
  return `<ul>${items.map(post => `<li>
    <article>
      <h2><a href="${escapeHtml(post.href)}">${escapeHtml(post.title)}</a></h2>
      <p><time>${escapeHtml(post.date || '')}</time></p>
      <p>${escapeHtml(post.excerpt || '')}</p>
      <p><a href="${escapeHtml(post.href)}">Read article</a></p>
    </article>
  </li>`).join('\n')}</ul>`
}

function homeContent(page, articles) {
  return `<section class="page-hero">
    <p class="eyebrow">A better way to prepare</p>
    <h1>Free UPSC Preparation Resources</h1>
    <p class="page-intro">${escapeHtml(page.description)}</p>
    ${internalLinks()}
  </section>
  <section class="section">
    <h2>Latest UPSC Journal Notes</h2>
    ${postList(articles.slice(0, 5))}
    <p><a href="/blog/">Browse all journal posts</a></p>
  </section>
  <section class="section">
    <h2>Study resources</h2>
    <ul>
      <li><h3><a href="/watchlist/">Curated UPSC playlists</a></h3><p>Explore focused General Studies and current-affairs video playlists.</p></li>
      <li><h3><a href="/blog/ncert-reading-list/">NCERT reading list</a></h3><p>Find a subject-wise NCERT starting point for UPSC preparation.</p></li>
      <li><h3><a href="/watchlist/">Optional subjects</a></h3><p>Browse the optional-subject resource section in the watchlist.</p></li>
    </ul>
  </section>`
}

function blogContent(page, articles) {
  return `<section class="page-hero">
    <p class="eyebrow">The FUP journal</p>
    <h1>UPSC Preparation Journal</h1>
    <p class="page-intro">${escapeHtml(page.description)}</p>
    ${internalLinks()}
  </section>
  <section class="section blog-body">
    <h2>All journal posts</h2>
    ${postList(articles)}
  </section>`
}

function simplePageContent(page, pathname) {
  const linkBlock = `<section class="section"><h2>Explore FUP</h2>
    <ul>
      <li><a href="/">Free UPSC preparation resources</a></li>
      <li><a href="/blog/">Journal and current-affairs notes</a></li>
      <li><a href="/watchlist/">Video playlists, NCERT and optional subjects</a></li>
      <li><a href="/privacy/">Privacy policy</a></li>
    </ul>
  </section>`
  const pageHeading = pathname.startsWith('/blog/')
    ? 'UPSC Preparation Article'
    : page.title.split('|')[0].trim()
  return `<section class="page-hero">
    <p class="eyebrow">Free UPSC Preparation</p>
    <h1>${escapeHtml(pageHeading)}</h1>
    <p class="page-intro">${escapeHtml(page.description)}</p>
    ${internalLinks()}
  </section>${linkBlock}`
}

function inlineMarkdown(value) {
  const escaped = escapeHtml(value)
  return escaped.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, href) => {
    if (!href.startsWith('/') && !/^https:\/\//i.test(href)) return label
    return `<a href="${escapeHtml(href)}">${label}</a>`
  })
}

function manualArticleContent(page, article) {
  const heading = article.title
  const paragraphs = (article.content || []).map(block => {
    if (block.startsWith('### ')) return `<h2>${inlineMarkdown(block.slice(4))}</h2>`
    return `<p>${inlineMarkdown(block)}</p>`
  }).join('\n')
  return `<section class="page-hero">
    <p class="eyebrow">FUP Journal · ${escapeHtml(article.date)}</p>
    <h1>${escapeHtml(heading)}</h1>
    <p class="page-intro">${escapeHtml(article.excerpt || page.description)}</p>
    ${internalLinks()}
  </section>
  <article class="section legal-copy" aria-label="${escapeHtml(heading)}">
    <p><time>${escapeHtml(article.date)}</time></p>
    ${paragraphs}
    <p><a href="/blog/">Back to the journal</a></p>
  </article>`
}

function pagePathForFile(filePath) {
  const relativePath = relative(distRoot, filePath).replaceAll('\\', '/')
  if (relativePath === 'index.html') return '/'
  if (relativePath.endsWith('/index.html')) return `/${relativePath.slice(0, -'index.html'.length)}`
  return `/${relativePath}`
}

function contentForPath(pathname, articles) {
  if (pathname === '/') return homeContent(seoPages.find(page => page.path === '/') || seoPages[0], articles)
  if (pathname === '/blog/') return blogContent(seoPages.find(page => page.path === pathname), articles)
  const manual = manualArticles.find(article => pathname === `/blog/${article.slug}/`)
  if (manual) {
    const page = seoPages.find(item => item.path === pathname) || { description: manual.excerpt }
    return manualArticleContent(page, manual)
  }
  const page = seoPages.find(item => item.path === pathname)
  return page ? simplePageContent(page, pathname) : null
}

function wrapStaticContent(content) {
  return `<div class="app-shell" data-prerendered-content="true">${content}</div>`
}

async function prerenderRoot(filePath, content) {
  const html = await readFile(filePath, 'utf8')
  const rootPattern = /<div\b(?=[^>]*\bid=(['"])root\1)[^>]*>[\s\S]*?<\/div>/i
  if (!rootPattern.test(html)) return false
  const result = html.replace(rootPattern, () => `<div id="root">${wrapStaticContent(content)}</div>`)
  await writeFile(filePath, result)
  return true
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

const articles = allPosts()
const files = await findHtmlFiles(distRoot)
let prerendered = 0
let articleFallbacks = 0

for (const filePath of files) {
  const pathname = pagePathForFile(filePath)
  const content = contentForPath(pathname, articles)
  if (content && await prerenderRoot(filePath, content)) {
    prerendered += 1
    continue
  }

  const html = await readFile(filePath, 'utf8')
  if (!pathname.startsWith('/blog/')) continue
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)
  const articleText = articleMatch?.[1].replace(/<[^>]*>/g, ' ').replace(/&nbsp;/gi, ' ').trim()
  if (articleText && articleText.length > 120) continue
  const fallback = `<section class="page-hero"><h1>UPSC Journal Article</h1><p class="page-intro">Read this UPSC preparation note and explore more FUP journal articles.</p>${internalLinks()}</section><section class="section"><p>This article is available in the FUP Journal.</p><p><a href="/blog/">Back to the journal</a></p></section>`
  if (await prerenderRoot(filePath, fallback)) {
    articleFallbacks += 1
  } else if (/<body\b[^>]*>/i.test(html)) {
    await writeFile(filePath, html.replace(/<body\b[^>]*>/i, match => `${match}${fallback}`))
    articleFallbacks += 1
  }
}

console.log(`Prerendered ${prerendered} route pages and added ${articleFallbacks} missing blog article fallbacks.`)
