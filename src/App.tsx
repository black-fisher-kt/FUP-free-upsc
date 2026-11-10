import { useState, useEffect } from 'react'
import { Link, Routes, Route, useNavigate, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { articles, faqs, gsWatchlist, siteConfig, watchlistCategories, watchlistPlaylists, type Article } from './data'
import seoPages from './seo-pages.json'
import './App.css'

const navItems = [
  { path: '/', label: 'Home' }, { path: '/about', label: 'About FUP' }, { path: '/watchlist', label: 'Watchlist' }, { path: '/blog', label: 'Journal' },
]

type DailyBlogPost = Pick<Article, 'title' | 'excerpt' | 'category' | 'date' | 'readTime' | 'slug'> & {
  publishedAt: string
  href: string
}

function isDailyBlogPost(value: unknown): value is DailyBlogPost {
  if (!value || typeof value !== 'object') return false
  const post = value as Record<string, unknown>
  return typeof post.title === 'string'
    && typeof post.excerpt === 'string'
    && typeof post.category === 'string'
    && typeof post.date === 'string'
    && typeof post.readTime === 'string'
    && typeof post.slug === 'string'
    && typeof post.publishedAt === 'string'
    && typeof post.href === 'string'
    && post.href.startsWith('/blog/')
    && !post.href.includes('..')
}

function App() {
  const [menuOpen, setMenuOpen] = useState(false)
  const routerNavigate = useNavigate()
  const location = useLocation()
  useEffect(() => {
    const pagePath = location.pathname === '/' ? '/' : `${location.pathname.replace(/\/+$/, '')}/`
    const page = seoPages.find(item => item.path === pagePath) ?? seoPages[0]
    const canonicalUrl = `https://freeupsc.online${page.path}`
    const imageUrl = 'https://freeupsc.online/og-image.png'
    const setMeta = (attribute: 'name' | 'property', key: string, value: string) => {
      const selector = `meta[${attribute}="${key}"]`
      const meta = document.querySelector<HTMLMetaElement>(selector) ?? document.createElement('meta')
      meta.setAttribute(attribute, key)
      meta.content = value
      if (!meta.parentElement) document.head.append(meta)
    }
    document.title = page.title
    setMeta('name', 'description', page.description)
    setMeta('property', 'og:type', page.kind === 'blogPosting' ? 'article' : 'website')
    setMeta('property', 'og:url', canonicalUrl)
    setMeta('property', 'og:title', page.title)
    setMeta('property', 'og:description', page.description)
    setMeta('property', 'og:image', imageUrl)
    setMeta('property', 'og:site_name', 'FUP | Free UPSC Preparation')
    setMeta('name', 'twitter:card', 'summary_large_image')
    setMeta('name', 'twitter:title', page.title)
    setMeta('name', 'twitter:description', page.description)
    setMeta('name', 'twitter:image', imageUrl)
    const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]') ?? document.createElement('link')
    canonical.rel = 'canonical'
    canonical.href = canonicalUrl
    if (!canonical.parentElement) document.head.append(canonical)
    const structuredData = page.kind === 'website'
      ? { '@context': 'https://schema.org', '@graph': [
        { '@type': 'WebSite', name: 'FUP | Free UPSC Preparation', url: 'https://freeupsc.online/' },
        { '@type': 'Organization', name: 'FUP - Free UPSC Preparation', url: 'https://freeupsc.online/', sameAs: [siteConfig.telegramUrl, siteConfig.discordUrl, siteConfig.redditUrl] },
      ] }
      : page.kind === 'blogPosting'
        ? { '@context': 'https://schema.org', '@type': 'BlogPosting', headline: page.title, description: page.description, mainEntityOfPage: canonicalUrl, datePublished: page.datePublished, dateModified: page.datePublished, author: { '@type': 'Organization', name: 'FUP' }, publisher: { '@type': 'Organization', name: 'FUP', url: 'https://freeupsc.online/' }, image: imageUrl }
        : null
    let jsonLd = document.getElementById('seo-structured-data')
    if (structuredData) {
      if (!jsonLd) {
        jsonLd = document.createElement('script')
        jsonLd.id = 'seo-structured-data'
        jsonLd.setAttribute('type', 'application/ld+json')
        document.head.append(jsonLd)
      }
      jsonLd.textContent = JSON.stringify(structuredData)
    } else {
      jsonLd?.remove()
    }
  }, [location.pathname])
  useEffect(() => {
    const redirect = sessionStorage.redirect
    if (redirect) { delete sessionStorage.redirect; if (redirect !== location.pathname) routerNavigate(redirect, { replace: true }) }
  }, [])
  const navigate = (path: string) => { routerNavigate(path); setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  return <div className="app-shell">
    <div className="announcement">A free, focused space for serious aspirants <span>•</span> Built for the long road</div>
    <header className="site-header">
      <button className="wordmark" onClick={() => navigate('/')} aria-label="Go to home"><span>F</span>UP<small>free upsc preparation</small></button>
      <button className="menu-toggle" onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle navigation">{menuOpen ? '×' : '☰'}</button>
      <nav className={menuOpen ? 'open' : ''}>{navItems.map(item => <button className={location.pathname === item.path ? 'active' : ''} key={item.path} onClick={() => navigate(item.path)}>{item.label}</button>)}<a className="nav-join" href={siteConfig.telegramUrl} target="_blank" rel="noopener noreferrer">Telegram ↗</a><a className="nav-join" href={siteConfig.discordUrl} target="_blank" rel="noopener noreferrer">Discord ↗</a><a className="nav-join" href={siteConfig.redditUrl} target="_blank" rel="noopener noreferrer">Reddit ↗</a></nav>
    </header>
    <main><Routes><Route path="/" element={<Home navigate={navigate} />} /><Route path="/about" element={<About navigate={navigate} />} /><Route path="/watchlist" element={<Watchlist />} /><Route path="/blog" element={<Blog navigate={navigate} />} /><Route path="/blog/:slug" element={<BlogPost navigate={navigate} />} /><Route path="/privacy" element={<Privacy />} /><Route path="*" element={<Home navigate={navigate} />} /></Routes></main>
    <footer><div><button className="wordmark footer-mark" onClick={() => navigate('/')}><span>F</span>UP<small>free upsc preparation</small></button><p>Good preparation should be<br />accessible to everyone.</p></div><div className="footer-links"><span>Explore</span><button onClick={() => navigate('/about')}>About FUP</button><button onClick={() => navigate('/watchlist')}>Watchlist</button><button onClick={() => navigate('/blog')}>Journal</button></div><div className="footer-links"><span>Connect</span><a href={siteConfig.telegramUrl} target="_blank" rel="noopener noreferrer">Telegram ↗</a><a href={siteConfig.discordUrl} target="_blank" rel="noopener noreferrer">Discord ↗</a><a href={siteConfig.redditUrl} target="_blank" rel="noopener noreferrer">Reddit ↗</a><a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a><button onClick={() => navigate('/privacy')}>Privacy policy</button></div><div className="footer-bottom"><span>© 2026 FUP. Made for the journey.</span><span>freeupsc.online</span></div></footer>
  </div>
}
function Button({ children, onClick, ghost = false }: { children: React.ReactNode; onClick?: () => void; ghost?: boolean }) { return <button className={`button ${ghost ? 'button-ghost' : ''}`} onClick={onClick}>{children} <span>↗</span></button> }
function Home({ navigate }: { navigate: (path: string) => void }) { return <>
  <section className="hero"><div className="hero-copy"><p className="eyebrow">A better way to prepare</p><h1>Prepare with<br /><em>clarity.</em> Progress<br />with purpose.</h1><p className="hero-intro">Free, thoughtfully curated resources for UPSC aspirants who are ready to show up for their future, one day at a time.</p><div className="hero-actions"><Button><a href={siteConfig.telegramUrl} target="_blank" rel="noreferrer">Join the community</a></Button><Button ghost onClick={() => navigate('/watchlist')}>Explore watchlist</Button></div></div><div className="hero-art"><div className="sun"></div><div className="art-note">For the<br /><strong>long road.</strong></div><div className="art-stamp">100%<br /><small>free to use</small></div><div className="art-lines"></div></div><div className="hero-scroll">Scroll to explore <span>↓</span></div></section>
  <section className="trust-strip"><span>Designed for the UPSC journey</span><strong>UPSC CSE</strong><strong>GS I — IV</strong><strong>NCERTs</strong><strong>Current Affairs</strong><strong>Answer Writing</strong></section>
  <section className="section intro-section"><div className="section-label">01 / The FUP approach</div><div className="intro-grid"><h2>Less noise.<br /><em>More direction.</em></h2><div><p className="large-copy">The internet has enough information. What aspirants need is a clear path through it.</p><p>FUP brings the essentials together, removes the overwhelm and gives you a steady place to begin, return to and grow from.</p><button className="arrow-link" onClick={() => navigate('/about')}>Our approach <span>↗</span></button></div></div></section>
  <section className="resource-section"><div className="section resource-head"><div className="section-label">02 / What we provide</div><h2>Everything you need<br />to <em>start strong.</em></h2></div><div className="resource-grid">{[['01', 'Study material', 'Short, reliable notes and resources that respect your time.'], ['02', 'Newspaper guidance', 'Learn what matters, why it matters and how to remember it.'], ['03', 'NCERT direction', 'A no-confusion path through the foundational texts.'], ['04', 'YouTube watchlist', 'Hand-picked videos, organized by subject and stage.']].map(([number, title, text]) => <div className="resource-card" key={number}><span>{number}</span><h3>{title}</h3><p>{text}</p><b>↗</b></div>)}</div></section>
  <section className="section method-section"><div className="section-label">03 / A simple rhythm</div><div className="method-grid"><div><h2>Preparation is<br /><em>a practice.</em></h2><p className="large-copy">The best strategy is one you can return to on an ordinary Tuesday.</p></div><div className="steps">{[['01', 'Choose your focus', 'Start with one subject, one source and one achievable goal.'], ['02', 'Build your base', 'Let clear concepts come before speed, volume or comparison.'], ['03', 'Keep showing up', 'Small, consistent sessions compound into real confidence.']].map(([n, t, d]) => <div className="step" key={n}><span>{n}</span><div><h3>{t}</h3><p>{d}</p></div></div>)}</div></div></section>
  <section className="quote-section"><div className="quote-mark">“</div><blockquote>We are not here to make preparation look easy. We are here to make the next step feel clear.</blockquote><p>— The FUP promise</p></section>
  <section className="section faq-section"><div className="section-label">04 / Questions, answered</div><div className="faq-grid"><h2>Clarity feels<br /><em>lighter.</em></h2><div>{faqs.map(([question, answer]) => <details key={question}><summary>{question}<span>+</span></summary><p>{answer}</p></details>)}</div></div></section>
  <section className="final-cta"><p className="eyebrow">Your journey starts here</p><h2>One good decision<br /><em>can change the year.</em></h2><Button><a href={siteConfig.telegramUrl} target="_blank" rel="noreferrer">Join FUP on Telegram</a></Button></section>
</> }
function PageHero({ label, title, intro }: { label: string; title: React.ReactNode; intro: string }) { return <section className="page-hero"><p className="eyebrow">{label}</p><h1>{title}</h1><p className="page-intro">{intro}</p></section> }
function About({ navigate }: { navigate: (path: string) => void }) { return <><PageHero label="About FUP" title={<>A little more<br /><em>intention.</em></>} intro="FUP is a free preparation companion for aspirants who want a calmer, more considered way to prepare for the civil services." /><section className="section about-body"><div className="section-label">Our reason for being</div><div><p className="large-copy">UPSC preparation can be lonely, expensive and unnecessarily confusing.</p><p>We believe the first step towards a better preparation ecosystem is simple: make the right information easier to find. FUP is our attempt to do that with care. No noise. No false promises. Just useful resources and a community that understands the long road.</p><Button onClick={() => navigate('/watchlist')}>Explore the watchlist</Button></div></section><section className="values"><div><span>01</span><h2>Useful over<br /><em>impressive.</em></h2></div><div><span>02</span><h2>Progress over<br /><em>perfection.</em></h2></div><div><span>03</span><h2>Community over<br /><em>competition.</em></h2></div></section></> }
function Watchlist() {
  const [searchParams] = useSearchParams()
  const [active, setActive] = useState(() => {
    const requestedStream = searchParams.get('stream')
    return watchlistCategories.some(item => item.id === requestedStream) ? requestedStream as string : 'gs'
  })
  const [activeSubject, setActiveSubject] = useState(gsWatchlist[0].subject)
  const [activeVideo, setActiveVideo] = useState(0)
  const category = watchlistCategories.find(item => item.id === active)!
  const isGs = active === 'gs'
  const selectedResource = gsWatchlist.find(resource => resource.subject === activeSubject) ?? gsWatchlist[0]
  const videos = selectedResource.videos ?? [{ title: selectedResource.firstVideoTitle, videoId: selectedResource.firstVideoId }]
  const selectedVideo = videos[activeVideo] ?? videos[0]
  const embedUrl = selectedVideo.videoId
    ? `https://www.youtube.com/embed/${selectedVideo.videoId}?list=${selectedResource.playlistId}&rel=0`
    : `https://www.youtube.com/embed?list=${selectedResource.playlistId}&index=${selectedVideo.index}&rel=0`
  const selectSubject = (subject: string) => { setActiveSubject(subject); setActiveVideo(0) }
  const selectStream = (streamId: string) => {
    setActive(streamId)
    if (streamId === 'gs') { setActiveSubject(gsWatchlist[0].subject); setActiveVideo(0) }
  }
  return <>
    <PageHero label="The FUP watchlist" title={<>Watch less.<br /><em>Learn more.</em></>} intro="A hand-picked library of videos that will eventually make your YouTube hours count. Organized by what you are actually trying to learn." />
    <section className={`section watch-body ${isGs ? 'watch-body-gs' : ''}`}>
      <div className="category-list">
        <div className="category-heading">Choose a stream</div>
        {watchlistCategories.map(item => <button className={active === item.id ? 'selected' : ''} onClick={() => selectStream(item.id)} key={item.id}><span>{item.short}</span>{item.label}<b>↗</b></button>)}
        {isGs && <div className="subject-list">
          <div className="category-heading">GS subjects</div>
          {gsWatchlist.map((resource, index) => <button className={`subject-button ${selectedResource.subject === resource.subject ? 'selected' : ''}`} onClick={() => selectSubject(resource.subject)} key={resource.subject}><span>{String(index + 1).padStart(2, '0')}</span><strong>{resource.subject}</strong><small>{resource.source}</small></button>)}
        </div>}
      </div>
      {isGs ? <div className="gs-content">
        <div className="gs-heading"><div><div className="coming-badge">Curated for GS</div><h2>General Studies<br /><em>with intention.</em></h2></div><p>{category.description} Start with one reliable source for each core subject and build steadily.</p></div>
        <div className="gs-player"><div className="gs-player-meta"><div><span className="section-label">Now studying · {selectedResource.source}</span><h3>{selectedResource.subject}</h3><p>{selectedVideo.title}</p></div><span className="gs-player-note">{videos.length} videos in playlist</span></div><div className="gs-embed"><iframe src={embedUrl} title={`${selectedResource.subject} UPSC playlist`} allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen></iframe></div></div>
        <div className="playlist-panel"><div className="playlist-panel-head"><span className="section-label">{selectedResource.subject} playlist</span><a href={selectedResource.playlistUrl} target="_blank" rel="noreferrer">Open on YouTube ↗</a></div><div className="playlist-items">{videos.map((video, index) => <button className={activeVideo === index ? 'selected' : ''} onClick={() => setActiveVideo(index)} key={`${video.title}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><strong>{video.title}</strong><b>{activeVideo === index ? 'Playing' : 'Watch'} ↗</b></button>)}</div></div>
      </div> : <div className="gs-content">
        <div className="gs-heading"><div><div className="coming-badge">Curated for {category.short}</div><h2>{category.label}<br /><em>with intention.</em></h2></div><p>{category.description}</p></div>
        <div className="gs-resource-grid">
          {(watchlistPlaylists[active] ?? []).map(playlist => <article className="gs-resource" key={playlist.topic}>
            <img src={playlist.thumbnailUrl} alt={`${playlist.topic} playlist thumbnail`} loading="lazy" style={{ width: '100%', height: 'auto' }} />
            <div className="gs-resource-top"><span>{playlist.topic}</span></div>
            <h3>{playlist.title}</h3>
            <p className="gs-source">{playlist.author}</p>
            <p className="gs-video-title">{playlist.description}</p>
            <div className="gs-resource-actions"><a className="button" href={playlist.playlistUrl} target="_blank" rel="noopener noreferrer">Go to Playlist <span>↗</span></a></div>
          </article>)}
        </div>
      </div>}
    </section>
  </>
}
function Blog({ navigate }: { navigate: (path: string) => void }) {
  const [filter, setFilter] = useState('All')
  const [dailyPosts, setDailyPosts] = useState<DailyBlogPost[]>([])
  useEffect(() => {
    let active = true
    fetch('/posts.json')
      .then(response => {
        if (!response.ok) throw new Error(`posts.json returned HTTP ${response.status}`)
        return response.json() as Promise<unknown>
      })
      .then(value => {
        if (!Array.isArray(value)) throw new Error('posts.json must contain an array')
        if (active) setDailyPosts(value.filter(isDailyBlogPost).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)))
      })
      .catch(error => console.error('Unable to load daily blog posts', error))
    return () => { active = false }
  }, [])
  const entries: (Article | DailyBlogPost)[] = [...dailyPosts, ...articles]
  const categories = ['All', ...new Set(entries.map(article => article.category))]
  const filtered = filter === 'All' ? entries : entries.filter(article => article.category === filter)
  return <>
    <PageHero label="The FUP journal" title={<>Notes for the<br /><em>long road.</em></>} intro="Thoughts, frameworks and useful explainers for making your preparation a little more deliberate." />
    <section className="section blog-body">
      <div className="filter-row">{categories.map(category => <button className={filter === category ? 'selected' : ''} onClick={() => setFilter(category)} key={category}>{category}</button>)}</div>
      <div className="article-grid">{filtered.map((article, index) => <article className={index === 0 ? 'featured-article' : ''} key={'href' in article ? article.href : article.slug}>
        <div className="article-image"><span>{article.category}</span><b>{String(index + 1).padStart(2, '0')}</b></div>
        <div className="article-meta">{article.date}<span>•</span>{article.readTime}</div>
        <h2>{article.title}</h2><p>{article.excerpt}</p>
        {'href' in article
          ? <a className="arrow-link" href={article.href}>Read note <span>↗</span></a>
          : <button className="arrow-link" onClick={article.content ? () => navigate(`/blog/${article.slug}`) : undefined} disabled={!article.content}>{article.content ? 'Read note' : 'Coming soon'} <span>↗</span></button>}
      </article>)}</div>
    </section>
  </>
}
function renderBlogBlock(block: string, key: number) {
  if (block.startsWith('### ')) return <h3 key={key}>{block.slice(4)}</h3>
  const parts = block.split(/(\[[^\]]+\]\([^)]+\))/g)
  return <p key={key}>{parts.map((part, index) => {
    const match = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    return match ? <Link key={index} to={match[2]}>{match[1]}</Link> : part
  })}</p>
}
function BlogPost({ navigate }: { navigate: (path: string) => void }) { const { slug } = useParams(); const article = articles.find(a => a.slug === slug); if (!article || !article.content) return <Blog navigate={navigate} />; return <><PageHero label={article.category} title={article.title} intro={article.excerpt} /><section className="section legal-copy"><button className="arrow-link" onClick={() => navigate('/blog')}>← Back to the journal</button><p className="article-meta">{article.date}<span>•</span>{article.readTime}</p>{article.content.map((block, i) => renderBlogBlock(block, i))}</section></> }
function Privacy() { return <><PageHero label="Privacy policy" title={<>Your trust is<br /><em>not data.</em></>} intro="A short, clear explanation of how FUP handles the little information you share with us." /><section className="section legal-copy"><p className="large-copy">We keep things simple.</p><h3>What we collect</h3><p>FUP does not require an account to browse the website. If you contact us by email, we only use your message to respond to you. Telegram is governed by Telegram's own privacy policy.</p><h3>Analytics and cookies</h3><p>We aim to keep this website lightweight. If analytics are added in the future, this policy will be updated before they are used.</p><h3>Contact</h3><p>Questions about privacy can be sent to <a href={`mailto:${siteConfig.email}`}>{siteConfig.email}</a>.</p></section></> }
export default App