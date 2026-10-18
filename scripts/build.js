// Builds the package.
//
// 1. Compiles src/ twice with tsc: once as ES modules into dist/esm and once as
//    CommonJS into dist/cjs. Each output directory gets its own package.json
//    that pins the module format.
// 2. Rewrites the CommonJS output so that `require()` returns the same shapes
//    the pre-TypeScript CommonJS sources had, see applyCjsInterop.
// 3. Rewrites the CommonJS declarations of the entry point into the
//    `export = libmime` layout of @types/libmime, see rewriteCjsEntryDeclaration.

import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tsc = require.resolve('typescript/bin/tsc');

function runTsc(project, ...args) {
    const result = spawnSync(process.execPath, [tsc, '-p', project, ...args], { cwd: root, stdio: 'inherit' });
    if (result.status !== 0) {
        process.exit(result.status || 1);
    }
}

function listFiles(dir, ext) {
    return fs
        .readdirSync(dir, { recursive: true })
        .filter(name => name.endsWith(ext))
        .map(name => path.join(dir, name));
}

// How the CommonJS output of every module with a default export is rewritten, so that
// `require()` returns the shape the pre-TypeScript CommonJS sources had
//
// - libmime.js used to be `module.exports = new Libmime()` with the class attached as
//   `module.exports.Libmime`. The default export is that instance, and the source attaches
//   the class to it, so `require()` returns the instance. The non-enumerable `.default`
//   alias is what TypeScript and Babel generated `import libmime from 'libmime'` code reads
// - charsets.js used to be `module.exports = { alias: name }`. `require()` returns the table
//   itself, without a `.default` alias: it is data that is looked up by key
// - charset.js and mimetypes.js used to be `module.exports = { ... }` with functions or tables
//   as members. They keep their named exports, and the default export (the same members as
//   one object, for `import charset from 'libmime/lib/charset'`) is the exports object itself
const CJS_SHIMS = {
    'libmime.js':
        'module.exports = exports.default;\n' +
        "Object.defineProperty(module.exports, 'default', { value: exports.default, enumerable: false, writable: true, configurable: true });\n",
    'charsets.js': 'module.exports = exports.default;\n',
    'charset.js': "Object.defineProperty(exports, 'default', { value: exports, enumerable: false, writable: true, configurable: true });\n",
    'mimetypes.js': "Object.defineProperty(exports, 'default', { value: exports, enumerable: false, writable: true, configurable: true });\n"
};

// tsc emits `exports.default = X` for `export default X`. A module with a default export that
// is not listed above fails the build, its CommonJS shape has to be decided explicitly
function applyCjsInterop(dir) {
    for (const file of listFiles(dir, '.js')) {
        const source = fs.readFileSync(file, 'utf8');
        if (!/\bexports\.default\s*=/.test(source)) {
            continue;
        }
        const name = path.relative(dir, file);
        if (!Object.hasOwn(CJS_SHIMS, name)) {
            throw new Error(name + ' has a default export, list its CommonJS shape in CJS_SHIMS in scripts/build.js');
        }
        // Appends the shim ahead of the source map comment if there is one
        const mapComment = source.lastIndexOf('//# sourceMappingURL=');
        const shim = CJS_SHIMS[name];
        fs.writeFileSync(file, mapComment === -1 ? source + shim : source.slice(0, mapComment) + shim + source.slice(mapComment));
    }
}

// `require('libmime')` returns the instance, so the CommonJS declarations describe the module as
// that instance (`export = libmime`), the way @types/libmime did. Code written against those
// typings (`import libmime = require('libmime')`, `import * as libmime from 'libmime'`, JSDoc
// `import('libmime').StructuredHeader`) keeps compiling. The public types are members of the
// type-only namespace merged with the instance in src/libmime.ts, as an `export =` module can
// have no other exports
function rewriteCjsEntryDeclaration(dir) {
    const file = path.join(dir, 'libmime.d.ts');
    const source = fs.readFileSync(file, 'utf8');
    const rewritten = source
        .replace(/^export type \* from '\.\/types\.js';\n/m, '')
        .replace(/^export declare class Libmime\b/m, 'declare class Libmime')
        .replace(/^export default libmime;$/m, 'export = libmime;');

    const leftover = rewritten.split('\n').filter(line => /^export\b/.test(line) && line !== 'export = libmime;');
    if (leftover.length || !rewritten.includes('export = libmime;')) {
        throw new Error('dist/cjs/libmime.d.ts can not be rewritten to the export = layout: ' + (leftover.join(', ') || 'unexpected layout'));
    }
    fs.writeFileSync(file, rewritten);
}

function build() {
    fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });

    runTsc('tsconfig.esm.json');
    // The ES module compile has already type-checked the same sources
    runTsc('tsconfig.cjs.json', '--noCheck');

    fs.writeFileSync(path.join(root, 'dist', 'esm', 'package.json'), JSON.stringify({ type: 'module' }, null, 4) + '\n');
    fs.writeFileSync(path.join(root, 'dist', 'cjs', 'package.json'), JSON.stringify({ type: 'commonjs' }, null, 4) + '\n');

    applyCjsInterop(path.join(root, 'dist', 'cjs'));
    rewriteCjsEntryDeclaration(path.join(root, 'dist', 'cjs'));
}

build();
