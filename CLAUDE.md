# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` - builds `dist/` (`pretest`), then runs every `test/**/*-test.ts` with the Node.js test runner through `tsx`.
- `npm run test:coverage` - the same suite under c8, fails below the thresholds in `.c8rc.json`. CI runs it on Node 24.
- `npm run test:bun` - the same suite under Bun.
- `npm run lint` - `tsc --noEmit` over `src/` and `test/`, then ESLint (`eslint.config.js`, type-aware rules on `src/`).
- `npm run format` / `npm run format:check` - Prettier (`.prettierrc`).
- `npm run build` - produces `dist/` (also runs on install and before publish through `prepare`).
- Single file: `node --import tsx --test test/libmime-test.ts`, filter with `--test-name-pattern '#decodeWords'`.
- `npm run update` - wipes `node_modules` and `package-lock.json`, runs `ncu -u` (config in `.ncurc.cjs`), then reinstalls. Use only for a deliberate dependency refresh.

## Architecture

`libmime` is a small MIME utility library used by Nodemailer, mailparser, ImapFlow and EmailEngine. It is written in TypeScript under `src/` and published as a dual package: ES modules in `dist/esm/` and CommonJS in `dist/cjs/`, each with type declarations. Node.js 20 or newer (`engines.node`).

`src/libmime.ts` is the entry point: the `Libmime` class (`isPlainText`, `encodeWord(s)`, `decodeWord(s)`, `foldLines`, `encodeFlowed`/`decodeFlowed`, `decodeHeader(s)`, `parseHeaderValue`, `buildHeaderValue`, `buildHeaderParam`, `detectExtension`, `detectMimeType`, `splitMimeEncodedString`, `safeEncodeURIComponent`, ...). The default export is a shared instance with the class attached as `.Libmime`, the same shape the pre-TypeScript `module.exports = new Libmime(); module.exports.Libmime = Libmime` had. Public types live in `src/types.ts`, are re-exported from the entry point, and are also members of a type-only namespace merged with the default export (`libmime.StructuredHeader`, the layout of `@types/libmime`).

The other modules:

- `src/charset.ts` - encode/decode between Buffers and strings via `iconv-lite`, with a Japanese-encoding fast path through `encoding-japanese`. `normalizeCharset` is the canonical place where charset aliases are resolved. Named exports plus a default export object of the same functions.
- `src/charsets.ts` - the charset alias table (default export only). `src/get-charset-name.ts` lists the charsets natively supported by Node's ICU build (`iso-8859-16` is intentionally absent); not used internally, kept for `libmime/lib/get-charset-name` deep imports.
- `src/mimetypes.ts` - MIME type to extension (`list`) and extension to MIME type (`extensions`) tables backing `detectExtension`/`detectMimeType`. Default fallback is `application/octet-stream` / `bin`. Keys are kept in alphabetical order.
- `src/vendor-types.d.ts` - minimal declarations for `libqp` and `libbase64`, which ship no types.

Production dependencies are intentionally minimal: `iconv-lite`, `encoding-japanese`, `libbase64`, `libqp`. QP and Base64 codecs are delegated to the sister `libqp` and `libbase64` packages, do not reimplement them here. Nodemailer has its own copy of the encoding functions (`../nodemailer/src/mime-funcs/`), a fix in one usually applies to the other.

## Build and module format

- `scripts/build.js` compiles `src/` twice (`tsconfig.esm.json`, `tsconfig.cjs.json`), writes a `package.json` with the module format into each output directory, and rewrites the CommonJS output so `require()` returns the old shapes: `require('libmime')` is the instance itself, `require('libmime/lib/charset')` and `require('libmime/lib/mimetypes')` are exports objects whose `.default` is the object itself, `require('libmime/lib/charsets')` is the table itself. It also rewrites `dist/cjs/libmime.d.ts` into the `export = libmime` layout. A module with a default export and named runtime exports fails the build unless listed in `scripts/build.js`.
- `package.json` `exports` maps `.` to both builds and `./lib/*` to the matching file under `dist/`, so `require('libmime/lib/charset')` style deep imports keep resolving.
- Every file must compile both ways: no `import.meta`, `require`, `module`, `__dirname`, top-level `await` or JSON imports under `src/`. Relative imports carry the `.js` extension. `erasableSyntaxOnly` is on (no enums, no namespaces with runtime code), `exactOptionalPropertyTypes` is on (optional properties are declared with `| undefined`).
- EmailEngine bundles its dependencies with `@yao-pkg/pkg`, which only follows `require()`. Keep the CommonJS build, and never add a pure-ESM production dependency; after `npm run update` check that every dependency still loads with `require()` (`test/package/package-test.ts` checks this too).

## Testing

- Tests use `describe`/`it` from `node:test` and `assert` from `node:assert/strict`. `test/libmime-test.ts` covers the library, `test/package/package-test.ts` loads the built `dist/` through the exports map (including plain `node` CommonJS and ES module consumers), `test/package/types-consumer-test.ts` type-checks consumers against the built declarations (ES modules, CommonJS written against `@types/libmime`, checkJs, node10 resolution).
- `parseHeaderValue`, `decodeWords` and `decodeHeaders` parse untrusted input from email messages: add hostile and malformed input cases there, and a linear-time check (`expectLinear`) for anything that loops over input.

## Release flow

Versioning and the changelog are managed by release-please via `.github/workflows/release.yaml`. Release commits look like `chore(master): release X.Y.Z [skip-ci]`. Do not bump `version` in `package.json` or edit `CHANGELOG.md` by hand; let the release PR do it. Use Conventional Commit prefixes (`fix:`, `feat:`, `chore:`, ...).
