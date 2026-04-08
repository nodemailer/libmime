# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` — runs the full Grunt task: ESLint over `lib/`, `test/`, and `Gruntfile.js`, followed by Mocha (`grunt-mocha-test`) over `test/*-test.js`.
- `npx grunt eslint` / `npx grunt mochaTest` — run lint or tests in isolation.
- Run a single test file or filter:
  - `npx mocha test/libmime-test.js` (whole file)
  - `npx mocha test/libmime-test.js --grep '#decodeWords'` (filter by `describe`/`it`)
- `npm run update` — wipes `node_modules` and `package-lock.json`, runs `ncu -u` (config in `.ncurc.js`), then reinstalls. Use only for a deliberate dependency refresh.

## Architecture

`libmime` is a small MIME utility library used by Nodemailer. It is shipped as a single class exported as a pre-instantiated singleton:

```js
module.exports = new Libmime();
module.exports.Libmime = Libmime; // class also exported for custom instances
```

`lib/libmime.js` is the public surface — `isPlainText`, `encodeWord(s)`, `decodeWords`, `foldLines`, `encodeFlowed`/`decodeFlowed`, `decodeHeader(s)`, `parseHeaderValue`, `buildHeaderValue`, `buildHeaderParam`, `detectExtension`, `detectMimeType`, plus internal helpers like `safeEncodeURIComponent`. The class holds a `config` object passed to the constructor; consumers normally use the singleton, but can `new Libmime(config)` for per-instance state.

The remaining `lib/` modules are leaf helpers consumed only by `libmime.js`:

- `lib/charset.js` — encode/decode between Buffers and strings via `iconv-lite`, with a Japanese-encoding fast path through `encoding-japanese`. Also exposes `normalizeCharset`, which is the canonical place where charset aliases are resolved.
- `lib/charsets.js` + `lib/get-charset-name.js` — static lookup tables for charset alias normalization. `get-charset-name.js` lists the charsets natively supported by Node's ICU build (note: `iso-8859-16` is intentionally absent).
- `lib/mimetypes.js` — bidirectional MIME type ↔ file extension table backing `detectExtension`/`detectMimeType`. Default fallback is `application/octet-stream` / `bin`.

Production dependencies are intentionally minimal: `iconv-lite`, `encoding-japanese`, `libbase64`, `libqp`. QP and Base64 codecs are delegated to the sister `libqp` and `libbase64` packages — do not reimplement them here.

Only `lib/` and `CHANGELOG.md` are published to npm (see `files` in `package.json`); anything outside `lib/` is dev-only and will not reach consumers.

## Release flow

Versioning and the changelog are managed by release-please via `.github/workflows/release.yaml` — release commits look like `chore(master): release X.Y.Z [skip-ci]`. Do not bump `version` in `package.json` or edit `CHANGELOG.md` by hand; let the release PR do it.

## Lint config

ESLint extends `eslint-config-nodemailer` (see `.eslintrc`), with `indent` and `no-prototype-builtins` disabled locally. Formatting is Prettier via `.prettierrc.js`. The lint task is part of `npm test`, so a failing lint blocks the test run.
