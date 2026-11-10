import assert from 'node:assert/strict'
import { verifyGeneratedArticle } from './daily-blog.js'

const source = 'The programme was announced on 10 NOV 2026. It provides Rs. 1,250 crore and records a 12 per cent increase.'
const article = {
  title: 'Programme announced on 10 November 2026',
  meta_description: 'The source records Rs 1,250 crore and a 12% increase.',
  html_body: '<p>The programme was announced on 10 November 2026.</p><p>It provides ₹1,250 crore and records a 12 per cent increase.</p>',
  facts: [{
    claim: 'The source reports its funding.',
    exact_quote_from_source: 'It provides Rs. 1,250 crore',
  }],
}

assert.deepEqual(verifyGeneratedArticle(article, source), {
  passed: true,
  missingQuotes: [],
  rejectedNumbers: [],
})

const inaccurate = {
  ...article,
  html_body: `${article.html_body}<p>The programme covers 15 districts.</p>`,
}
const failed = verifyGeneratedArticle(inaccurate, source)
assert.equal(failed.passed, false)
assert.equal(failed.rejectedNumbers.some(value => value.includes('15')), true)

const inaccurateQuote = {
  ...article,
  facts: [{
    claim: 'The source reports a different amount.',
    exact_quote_from_source: 'It provides Rs. 1,500 crore',
  }],
}
assert.equal(verifyGeneratedArticle(inaccurateQuote, source).missingQuotes.length, 1)

console.log('Daily blog verification sample passed; unsupported number was rejected.')
