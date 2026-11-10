# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Daily UPSC blog

The `daily-blog` GitHub Actions workflow runs at 07:00 India time and can also be started with **Actions → Publish daily UPSC blog → Run workflow**. Add a repository Actions secret named `GROQ_API_KEY`. The script uses `openai/gpt-oss-120b` and falls back to `openai/gpt-oss-20b` if needed. Generated articles are English-only and are published only after full official source text and factual checks pass.

The workflow reads PIB Press Releases and Features, The Indian Express India, and The Hindu national RSS feeds. Unavailable feeds are skipped. It writes generated pages under `public/blog/`, updates `public/posts.json` and `public/feed.xml`, runs the regular site build (which generates the sitemap and prerenders public route content into the HTML), and commits only when generated content changed.

To test verification locally without a key, run `node scripts/test-daily-blog-verification.js`. To run the live generator with Node.js 20, set `GROQ_API_KEY` in your shell and run `node scripts/daily-blog.js`, followed by `npm run build`. Never put the key in source files or commit it.
