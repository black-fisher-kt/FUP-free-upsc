import assert from 'node:assert/strict'
import { englishSourceText, groqJson, verifyGeneratedArticle } from './daily-blog.js'

const source = 'The programme was announced on 10 NOV 2026. It provides Rs. 1,250 crore and records a 12 per cent increase. The source lists १२ districts.'
const article = {
  title: 'Programme announced on 10 November 2026',
  meta_description: 'The source records Rs 1,250 crore and a 12% increase.',
  html_body: '<p>The programme was announced on 10 November 2026.</p><p>It provides ₹1,250 crore and records a 12 per cent increase.</p><p>The source lists 12 districts.</p>',
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
  html_body: `${article.html_body}<p>The programme covers १५ districts.</p>`,
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
assert.equal(englishSourceText('सरकारी स्रोत का पाठ'), '')
assert.equal(englishSourceText('सरकारी स्रोत का पाठ', 'Official source text in English.'), 'Official source text in English.')

const originalFetch = globalThis.fetch
const requests = []
try {
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body)
    requests.push(request)
    const truncated = request.model === 'openai/gpt-oss-120b'
    return new Response(JSON.stringify({
      choices: [{
        finish_reason: truncated ? 'length' : 'stop',
        message: { content: truncated ? '' : '{"ok":true}' },
      }],
    }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const result = await groqJson('test-key', [{ role: 'user', content: 'Return JSON.' }], 'sample retry')
  assert.equal(result.model, 'openai/gpt-oss-20b')
  assert.deepEqual(result.value, { ok: true })
  assert.deepEqual(requests.map(request => request.model), [
    'openai/gpt-oss-120b',
    'openai/gpt-oss-120b',
    'openai/gpt-oss-20b',
  ])
  assert.ok(requests.every(request => request.max_tokens >= 8000 && request.reasoning_effort === 'low'))
  assert.match(requests[1].messages.at(-1).content, /Retry instruction/)
} finally {
  globalThis.fetch = originalFetch
}

console.log('Daily blog keyless checks passed: English-source guard, Devanagari digits, factual verification, same-model retry, and fallback.')
