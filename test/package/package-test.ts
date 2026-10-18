import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { hasDist, root, runInConsumer } from './helpers.js';

// These tests exercise the compiled output in dist/ (built by the pretest
// script) through the package.json exports map, the same way an installed
// copy of the package is loaded. Node resolves the package name to the
// package itself when the specifier is used from inside the package.
const require = createRequire(import.meta.url);

// Non-literal specifiers keep TypeScript from resolving the built types at
// type-check time, when dist/ may not exist yet
const packageName: string = 'libmime';
const subpath = (name: string) => packageName + '/lib/' + name;

// The methods of the pre-TypeScript Libmime class, all of them reachable on the shared instance
const METHODS = [
    'buildHeaderParam',
    'buildHeaderValue',
    'decodeFlowed',
    'decodeHeader',
    'decodeHeaders',
    'decodeWord',
    'decodeWords',
    'detectExtension',
    'detectMimeType',
    'encodeFlowed',
    'encodeURICharComponent',
    'encodeWord',
    'encodeWords',
    'foldLines',
    'getHex',
    'hasLongerLines',
    'isPlainText',
    'normalizeCharset',
    'parseHeaderValue',
    'safeEncodeURIComponent',
    'splitMimeEncodedString'
];

const MODULES = ['libmime', 'charset', 'charsets', 'mimetypes', 'get-charset-name'];

describe('Built package', { timeout: 30 * 1000, skip: hasDist ? false : 'dist/ is not built, run npm run build first' }, () => {
    it('ships both module formats with type declarations', () => {
        for (const format of ['esm', 'cjs']) {
            for (const name of MODULES) {
                assert.ok(fs.existsSync(path.join(root, 'dist', format, name + '.js')), format + ' ' + name);
                assert.ok(fs.existsSync(path.join(root, 'dist', format, name + '.d.ts')), format + ' ' + name + ' type declarations');
            }
        }
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'dist', 'esm', 'package.json'), 'utf8')), { type: 'module' });
        assert.deepStrictEqual(JSON.parse(fs.readFileSync(path.join(root, 'dist', 'cjs', 'package.json'), 'utf8')), { type: 'commonjs' });
    });

    it('points every exports entry at an existing file', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        assert.strictEqual(pkg.exports['.'].import, './dist/esm/libmime.js');
        assert.strictEqual(pkg.exports['.'].require, './dist/cjs/libmime.js');
        assert.strictEqual(pkg.main, './dist/cjs/libmime.js');
        assert.ok(fs.existsSync(path.join(root, pkg.types)), 'types entry exists');
        for (const [subpath, entry] of Object.entries(pkg.exports)) {
            if (subpath.includes('*')) {
                continue;
            }
            const targets = typeof entry === 'string' ? [entry] : Object.values(entry as Record<string, string>);
            for (const target of targets) {
                assert.ok(fs.existsSync(path.join(root, target)), subpath + ' points at a missing file ' + target);
            }
        }
    });

    it('does not ship the TypeScript sources or the test suite', () => {
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        assert.ok(pkg.files.includes('dist'));
        assert.ok(!pkg.files.includes('src'));
        assert.ok(!pkg.files.includes('test'));
    });

    it('keeps the production dependencies loadable with require()', () => {
        // EmailEngine bundles libmime with @yao-pkg/pkg, which follows the require() graph only
        const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
        for (const name of Object.keys(pkg.dependencies)) {
            const depPkg = JSON.parse(fs.readFileSync(require.resolve(name + '/package.json'), 'utf8'));
            assert.notStrictEqual(depPkg.type, 'module', name + ' is a pure ES module package');
            assert.ok(require(name), name);
        }
    });

    describe('CommonJS build', () => {
        it('resolves require() to the CommonJS entry point', () => {
            assert.strictEqual(require.resolve(packageName), path.join(root, 'dist', 'cjs', 'libmime.js'));
            assert.strictEqual(require.resolve(subpath('charset')), path.join(root, 'dist', 'cjs', 'charset.js'));
            assert.strictEqual(require.resolve(subpath('charset.js')), path.join(root, 'dist', 'cjs', 'charset.js'));
        });

        it('returns the shared instance with the class attached, as before', () => {
            const libmime = require(packageName);
            assert.strictEqual(typeof libmime.Libmime, 'function');
            assert.ok(libmime instanceof libmime.Libmime);
            assert.deepStrictEqual(Object.keys(libmime), ['config', 'Libmime']);
            assert.deepStrictEqual(libmime.config, {});
            for (const method of METHODS) {
                assert.strictEqual(typeof libmime[method], 'function', method);
            }
            // transpiled `import libmime from 'libmime'` reads .default
            assert.strictEqual(libmime.default, libmime);
            assert.ok(!Object.keys(libmime).includes('default'));
            assert.strictEqual(require(subpath('libmime')), libmime);
        });

        it('keeps the instance methods working', () => {
            const libmime = require(packageName);
            assert.strictEqual(libmime.decodeWords('=?ISO-8859-1?Q?J=F5ge?='), 'Jõge');
            assert.strictEqual(libmime.encodeWord('Jõge'), '=?UTF-8?Q?J=C3=B5ge?=');
            assert.deepStrictEqual(libmime.parseHeaderValue('text/plain; charset=utf-8'), { value: 'text/plain', params: { charset: 'utf-8' } });
            const custom = new libmime.Libmime({ key: 'value' });
            assert.deepStrictEqual(custom.config, { key: 'value' });
            assert.strictEqual(custom.detectMimeType('a.txt'), 'text/plain');
        });

        it('keeps deep imports returning their old shapes', () => {
            const charset = require(subpath('charset'));
            assert.deepStrictEqual(Object.keys(charset).sort(), ['convert', 'decode', 'encode', 'normalizeCharset']);
            assert.strictEqual(charset.default, charset);
            assert.strictEqual(charset.decode(Buffer.from([0xf5]), 'latin1'), 'õ');

            // the alias table itself, not an exports object around it
            const charsets = require(subpath('charsets'));
            assert.strictEqual(charsets.utf8, 'UTF-8');
            assert.ok(!('default' in charsets));
            assert.strictEqual(typeof charsets.hasOwnProperty, 'function');

            const mimetypes = require(subpath('mimetypes'));
            assert.deepStrictEqual(Object.keys(mimetypes).sort(), ['extensions', 'list']);
            assert.strictEqual(mimetypes.extensions.txt, 'text/plain');

            const { getCharsetName } = require(subpath('get-charset-name'));
            assert.strictEqual(getCharsetName('UTF8'), 'utf8');
        });

        it('does not resolve the default alias of the charsets table as a charset', () => {
            const charset = require(subpath('charset'));
            assert.strictEqual(charset.normalizeCharset('default'), 'DEFAULT');
            assert.strictEqual(require(packageName).normalizeCharset('default'), 'DEFAULT');
        });

        it('loads in a CommonJS application without a loader', async () => {
            const output = await runInConsumer({
                files: {
                    'app.js': `
                const libmime = require('libmime');
                const { Libmime } = require('libmime');
                const charset = require('libmime/lib/charset');
                const mimetypes = require('libmime/lib/mimetypes.js');
                console.log(JSON.stringify([
                    libmime.decodeWords('=?UTF-8?B?w7U=?='),
                    new Libmime().encodeWords('õ'),
                    charset.normalizeCharset('win-1257'),
                    mimetypes.list['application/json'],
                    require.resolve('libmime').split(require('path').sep).slice(-3).join('/')
                ]));
                `
                }
            });
            assert.deepStrictEqual(JSON.parse(output), ['õ', '=?UTF-8?Q?=C3=B5?=', 'windows-1257', 'json', 'dist/cjs/libmime.js']);
        });
    });

    describe('ES module build', () => {
        it('resolves import to the ES module entry point', async () => {
            const url = new URL('../../dist/esm/libmime.js', import.meta.url).href;
            const direct = await import(url);
            const byName = await import(packageName);
            assert.strictEqual(byName.default, direct.default);
            assert.strictEqual(byName.Libmime, direct.Libmime);
        });

        it('exposes the shared instance as the default export and the class as a named one', async () => {
            const { default: libmime, Libmime } = await import(packageName);
            assert.ok(libmime instanceof Libmime);
            assert.strictEqual(libmime.Libmime, Libmime);
            for (const method of METHODS) {
                assert.strictEqual(typeof libmime[method], 'function', method);
            }
            assert.strictEqual(libmime.decodeWords('=?UTF-8?Q?=C3=B5?='), 'õ');
        });

        it('exposes deep imports as default and named exports', async () => {
            const charset = await import(subpath('charset'));
            assert.strictEqual(typeof charset.decode, 'function');
            assert.strictEqual(charset.default.decode, charset.decode);
            const { default: charsets } = await import(subpath('charsets'));
            assert.strictEqual(charsets.utf8, 'UTF-8');
            const mimetypes = await import(subpath('mimetypes.js'));
            assert.strictEqual(mimetypes.default.list, mimetypes.list);
            const { getCharsetName } = await import(subpath('get-charset-name'));
            assert.strictEqual(getCharsetName('UTF8'), 'utf8');
        });

        it('loads in an ES module application without a loader', async () => {
            const output = await runInConsumer({
                files: {
                    'app.mjs': `
                import libmime, { Libmime } from 'libmime';
                import charset, { normalizeCharset } from 'libmime/lib/charset';
                console.log(JSON.stringify([libmime.decodeWords('=?UTF-8?B?w7U=?='), new Libmime().encodeWords('õ'), charset.normalizeCharset('latin1'), normalizeCharset('utf8')]));
                `
                }
            });
            assert.deepStrictEqual(JSON.parse(output), ['õ', '=?UTF-8?Q?=C3=B5?=', 'windows-1252', 'UTF-8']);
        });
    });
});
