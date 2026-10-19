# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm test` - builds `dist/` (`pretest`), then runs every `test/**/*-test.ts` with the Node.js test runner through `tsx`.
- `npm run test:coverage` - the same suite under c8, fails below the thresholds in `.c8rc.json`. CI runs it on Node 24.
- `npm run test:bun` - the same suite under Bun.
- `npm run test:cjs` - builds `dist/`, then loads the CommonJS build and exercises the main API with `--no-experimental-require-module` (`test/cjs-smoke.cjs`). CI runs it on Node 22 and 24.
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

Production dependencies are intentionally minimal: `iconv-lite`, `encoding-japanese`, `libbase64`, `libqp`. QP and Base64 codecs are delegated to the sister `libqp` and `libbase64` packages, do not reimplement them here. Nodemailer has its own copy of the encoding functions (`../nodemailer/src/mime-funcs/`), a fix in one usually applies to the other.

## Build and module format

- `scripts/build.js` compiles `src/` twice (`tsconfig.esm.json`, `tsconfig.cjs.json`), writes a `package.json` with the module format into each output directory, and rewrites the CommonJS output so `require()` returns the old shapes: `require('libmime')` is the instance itself, `require('libmime/lib/charset')` and `require('libmime/lib/mimetypes')` are exports objects whose `.default` is the object itself, `require('libmime/lib/charsets')` is the table itself. It also rewrites `dist/cjs/libmime.d.ts` into the `export = libmime` layout. A module with a default export and named runtime exports fails the build unless listed in `scripts/build.js`.
- `package.json` `exports` maps `.` to both builds and `./lib/*` to the matching file under `dist/`, so `require('libmime/lib/charset')` style deep imports keep resolving.
- Every file must compile both ways: no `import.meta`, `require`, `module`, `__dirname`, top-level `await` or JSON imports under `src/`. Relative imports carry the `.js` extension. `erasableSyntaxOnly` is on (no enums, no namespaces with runtime code), `exactOptionalPropertyTypes` is on (optional properties are declared with `| undefined`).
- Keep the CommonJS build, see Platform constraints below.

## Platform constraints

Both rules come from EmailEngine, which ships as a `@yao-pkg/pkg` binary: pkg snapshots a CommonJS module graph and cannot load ES modules.

- **Node.js 20 is the minimum supported version.** Runtime code, tests and tooling must work on Node 20, 22 and 24 (`engines.node` is `>=20.0.0`, `@types/node` stays on the 20.x line).
- **Everything that reaches runtime must be genuinely CommonJS-loadable.** `require()` of the CommonJS build and of every runtime dependency, transitive ones included, must work with `--no-experimental-require-module`. Node 22+ (and 20.19) can `require()` an ES module by default, which hides an ESM-only dependency until the pkg binary fails. A CommonJS entry that only wraps a dynamic `import()` does not count.
- **Check:** `npm run test:cjs`. Run it after `npm run update` or any dependency change; CI runs it on Node 22 and 24.
- Never add or upgrade to an ESM-only dependency. When a dependency's next major is ESM-only, pin the last CommonJS major in `.ncurc.cjs` (`reject`, or a `target` of `minor`/`patch`) with a comment giving the reason.

## Testing

- Tests use `describe`/`it` from `node:test` and `assert` from `node:assert/strict`. `test/libmime-test.ts` covers the library, `test/package/package-test.ts` loads the built `dist/` through the exports map (including plain `node` CommonJS and ES module consumers), `test/package/types-consumer-test.ts` type-checks consumers against the built declarations (ES modules, CommonJS written against `@types/libmime`, checkJs, node10 resolution).
- `parseHeaderValue`, `decodeWords` and `decodeHeaders` parse untrusted input from email messages: add hostile and malformed input cases there, and a linear-time check (`expectLinear`) for anything that loops over input.

## Release flow

Versioning and the changelog are managed by release-please via `.github/workflows/release.yaml`. Release commits look like `chore(master): release X.Y.Z [skip-ci]`. Do not bump `version` in `package.json` or edit `CHANGELOG.md` by hand; let the release PR do it. Use Conventional Commit prefixes (`fix:`, `feat:`, `chore:`, ...).

## Conventions

These mirror the conventions used across Postal Systems projects (see `../emailengine`).

**Git commits**

- Use Conventional Commits: `fix:` (patch release), `feat:` (minor release), and `chore:`/`build:`/`docs:`/`ci:`/`refactor:`/`style:`/`test:` for changes that should not trigger a release. release-please derives the version and changelog from these prefixes, so tooling changes never use `fix:` or `feat:`.
- Do not list Claude or any AI assistant as a co-author or co-contributor in commit messages or PR descriptions (no `Co-Authored-By` trailer).
- Append `[skip ci]` to commits that do not change runtime behavior (docs, comments, formatting) to avoid spending CI minutes. Never add it to a `fix:` or `feat:` commit, those must run so the release workflow triggers, and never to a commit that changes the tooling itself (lint, format, test or CI configuration), since CI is what validates it. GitHub reads the marker off the HEAD commit of a push, so when a push mixes the two the release-triggering commit has to be last.

**Code and docs style**

- No emojis anywhere in code or documentation, printable ASCII only.
- Use a single hyphen-minus (`-`) as a dash in user-facing strings and docs. Never use double hyphens (`--`), em dashes, or en dashes.
- Dependencies are pinned to exact versions (no `^` or `~`). `.ncurc.cjs` documents the version caps `npm run update` respects.

**Before committing code changes**

1. `npm run format` and `npm run lint`
2. `npm test`
3. For non-trivial changes, consider `/simplify` (quality cleanup) and `/security-review`: the header and encoded-word parsers handle untrusted input from email messages.

**After pushing**

- Check the workflow runs for the push (`gh run list --branch <branch>`) and report their status. CI installs with `npm ci`, so `package-lock.json` must stay in sync with `package.json`. If a run fails for an unrelated or infrastructure reason (checkout reporting "account suspended", HTTP 403, other auth errors), check <https://www.githubstatus.com/> for an active GitHub incident before assuming the change caused it.
