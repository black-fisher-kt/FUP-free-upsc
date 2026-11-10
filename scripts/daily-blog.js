import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = join(projectRoot, 'public')
const blogRoot = join(publicRoot, 'blog')
const postsFile = join(publicRoot, 'posts.json')
const feedFile = join(publicRoot, 'feed.xml')
const siteUrl = 'https://freeupsc.online'
const groqApiUrl = 'https://api.groq.com/openai/v1'
const preferredModels = ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant']
const maxAttempts = 3
const minBodyLength = 700

const feeds = [
  { name: 'PIB Press Releases', url: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', official: true },
  { name: 'PIB Features', url: 'https://pib.gov.in/RssMain.aspx?ModId=18&Lang=1&Regid=3', official: true },
  { name: 'The Indian Express', url: 'https://indianexpress.com/section/india/feed/' },
  { name: 'The Hindu', url: 'https://www.thehindu.com/news/national/feeder/default.rss' },
]

function log(message) {
  console.log(`[daily-blog] ${message}`)
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')
}

function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;/gi, "'")
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&rdquo;/gi, '”')
    .replace(/&ldquo;/gi, '“')
    .replace(/&ndash;/gi, '–')
    .replace(/&mdash;/gi, '—')
}

function textFromHtml(value) {
  return decodeXml(value)
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function readTag(xml, tagName) {
  const escapedTag = tagName.replace(':', '\\:')
  const match = xml.match(new RegExp(`<${escapedTag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escapedTag}>`, 'i'))
  return match?.[1] ?? ''
}

function normalizeTitle(value) {
  return textFromHtml(value).normalize('NFKC').toLocaleLowerCase('en')
    .replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

function canonicalUrl(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return ''
    url.hash = ''
    return url.toString()
  } catch {
    return ''
  }
}

function parseFeed(xml, feed) {
  const items = [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)]
    .map(match => match[1])
  const atomEntries = [...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi)]
    .map(match => match[1])
  const entries = [...items, ...atomEntries]

  return entries.flatMap((entry, index) => {
    const title = textFromHtml(readTag(entry, 'title'))
    const linkTag = entry.match(/<link\b([^>]*)\/?>/i)
    const link = readTag(entry, 'link') || linkTag?.[1]?.match(/\bhref=["']([^"']+)["']/i)?.[1] || ''
    const url = canonicalUrl(decodeXml(link.trim()))
    const summary = textFromHtml(
      readTag(entry, 'description') ||
      readTag(entry, 'summary') ||
      readTag(entry, 'content:encoded') ||
      readTag(entry, 'content'),
    )
    const dateText = readTag(entry, 'pubDate') || readTag(entry, 'published') || readTag(entry, 'updated')
    const timestamp = dateText ? Date.parse(textFromHtml(dateText)) : Number.NaN
    const publishedAt = Number.isNaN(timestamp) ? '' : new Date(timestamp).toISOString()

    if (!title || !url) return []
    return [{
      id: `${feeds.indexOf(feed)}-${index}`,
      title: title.slice(0, 300),
      summary: summary.slice(0, 1200),
      url,
      sourceName: feed.name,
      publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt)) ? publishedAt : '',
      official: Boolean(feed.official),
    }]
  })
}

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

async function fetchWithRetry(url, options = {}, label = url) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(options.timeout ?? 20000),
      })
      if (response.ok) return response
      const retryable = response.status === 429 || response.status >= 500
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`${label} returned HTTP ${response.status}`)
      }
      const retryAfter = Number(response.headers.get('retry-after'))
      const waitMs = Number.isFinite(retryAfter) && retryAfter > 0
        ? Math.min(retryAfter * 1000, 30000)
        : 1000 * (2 ** (attempt - 1))
      log(`${label} returned HTTP ${response.status}; retry ${attempt + 1}/${maxAttempts} in ${waitMs}ms`)
      await delay(waitMs)
    } catch (error) {
      if (attempt === maxAttempts || /returned HTTP/.test(error.message)) throw error
      const waitMs = 1000 * (2 ** (attempt - 1))
      log(`${label} failed (${error.message}); retry ${attempt + 1}/${maxAttempts} in ${waitMs}ms`)
      await delay(waitMs)
    }
  }
  throw new Error(`${label} failed after retries`)
}

async function loadFeed(feed) {
  try {
    const response = await fetchWithRetry(feed.url, {
      headers: { accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' },
    }, feed.name)
    const xml = await response.text()
    if (!/<rss\b|<feed\b|<rdf:RDF\b/i.test(xml)) throw new Error('response is not RSS/Atom XML')
    const items = parseFeed(xml, feed)
    if (!items.length) throw new Error('feed has no usable items')
    log(`${feed.name}: loaded ${items.length} items`)
    return items
  } catch (error) {
    log(`${feed.name}: skipped (${error.message})`)
    return []
  }
}

async function readPosts() {
  try {
    const parsed = JSON.parse(await readFile(postsFile, 'utf8'))
    if (!Array.isArray(parsed)) throw new Error('posts.json must contain an array')
    return parsed
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function postHistory(posts) {
  const urls = new Set()
  const titles = new Set()
  for (const post of posts) {
    if (post.sourceUrl) urls.add(canonicalUrl(post.sourceUrl))
    if (post.title) titles.add(normalizeTitle(post.title))
    if (post.sourceTitle) titles.add(normalizeTitle(post.sourceTitle))
  }
  return { urls, titles }
}

function todayInIndia() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

function isRecent(item) {
  if (!item.publishedAt) return true
  const age = Date.now() - Date.parse(item.publishedAt)
  return age >= -60 * 60 * 1000 && age <= 48 * 60 * 60 * 1000
}

function pibArticleText(html) {
  const openingTag = /<div\b(?=[^>]*\bclass=["'][^"']*(?:content-|release-content|press-release)[^"']*["'])[^>]*>/i.exec(html)
  if (!openingTag) return ''

  const divTags = /<\/?div\b[^>]*>/gi
  const contentStart = openingTag.index + openingTag[0].length
  divTags.lastIndex = contentStart
  let depth = 1
  for (let match; (match = divTags.exec(html));) {
    if (/^<\//.test(match[0])) depth -= 1
    else if (!/\/\s*>$/.test(match[0])) depth += 1
    if (depth === 0) return textFromHtml(html.slice(contentStart, match.index))
  }
  return ''
}

async function fetchPibArticle(item) {
  if (!item.official) return item.summary
  try {
    const response = await fetchWithRetry(item.url, {
      headers: { accept: 'text/html,application/xhtml+xml' },
    }, `PIB article ${item.url}`)
    const html = await response.text()
    let text = pibArticleText(html)
    const languageBlock = html.match(/<div\b[^>]*class=["'][^"']*\bReleaseLang\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ''
    const englishLink = languageBlock.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*English\s*<\/a>/i)?.[1]
    if (englishLink) {
      const englishUrl = canonicalUrl(new URL(decodeXml(englishLink), item.url).toString())
      if (englishUrl && englishUrl !== item.url) {
        const englishResponse = await fetchWithRetry(englishUrl, {
          headers: { accept: 'text/html,application/xhtml+xml' },
        }, `PIB English article ${englishUrl}`)
        const englishText = pibArticleText(await englishResponse.text())
        if (englishText.length > text.length) text = englishText
      }
    }
    return text.slice(0, 12000)
  } catch (error) {
    log(`PIB article text unavailable for "${item.title}": ${error.message}`)
    return item.summary
  }
}

async function getAvailableModel(apiKey) {
  const response = await fetchWithRetry(`${groqApiUrl}/models`, {
    headers: { authorization: `Bearer ${apiKey}` },
  }, 'Groq models endpoint')
  const result = await response.json()
  const modelIds = Array.isArray(result.data)
    ? result.data.map(model => model.id).filter(id => typeof id === 'string')
    : []
  const requestedModel = process.env.GROQ_MODEL?.trim()
  if (requestedModel) {
    if (!modelIds.includes(requestedModel)) {
      throw new Error(`GROQ_MODEL "${requestedModel}" is not available in the authenticated Groq models list`)
    }
    return requestedModel
  }
  const selectedModel = preferredModels.find(model => modelIds.includes(model))
  if (!selectedModel) {
    throw new Error(`No preferred free-tier model is available. Set GROQ_MODEL to one of: ${modelIds.slice(0, 20).join(', ')}`)
  }
  return selectedModel
}

async function groqJson(apiKey, model, messages, label) {
  const response = await fetchWithRetry(`${groqApiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: 'json_object' },
      temperature: 0.4,
    }),
  }, label)
  const payload = await response.json()
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string') throw new Error(`${label} returned no message content`)
  return JSON.parse(content)
}

function validArticle(article) {
  const expectedFields = ['html_body', 'meta_description', 'slug', 'tags', 'title']
  return article && typeof article === 'object'
    && Object.keys(article).sort().join(',') === expectedFields.join(',')
    && typeof article.title === 'string' && article.title.trim().length >= 12
    && typeof article.slug === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(article.slug)
    && typeof article.meta_description === 'string' && article.meta_description.trim().length >= 40
    && typeof article.html_body === 'string'
    && textFromHtml(article.html_body).length >= minBodyLength
    && Array.isArray(article.tags)
    && article.tags.length > 0
    && article.tags.every(tag => typeof tag === 'string' && tag.trim().length > 0)
}

function safeArticleHtml(html) {
  const withoutActiveContent = html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style|iframe|object|svg|math)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
  const allowedTags = new Set(['p', 'h2', 'h3', 'ul', 'ol', 'li', 'strong', 'em', 'blockquote', 'a', 'br'])
  return withoutActiveContent.replace(/<\/?([a-z][\w-]*)\b([^>]*)>/gi, (tag, name, attributes) => {
    const normalizedName = name.toLowerCase()
    if (!allowedTags.has(normalizedName)) return ''
    if (tag.startsWith('</')) return normalizedName === 'br' ? '' : `</${normalizedName}>`
    if (normalizedName !== 'a') return `<${normalizedName}>`
    const href = attributes.match(/\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/i)
    const url = canonicalUrl(href?.[1] ?? href?.[2] ?? '')
    return url ? `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">` : '<a>'
  })
}

function pageHtml(post, css) {
  const canonical = `${siteUrl}${post.href}`
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.excerpt,
    mainEntityOfPage: canonical,
    datePublished: `${post.publishedAt.slice(0, 10)}T07:00:00+05:30`,
    dateModified: `${post.publishedAt.slice(0, 10)}T07:00:00+05:30`,
    author: { '@type': 'Organization', name: 'FUP' },
    publisher: { '@type': 'Organization', name: 'FUP', url: `${siteUrl}/` },
    image: `${siteUrl}/og-image.png`,
    keywords: post.tags.join(', '),
  }
  const body = `
    <div class="app-shell">
      <div class="announcement">A free, focused space for serious aspirants <span>•</span> Built for the long road</div>
      <header class="site-header">
        <a class="wordmark" href="/"><span>F</span>UP<small>free upsc preparation</small></a>
        <nav><a href="/">Home</a><a href="/about/">About FUP</a><a href="/watchlist/">Watchlist</a><a href="/blog/">Journal</a></nav>
      </header>
      <main>
        <section class="page-hero">
          <p class="eyebrow">Current Affairs · ${escapeHtml(post.date)}</p>
          <h1>${escapeHtml(post.title)}</h1>
          <p class="page-intro">${escapeHtml(post.excerpt)}</p>
        </section>
        <article class="section legal-copy">
          <p class="article-meta">${escapeHtml(post.date)}<span>•</span>Daily current affairs</p>
          ${post.body}
          <p><strong>Source:</strong> <a href="${escapeHtml(post.sourceUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(post.sourceName)} — original report ↗</a></p>
          <p><a class="arrow-link" href="/blog/">← Back to the journal</a></p>
        </article>
      </main>
      <footer>
        <div><a class="wordmark footer-mark" href="/"><span>F</span>UP<small>free upsc preparation</small></a><p>Good preparation should be<br />accessible to everyone.</p></div>
        <div class="footer-links"><span>Explore</span><a href="/about/">About FUP</a><a href="/watchlist/">Watchlist</a><a href="/blog/">Journal</a></div>
        <div class="footer-links"><span>Connect</span><a href="https://t.me/upscfreecoursess">Telegram ↗</a><a href="https://discord.gg/qahMmrBuA">Discord ↗</a><a href="mailto:hello@freeupsc.online">hello@freeupsc.online</a></div>
        <div class="footer-bottom"><span>© 2026 FUP. Made for the journey.</span><span>freeupsc.online</span></div>
      </footer>
    </div>`

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#172b3a" />
    <title>${escapeHtml(post.title)} | FUP Journal</title>
    <meta name="description" content="${escapeHtml(post.excerpt)}" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="canonical" href="${escapeHtml(canonical)}" />
    <meta property="og:type" content="article" />
    <meta property="og:url" content="${escapeHtml(canonical)}" />
    <meta property="og:site_name" content="FUP | Free UPSC Preparation" />
    <meta property="og:title" content="${escapeHtml(post.title)}" />
    <meta property="og:description" content="${escapeHtml(post.excerpt)}" />
    <meta property="og:image" content="${siteUrl}/og-image.png" />
    <meta property="article:published_time" content="${escapeHtml(jsonLd.datePublished)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(post.title)}" />
    <meta name="twitter:description" content="${escapeHtml(post.excerpt)}" />
    <meta name="twitter:image" content="${siteUrl}/og-image.png" />
    <script type="application/ld+json">${JSON.stringify(jsonLd).replaceAll('<', '\\u003c')}</script>
    <style>${css.replace(/<\/style/gi, '<\\/style')}</style>
  </head>
  <body>${body}</body>
</html>
`
}

function escapeXml(value) {
  return String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;')
}

function rssFeed(posts) {
  const latestDate = posts
    .map(post => post.publishedAt)
    .filter(value => /^\d{4}-\d{2}-\d{2}$/.test(value))
    .sort()
    .at(-1)
  const lastBuildDate = latestDate
    ? new Date(`${latestDate}T07:00:00+05:30`).toUTCString()
    : new Date(0).toUTCString()
  const items = posts.map(post => `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapeXml(`${siteUrl}${post.href}`)}</link>
      <guid isPermaLink="true">${escapeXml(`${siteUrl}${post.href}`)}</guid>
      <pubDate>${new Date(`${post.publishedAt}T07:00:00+05:30`).toUTCString()}</pubDate>
      <description>${escapeXml(post.excerpt)}</description>
      <source url="${escapeXml(post.sourceUrl)}">${escapeXml(post.sourceName)}</source>
    </item>`).join('\n')
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>FUP UPSC Daily Current Affairs</title>
    <link>${siteUrl}/blog/</link>
    <description>Daily current affairs explained for UPSC preparation.</description>
    <language>en-IN</language>
    <lastBuildDate>${lastBuildDate}</lastBuildDate>
${items}
  </channel>
</rss>
`
}

async function writeIfChanged(path, value) {
  try {
    if (await readFile(path, 'utf8') === value) return false
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
  }
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, value)
  return true
}

async function main() {
  const apiKey = process.env.GROQ_API_KEY?.trim()
  if (!apiKey) throw new Error('GROQ_API_KEY is required; add it as a GitHub Actions secret')

  const posts = await readPosts()
  const history = postHistory(posts)
  const loadedFeeds = await Promise.all(feeds.map(loadFeed))
  const seenUrls = new Set()
  const seenTitles = new Set()
  const candidates = feeds.flatMap((_, feedIndex) => loadedFeeds[feedIndex].slice(0, 10))
    .filter(isRecent)
    .filter(item => {
      const titleKey = normalizeTitle(item.title)
      if (seenUrls.has(item.url) || seenTitles.has(titleKey)) return false
      seenUrls.add(item.url)
      seenTitles.add(titleKey)
      return !history.urls.has(item.url) && !history.titles.has(titleKey)
    })
    .slice(0, 60)

  if (!candidates.length) {
    log('No new recent headlines found; nothing to publish.')
    await writeIfChanged(feedFile, rssFeed(posts))
    return
  }

  const model = await getAvailableModel(apiKey)
  log(`Using Groq model ${model}; ${candidates.length} new headlines available`)

  const selection = await groqJson(apiKey, model, [
    {
      role: 'system',
      content: 'You select exactly two distinct recent news stories useful for UPSC CSE from policy, governance, international relations, economy, environment, science and technology, or social issues. Use only the supplied headline and summary. Return strict JSON with an articles array of exactly two objects, each containing only the supplied id. Do not select routine or unrelated items.',
    },
    {
      role: 'user',
      content: JSON.stringify(candidates.map(({ id, title, summary, sourceName }) => ({ id, title, summary, sourceName }))),
    },
  ], 'Groq story selection')
  const chosenIds = [...new Set(
    (Array.isArray(selection.articles) ? selection.articles : [])
      .map(article => article?.id)
      .filter(id => candidates.some(candidate => candidate.id === id)),
  )].slice(0, 2)

  if (chosenIds.length !== 2) throw new Error('Groq did not select two valid story IDs')
  const selected = chosenIds.map(id => candidates.find(candidate => candidate.id === id))
  const css = `${await readFile(join(projectRoot, 'src/index.css'), 'utf8')}\n${await readFile(join(projectRoot, 'src/App.css'), 'utf8')}`
  const date = todayInIndia()
  let published = 0

  for (const item of selected) {
    const sourceText = await fetchPibArticle(item)
    if (sourceText.length < 80) {
      log(`Skipping "${item.title}": source text is too short`)
      continue
    }

    const prompt = `Write an original UPSC current-affairs blog post using ONLY the source text below for factual claims. Do not add facts, figures, names, dates, context, or claims not present in the text. Explain UPSC relevance as analysis, not as unsupported factual claims. Paraphrase; never copy sentences. Write in Hinglish or clear English. Use this structure with headings: what happened; why it matters for UPSC; Prelims points; Mains angle; related UPSC syllabus topic. Finish the body with the source name and original link. Use meaningful HTML paragraphs and headings.

Return strict JSON with exactly these fields: title (string), slug (lowercase ASCII letters/digits/hyphens only), meta_description (string), html_body (HTML string), tags (array of strings).

Source name: ${item.sourceName}
Original link: ${item.url}
Headline: ${item.title}
Source text: ${sourceText}`

    let article
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        const result = await groqJson(apiKey, model, [
          { role: 'system', content: 'You are an accurate UPSC current-affairs educator. Follow the source-only factuality constraint and output JSON only.' },
          { role: 'user', content: prompt },
        ], `Groq article generation (${item.sourceName})`)
        if (!validArticle(result)) throw new Error('Generated JSON is invalid or the article is too short')
        article = result
        break
      } catch (error) {
        if (attempt === 3) {
          log(`Skipping "${item.title}" after 3 attempts: ${error.message}`)
          break
        }
        log(`Retrying "${item.title}" after validation/API error (${attempt + 1}/3): ${error.message}`)
      }
    }
    if (!article) continue

    const sourceSlug = article.slug.toLowerCase()
    const fileName = `${date}-${sourceSlug}.html`
    const href = `/blog/${fileName}`
    if (posts.some(post => post.href === href) || history.urls.has(item.url) || history.titles.has(normalizeTitle(item.title))) {
      log(`Skipping duplicate "${item.title}"`)
      continue
    }

    const publishedPost = {
      title: article.title.trim(),
      slug: sourceSlug,
      excerpt: article.meta_description.trim(),
      category: 'Current Affairs',
      date: new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Asia/Kolkata',
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      }).format(new Date()),
      publishedAt: date,
      readTime: '5 min read',
      href,
      sourceName: item.sourceName,
      sourceUrl: item.url,
      sourceTitle: item.title,
      tags: article.tags.map(tag => tag.trim()).slice(0, 10),
      body: safeArticleHtml(article.html_body),
    }
    await mkdir(blogRoot, { recursive: true })
    await writeFile(join(blogRoot, fileName), pageHtml(publishedPost, css))
    posts.unshift({
      title: publishedPost.title,
      excerpt: publishedPost.excerpt,
      category: publishedPost.category,
      date: publishedPost.date,
      publishedAt: publishedPost.publishedAt,
      readTime: publishedPost.readTime,
      slug: publishedPost.slug,
      href: publishedPost.href,
      sourceName: publishedPost.sourceName,
      sourceUrl: publishedPost.sourceUrl,
      sourceTitle: publishedPost.sourceTitle,
      tags: publishedPost.tags,
    })
    history.urls.add(item.url)
    history.titles.add(normalizeTitle(item.title))
    published += 1
    log(`Published "${publishedPost.title}"`)
  }

  await writeIfChanged(postsFile, `${JSON.stringify(posts, null, 2)}\n`)
  await writeIfChanged(feedFile, rssFeed(posts))
  log(`Run complete: published ${published} post(s); ${posts.length} in history.`)
}

main().catch(error => {
  console.error(`[daily-blog] ERROR: ${error.message}`)
  process.exitCode = 1
})
