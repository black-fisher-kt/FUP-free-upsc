import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const publicRoot = join(projectRoot, 'public')
const blogRoot = join(publicRoot, 'blog')
const postsFile = join(publicRoot, 'posts.json')
const feedFile = join(publicRoot, 'feed.xml')
const siteUrl = 'https://freeupsc.online'
const groqApiUrl = 'https://api.groq.com/openai/v1'
const PRIMARY_MODEL = 'openai/gpt-oss-120b'
const FALLBACK_MODEL = 'openai/gpt-oss-20b'
const maxAttempts = 3
const minBodyLength = 700
const minSourceLength = 800

const feeds = [
  { name: 'PIB Press Releases', type: 'press-release', url: 'https://pib.gov.in/RssMain.aspx?ModId=6&Lang=1&Regid=3', official: true },
  { name: 'PIB Features', type: 'feature', url: 'https://pib.gov.in/RssMain.aspx?ModId=18&Lang=1&Regid=3', official: true },
  { name: 'The Indian Express', type: 'news', url: 'https://indianexpress.com/section/india/feed/' },
  { name: 'The Hindu', type: 'news', url: 'https://www.thehindu.com/news/national/feeder/default.rss' },
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
      sourceType: feed.type,
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
      const errorBody = (await response.text()).slice(0, 500)
      if (!retryable || attempt === maxAttempts) {
        throw new Error(`${label} returned HTTP ${response.status}${errorBody ? `: ${errorBody}` : ''}`)
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

function containsDevanagari(value) {
  return /[\u0900-\u097f]/u.test(value)
}

function englishSourceText(pageText, translatedText = '') {
  if (!containsDevanagari(pageText)) return pageText
  return translatedText && !containsDevanagari(translatedText) ? translatedText : ''
}

async function fetchPibArticle(item) {
  if (!item.official) return { text: '', releaseDate: '', sourceUrl: item.url, englishAvailable: false }
  try {
    const response = await fetchWithRetry(item.url, {
      headers: { accept: 'text/html,application/xhtml+xml' },
    }, `PIB article ${item.url}`)
    const html = await response.text()
    const pageText = pibArticleText(html)
    let text = pageText
    let sourceUrl = item.url
    const languageBlock = html.match(/<div\b[^>]*class=["'][^"']*\bReleaseLang\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] ?? ''
    const englishLink = languageBlock.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>\s*English\s*<\/a>/i)?.[1]
    if (containsDevanagari(text) && englishLink) {
      const englishUrl = canonicalUrl(new URL(decodeXml(englishLink), item.url).toString())
      if (englishUrl && englishUrl !== item.url) {
        const englishResponse = await fetchWithRetry(englishUrl, {
          headers: { accept: 'text/html,application/xhtml+xml' },
        }, `PIB English article ${englishUrl}`)
        const englishText = pibArticleText(await englishResponse.text())
        text = englishSourceText(pageText, englishText)
        if (text) {
          sourceUrl = englishUrl
        }
      }
    }
    text = englishSourceText(text)
    if (!text) {
      return { text: '', releaseDate: '', sourceUrl, englishAvailable: false }
    }
    const releaseDate = text.match(/\bPosted On:\s*(.+?)(?=\s+by PIB\b|$)/i)?.[1]?.trim() ?? ''
    return { text, releaseDate, sourceUrl, englishAvailable: true }
  } catch (error) {
    log(`PIB article text unavailable for "${item.title}": ${error.message}`)
    return { text: '', releaseDate: '', sourceUrl: item.url, englishAvailable: false }
  }
}

function extractJson(content) {
  const trimmed = content.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  try {
    return JSON.parse(trimmed)
  } catch {}
  const start = trimmed.indexOf('{')
  if (start < 0) throw new Error('json_validate_failed: model output contains no JSON object')
  let depth = 0
  let inString = false
  let escaped = false
  for (let index = start; index < trimmed.length; index += 1) {
    const character = trimmed[index]
    if (inString) {
      if (escaped) escaped = false
      else if (character === '\\') escaped = true
      else if (character === '"') inString = false
    } else if (character === '"') inString = true
    else if (character === '{') depth += 1
    else if (character === '}' && --depth === 0) {
      try {
        return JSON.parse(trimmed.slice(start, index + 1))
      } catch (error) {
        throw new Error(`json_validate_failed: ${error.message}`)
      }
    }
  }
  throw new Error('json_validate_failed: model output contains incomplete JSON')
}

async function requestGroqJson(apiKey, model, messages, label, includeJsonMode, shortOutput = false) {
  const body = {
    model,
    messages: shortOutput
      ? messages.map((message, index) => index === messages.length - 1
        ? { ...message, content: `${message.content}\n\nRetry instruction: return compact, valid JSON and stay within the requested length. If writing an article, keep html_body to 600-700 words and facts to no more than 8 items.` }
        : message)
      : messages,
    max_tokens: 10000,
    temperature: 0.2,
    reasoning_effort: 'low',
  }
  if (includeJsonMode) body.response_format = { type: 'json_object' }
  const response = await fetchWithRetry(`${groqApiUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${apiKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  }, `${label} (${model})`)
  const payload = await response.json()
  const finishReason = payload.choices?.[0]?.finish_reason
  if (finishReason === 'length') {
    throw new Error(`${label} (${model}) finish_reason=length`)
  }
  const content = payload.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error(`${label} (${model}) returned empty content`)
  }
  try {
    return extractJson(content)
  } catch (error) {
    throw new Error(`json_validate_failed: ${error.message}`)
  }
}

async function groqJson(apiKey, messages, label) {
  const errors = []
  for (const model of [PRIMARY_MODEL, FALLBACK_MODEL]) {
    let includeJsonMode = true
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        let value
        try {
          value = await requestGroqJson(apiKey, model, messages, label, includeJsonMode, attempt === 1)
        } catch (error) {
          const unsupportedJsonMode = includeJsonMode
            && /response_format|json_object|json mode/i.test(error.message)
            && /unsupported|not support|invalid|unrecognized|unknown|not allowed/i.test(error.message)
          if (!unsupportedJsonMode) throw error
          includeJsonMode = false
          log(`${label}: ${model} does not support JSON mode; safely extracting JSON from its response`)
          value = await requestGroqJson(apiKey, model, messages, label, false, attempt === 1)
        }
        return { value, model }
      } catch (error) {
        errors.push(`${model} attempt ${attempt + 1}: ${error.message}`)
        const retryableOutput = /finish_reason=length|max[_ ]completion[_ ]tokens|json_validate_failed/i.test(error.message)
        if (attempt === 0 && retryableOutput) {
          log(`${label}: ${model} output was truncated or invalid; retrying once with a shorter response`)
          continue
        }
        break
      }
    }
    log(`${label}: ${model} failed; trying fallback model`)
  }
  throw new Error(`${label} failed on both models. ${errors.join(' | ')}`)
}

function validArticle(article) {
  const expectedFields = ['facts', 'html_body', 'meta_description', 'slug', 'tags', 'title']
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
    && Array.isArray(article.facts)
    && article.facts.length > 0
    && article.facts.length <= 8
    && article.facts.every(fact => fact && typeof fact.claim === 'string'
      && typeof fact.exact_quote_from_source === 'string'
      && fact.claim.trim() && fact.exact_quote_from_source.trim())
    && !/[\u0900-\u0965\u0970-\u097f]/u.test(`${article.title} ${article.meta_description} ${article.html_body}`)
}

function normalizeEvidenceText(value) {
  const months = {
    january: 'jan', february: 'feb', march: 'mar', april: 'apr', may: 'may',
    june: 'jun', july: 'jul', august: 'aug', september: 'sep', october: 'oct',
    november: 'nov', december: 'dec',
  }
  return value.replace(/[\u0966-\u096f]/g, digit => String(digit.charCodeAt(0) - 0x0966))
    .toLocaleLowerCase('en')
    .replace(/(\d),(?=\d)/g, '$1')
    .replace(/₹|\b(?:inr|rs\.?)\b/gi, ' rs ')
    .replace(/%|per cent|percent/gi, ' percent ')
    .replace(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\b/gi, month => months[month.toLowerCase()])
    .replace(/[^\p{L}\p{N}.]+/gu, ' ')
    .replace(/(?<!\d)\.|\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractNumericValues(value) {
  const plainText = textFromHtml(value).replace(/[\u0966-\u096f]/g, digit => String(digit.charCodeAt(0) - 0x0966))
  const pattern = /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b|\b\d{1,2}\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{4}\b|\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2},?\s+\d{4}\b|(?:₹|Rs\.?\s*|INR\s*|USD\s*|\$|€|£)\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:crore|crores|lakh|lakhs|million|billion|thousand|per cent|percent|%))?|\b\d[\d,]*(?:\.\d+)?\s*(?:%|per cent|percent|crore|crores|lakh|lakhs|million|billion|thousand|km|kilomet(?:re|er)s?|kg|tonnes?|years?|months?|days?)?/giu
  return [...plainText.matchAll(pattern)].map(match => match[0].trim()).filter(Boolean)
}

function verifyGeneratedArticle(article, sourceText) {
  const source = normalizeEvidenceText(sourceText)
  const missingQuotes = article.facts
    .map(fact => fact.exact_quote_from_source.trim())
    .filter(quote => !textFromHtml(sourceText).toLocaleLowerCase('en').replace(/\s+/g, ' ')
      .includes(textFromHtml(quote).toLocaleLowerCase('en').replace(/\s+/g, ' ')))
  const outputNumbers = extractNumericValues(`${article.title}\n${article.meta_description}\n${article.html_body}`)
  const rejectedNumbers = [...new Set(outputNumbers.filter(value => {
    const normalized = normalizeEvidenceText(value)
    if (!normalized) return false
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return !new RegExp(`(?:^| )${escaped}(?= |$)`, 'u').test(source)
  }))]
  return {
    passed: missingQuotes.length === 0 && rejectedNumbers.length === 0,
    missingQuotes,
    rejectedNumbers,
  }
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
          <p><strong>Source:</strong> ${escapeHtml(post.sourceName)} — ${escapeHtml(post.releaseDate)} — <a href="${escapeHtml(post.sourceUrl)}" target="_blank" rel="noopener noreferrer">original release ↗</a></p>
          <p>This summary is based on the official source above; please refer to it for exact details.</p>
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
  const allCandidates = loadedFeeds.flat()
    .filter(isRecent)
    .filter(item => {
      const titleKey = normalizeTitle(item.title)
      if (seenUrls.has(item.url) || seenTitles.has(titleKey)) return false
      seenUrls.add(item.url)
      seenTitles.add(titleKey)
      return !history.urls.has(item.url) && !history.titles.has(titleKey)
    })
  const pressCandidates = allCandidates.filter(item => item.sourceType === 'press-release').slice(0, 10)
  const featureCandidates = allCandidates.filter(item => item.sourceType === 'feature').slice(0, 10)

  if (!pressCandidates.length && !featureCandidates.length) {
    log('No new recent headlines found; nothing to publish.')
    await writeIfChanged(feedFile, rssFeed(posts))
    return
  }

  const sourcesByUrl = new Map()
  const fetchEligibleOfficialStories = async items => Promise.all(items.map(async item => {
    const source = await fetchPibArticle(item)
    if (!source.englishAvailable || source.text.length < minSourceLength || !source.releaseDate) {
      log(`Source ineligible for "${item.title}": English PIB text ${source.englishAvailable ? `${source.text.length} chars` : 'unavailable'}${source.releaseDate ? '' : ', release date missing'}`)
      return null
    }
    sourcesByUrl.set(item.url, source)
    return item
  })).then(items => items.filter(Boolean))

  const eligiblePressStories = await fetchEligibleOfficialStories(pressCandidates)
  let candidates = eligiblePressStories
  if (eligiblePressStories.length < 2) {
    log(`Only ${eligiblePressStories.length} eligible PIB Press Release stories; adding PIB Features to fill up to two posts`)
    const eligibleFeatures = await fetchEligibleOfficialStories(featureCandidates)
    candidates = [...eligiblePressStories, ...eligibleFeatures]
  }
  if (!candidates.length) {
    log('No eligible English PIB source text of at least 800 characters; nothing to publish.')
    await writeIfChanged(feedFile, rssFeed(posts))
    return
  }

  log(`${eligiblePressStories.length} eligible PIB Press Release and ${candidates.filter(item => item.sourceType === 'feature').length} eligible PIB Feature stories available`)
  let selectionResult
  try {
    selectionResult = await groqJson(apiKey, [
    {
      role: 'system',
      content: 'Rank up to 10 distinct stories for UPSC CSE, returning as many strong alternatives as available. Prioritize PIB Press Releases covering Cabinet decisions, new schemes and missions, international agreements and MoUs, reports and indices, bills and Acts, environment, science and technology, economic data, defence, and governance reforms. Use PIB Features only to fill a place when fewer than two eligible PIB Press Releases are available. Prefer high policy impact, clear syllabus relevance, and useful Prelims/Mains dimensions; avoid routine ceremonial news. Do not choose two stories from the same ministry or the same topic. Return strict JSON with an articles array of objects containing id, a concise selection_reason in English, ministry, and topic, in rank order. Use only the supplied headline and summary to assign these labels.',
    },
    {
      role: 'user',
      content: JSON.stringify(candidates.map(({ id, title, summary, sourceName, sourceType }) => ({
        id, title, summary: summary.slice(0, 500), sourceName, sourceType,
      }))),
    },
    ], 'Groq story selection')
    log(`Story selection used ${selectionResult.model}`)
  } catch (error) {
    log(`Story selection failed on both models; skipping this run: ${error.message}`)
    await writeIfChanged(feedFile, rssFeed(posts))
    return
  }
  const rankedStories = []
  const usedMinistries = new Set()
  const usedTopics = new Set()
  const selectedIds = new Set()
  for (const selection of Array.isArray(selectionResult.value.articles) ? selectionResult.value.articles : []) {
    const candidate = candidates.find(item => item.id === selection?.id)
    const ministry = typeof selection?.ministry === 'string' ? normalizeTitle(selection.ministry) : ''
    const topic = typeof selection?.topic === 'string' ? normalizeTitle(selection.topic) : ''
    if (!candidate || typeof selection.selection_reason !== 'string'
      || !selection.selection_reason.trim() || !ministry || !topic || selectedIds.has(candidate.id)) continue
    if (usedMinistries.has(ministry) || usedTopics.has(topic)) {
      log(`Rejected duplicate ministry/topic selection: "${candidate.title}"`)
      continue
    }
    selectedIds.add(candidate.id)
    usedMinistries.add(ministry)
    usedTopics.add(topic)
    rankedStories.push({ ...candidate, selectionReason: selection.selection_reason })
  }

  if (!rankedStories.length) {
    log('Story selection returned no valid stories; nothing to publish.')
    await writeIfChanged(feedFile, rssFeed(posts))
    return
  }
  const selected = rankedStories.sort((first, second) => {
    if (first.sourceType === second.sourceType) return 0
    return first.sourceType === 'press-release' ? -1 : 1
  })
  const css = `${await readFile(join(projectRoot, 'src/index.css'), 'utf8')}\n${await readFile(join(projectRoot, 'src/App.css'), 'utf8')}`
  const date = todayInIndia()
  let published = 0

  for (const item of selected) {
    if (published >= 2) break
    log(`Selected story: "${item.title}" (${item.sourceName}); reason: ${item.selectionReason}`)
    const source = sourcesByUrl.get(item.url)
    if (!source?.englishAvailable) {
      log(`Skipping "${item.title}": English PIB source unavailable`)
      continue
    }
    const sourceText = source.text
    if (sourceText.length < minSourceLength) {
      log(`Skipping "${item.title}": full official source text is only ${sourceText.length} characters (minimum ${minSourceLength})`)
      continue
    }
    if (!source.releaseDate) {
      log(`Skipping "${item.title}": official source release date was not found`)
      continue
    }

    const prompt = `Write an original UPSC current-affairs article in clear, formal-but-simple English only. Title, headings, body, and meta description must all be English. Use only facts from the complete source text below. Do not copy sentences. Explain UPSC relevance qualitatively. Include these English sections: What happened, Why it matters for UPSC, Prelims points, Mains angle, and Related syllabus topic. If the source does not support a section, give fewer points rather than inventing. Do not add numbered lists unless each number is present in the source. Keep html_body between 600 and 900 words. Return no more than 8 facts.

Return strict JSON with exactly these fields: title (string), slug (lowercase ASCII letters/digits/hyphens only), meta_description (string), html_body (HTML string), tags (array of strings), facts (array of objects with claim and exact_quote_from_source strings). Each quote must be copied exactly from the source text. Do not include an invented source line in the body; it will be added from verified metadata.

Source name: ${item.sourceName}
Original link: ${source.sourceUrl}
Release date: ${source.releaseDate}
Source text (the only factual source): ${sourceText}`

    let article
    let usedModel = ''
    let verification = { rejectedNumbers: [], missingQuotes: [] }
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await groqJson(apiKey, [
          {
            role: 'system',
            content: 'You are an accurate UPSC current-affairs educator. Follow every rule exactly: (1) Use ONLY facts present in the provided source text. Do not add any number, date, percentage, amount, name, place, scheme detail, or quote from your own memory. (2) Copy every number, date, percentage, and currency amount exactly as written in the source, with the same units (crore, lakh, per cent, etc). Never round, convert, recalculate, or reword numbers. (3) Background and explanation must be qualitative. If a number or date is not in the source, do not mention it. (4) If the source does not give enough information for a section (for example Prelims points), write fewer points instead of inventing. (5) Write clear, formal-but-simple English only. Return strict JSON with title, slug, meta_description, html_body, tags, and facts array of {claim, exact_quote_from_source}. Every exact_quote_from_source must be a verbatim substring of the source.',
          },
          { role: 'user', content: attempt === 1 ? prompt : `${prompt}\n\nVerification feedback: these values are not in the source, remove them: ${verification.rejectedNumbers.join(', ') || 'none'}. Also replace any source quotes that are not exact source substrings.` },
        ], `Article generation for "${item.title}"`)
        usedModel = result.model
        log(`Article model for "${item.title}": ${usedModel}`)
        if (!validArticle(result.value)) throw new Error('JSON structure/fields are invalid, body is too short, or generated text is not English')
        verification = verifyGeneratedArticle(result.value, sourceText)
        if (verification.passed) {
          log(`Verification passed for "${item.title}" (${usedModel}); no rejected numbers`)
          article = result.value
          break
        }
        log(`Verification failed for "${item.title}" (${usedModel}); rejected numbers: ${verification.rejectedNumbers.join(', ') || 'none'}; unmatched quotes: ${verification.missingQuotes.length}`)
        if (attempt === 2) break
        continue
      } catch (error) {
        log(`Generation attempt ${attempt} failed for "${item.title}"${usedModel ? ` (${usedModel})` : ''}: ${error.message}`)
        if (/failed on both models/.test(error.message)) {
          log(`Skipping "${item.title}": both configured models failed`)
          break
        }
        if (attempt === 2) {
          log(`Skipping "${item.title}" after both models/retry failed`)
          break
        }
      }
    }
    if (!article) {
      log(`Verification failed; skipping "${item.title}"`)
      continue
    }

    const sourceSlug = article.slug.toLowerCase()
    const fileName = `${date}-${sourceSlug}.html`
    const href = `/blog/${fileName}`
    if (posts.some(post => post.href === href) || history.urls.has(item.url) || history.urls.has(source.sourceUrl) || history.titles.has(normalizeTitle(item.title))) {
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
      releaseDate: source.releaseDate,
      sourceUrl: source.sourceUrl,
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
      releaseDate: publishedPost.releaseDate,
      sourceUrl: publishedPost.sourceUrl,
      sourceTitle: publishedPost.sourceTitle,
      tags: publishedPost.tags,
    })
    history.urls.add(item.url)
    history.titles.add(normalizeTitle(item.title))
    published += 1
    log(`Published "${publishedPost.title}" using ${usedModel}; verification passed`)
  }

  await writeIfChanged(postsFile, `${JSON.stringify(posts, null, 2)}\n`)
  await writeIfChanged(feedFile, rssFeed(posts))
  log(`Run complete: published ${published} post(s); ${posts.length} in history.`)
}

export { containsDevanagari, englishSourceText, groqJson, verifyGeneratedArticle }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => {
    console.error(`[daily-blog] ERROR: ${error.message}`)
    process.exitCode = 1
  })
}
