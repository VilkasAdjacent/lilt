# Vendored dependencies

No build step: these are plain ES modules committed to the repo.

| Package | Version | Licence | Notes |
|---|---|---|---|
| pitchy | 4.1.0 | MIT (see LICENSE-pitchy) | `import "fft.js"` rewritten to `./fft.js` |
| fft.js | 4.0.4 | MIT (Fedor Indutny) | CommonJS wrapped as ESM (`export default module.exports`) |

To update: `npm i pitchy@x` in a scratch dir, then repeat the two edits above.
