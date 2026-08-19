export const siteConfig = {
  name: 'Free UPSC Preparation',
  shortName: 'FUP',
  domain: 'https://freeupsc.online',
  telegramUrl: 'https://t.me/+VK2Zgo5UrrY0MDg1',
  email: 'hello@freeupsc.online',
  description: 'A calm, structured and completely free study companion for serious UPSC aspirants.',
}

export const watchlistCategories = [
  { id: 'gs', label: 'General Studies', short: 'GS', description: 'Conceptual clarity for the papers that shape your rank.' },
  { id: 'current-affairs', label: 'Current Affairs', short: 'CA', description: 'Context-rich explainers for a better understanding of the news.' },
  { id: 'ncert', label: 'NCERT Foundation', short: 'NC', description: 'The essential school texts, read with an exam lens.' },
  { id: 'optional', label: 'Optional Subjects', short: 'OP', description: 'A thoughtful starting point for choosing and mastering your optional.' },
]

export type Article = { title: string; excerpt: string; category: string; date: string; readTime: string; slug: string }

export const articles: Article[] = [
  { title: 'The calm way to begin your UPSC preparation', excerpt: 'A practical framework for turning a large syllabus into small, repeatable study days.', category: 'Strategy', date: 'Coming soon', readTime: '6 min read', slug: 'calm-way-to-begin' },
  { title: 'How to read the newspaper for UPSC', excerpt: 'Move beyond highlighting. Learn how to extract issues, arguments and useful examples.', category: 'Current Affairs', date: 'Coming soon', readTime: '8 min read', slug: 'read-newspaper-for-upsc' },
  { title: 'NCERTs: what to read, and what to skip', excerpt: 'A clean first-pass reading list for building a strong foundation without losing momentum.', category: 'Foundation', date: 'Coming soon', readTime: '5 min read', slug: 'ncert-reading-list' },
]

export const faqs = [
  ['Is FUP completely free?', 'Yes. Every resource we publish is designed to be accessible without a paid batch or subscription.'],
  ['What does FUP provide?', 'Curated study material, newspaper guidance, NCERT direction, a useful YouTube watchlist and practical preparation notes.'],
  ['Is this for beginners only?', 'No. We are building the library for every stage, from first reading to revision and answer-writing.'],
  ['Where will new resources be shared?', 'Join the Telegram community to receive fresh resources, updates and weekly study prompts.'],
]
