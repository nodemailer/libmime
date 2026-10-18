import { describe, it } from 'node:test';
import path from 'node:path';
import { createRequire } from 'node:module';
import { hasDist, runInConsumer } from './helpers.js';

// The suite runs through tsx, which strips the types instead of checking them, and
// `npm run typecheck` checks the types in src/. These tests type-check a consumer against
// the built declarations in dist/ the way an installed copy is resolved: the package is
// linked into a temporary project so that the specifiers go through the package.json
// exports map.
const require = createRequire(import.meta.url);
const tsc = require.resolve('typescript/bin/tsc');

// An ES module consumer: the shared instance as the default export, the class and the
// types as named exports, the type names of @types/libmime as members of the instance,
// and the deep imports
const esmConsumer = `
import { Buffer } from 'node:buffer';
import libmime, { Libmime } from 'libmime';
import type { ParsedHeaderValue, StructuredHeader, StructuredHeaderValue, MimeWordEncoding, HeaderParam, HeaderLine, HeaderObject } from 'libmime';
import charset, { decode, normalizeCharset } from 'libmime/lib/charset';
import mimetypes, { extensions } from 'libmime/lib/mimetypes.js';
import charsets from 'libmime/lib/charsets';
import { getCharsetName } from 'libmime/lib/get-charset-name';

const parsed: ParsedHeaderValue = libmime.parseHeaderValue('text/plain; charset=utf-8');
const structured: libmime.StructuredHeader = parsed;
const structuredToo: StructuredHeader = structured;
const decodedParams: string[] = parsed.decodedParams;
const encoding: MimeWordEncoding = 'Q';
const word: string = libmime.encodeWord('õ', encoding, 20) + libmime.encodeWords(Buffer.from('õ'), 'B', 30, 'utf-8');
const custom: libmime.Libmime = new Libmime({ key: 'value' });
const viaInstance: Libmime = new libmime.Libmime();
const params: HeaderParam[] = custom.buildHeaderParam('filename', 'õ.txt', 20);
const line: HeaderLine = viaInstance.decodeHeader('Subject: test');
const headers: HeaderObject = libmime.decodeHeaders('Subject: test');
const value: StructuredHeaderValue = { value: 'attachment', params: { filename: 'a.txt', size: 12 } };
const header: string = libmime.buildHeaderValue(value) + libmime.buildHeaderValue(structuredToo) + libmime.buildHeaderValue({ value: 'a', params: undefined });
const text: string = charset.decode(Buffer.from('x'), 'latin1') + decode(Buffer.from('x')) + normalizeCharset('utf8') + charsets['utf8'];
const ext: string | string[] | undefined = mimetypes.list['text/plain'] || extensions['txt'];
const name: string | false = getCharsetName('UTF8');
const plain: boolean = libmime.isPlainText('a', true);

export { parsed, word, params, line, headers, header, text, ext, name, plain };
`;

// A TypeScript CommonJS consumer written against @types/libmime: the module is the instance
// itself, in every import form
const cjsConsumer = `
import libmime = require('libmime');
import * as star from 'libmime';
import defaultImport from 'libmime';
import { Libmime } from 'libmime';
import charset = require('libmime/lib/charset');

const structured: libmime.StructuredHeader = libmime.parseHeaderValue('text/plain; charset=utf-8');
const parsed: libmime.ParsedHeaderValue = star.parseHeaderValue('a');
const encoding: libmime.MimeWordEncoding = 'B';
const custom: libmime.Libmime = new Libmime();
const viaModule = new libmime.Libmime({ key: 'value' });
const decoded: string = star.decodeWords('x') + defaultImport.decodeWords('x') + custom.encodeWord('õ', encoding) + viaModule.foldLines('a');
const name: string = charset.normalizeCharset('latin1') + charset.decode(Buffer.from('x'));

export { structured, parsed, decoded, name };
`;

// A CommonJS JavaScript consumer checked with checkJs, the way @zone-eu/mailsplit uses the
// @types/libmime names
const jsConsumer = `
const libmime = require('libmime');
const charset = require('libmime/lib/charset');

/** @typedef {import('libmime').StructuredHeader} StructuredHeader */

/** @type {StructuredHeader} */
const structured = libmime.parseHeaderValue('text/plain; charset=utf-8');
const Libmime = libmime.Libmime;
const custom = new Libmime({ key: 'value' });

/** @type {string} */
const text = custom.detectMimeType('a.txt') + libmime.buildHeaderValue(structured) + charset.normalizeCharset('utf8');

module.exports = { text };
`;

const node16 = { module: 'node16', moduleResolution: 'node16' };

// Type-checks one consumer source against the built declarations in dist/ the way an
// installed copy is resolved, through the package.json exports map
const typeCheckConsumer = async (source: string, file: string, compilerOptions: { [key: string]: unknown }, type?: string): Promise<void> => {
    const tsconfig = {
        compilerOptions: {
            target: 'ES2022',
            lib: ['ES2023'],
            types: ['node'],
            strict: true,
            exactOptionalPropertyTypes: true,
            noEmit: true,
            skipLibCheck: false,
            esModuleInterop: true,
            ...compilerOptions
        },
        include: [file]
    };
    await runInConsumer({
        files: { [file]: source, 'tsconfig.json': JSON.stringify(tsconfig) },
        type,
        args: dir => [tsc, '-p', path.join(dir, 'tsconfig.json')]
    });
};

describe('Built package types', { timeout: 120 * 1000, concurrency: true, skip: hasDist ? false : 'dist/ is not built, run npm run build first' }, () => {
    it('type-checks an ES module consumer with node16 resolution', async () => {
        await typeCheckConsumer(esmConsumer, 'consumer.ts', node16, 'module');
    });

    it('type-checks an ES module consumer with bundler resolution', async () => {
        await typeCheckConsumer(esmConsumer, 'consumer.ts', { module: 'esnext', moduleResolution: 'bundler' }, 'module');
    });

    it('type-checks a CommonJS consumer written against @types/libmime', async () => {
        // no "type": "module" in the consumer package, so the file is a CommonJS module
        await typeCheckConsumer(cjsConsumer, 'consumer.ts', node16);
    });

    it('type-checks a CommonJS consumer with the legacy node10 resolution', async () => {
        // node10 ignores the exports map, the types and typesVersions fields resolve the declarations
        await typeCheckConsumer(cjsConsumer, 'consumer.ts', { module: 'commonjs', moduleResolution: 'node10', ignoreDeprecations: '6.0' });
    });

    it('type-checks a JavaScript consumer with checkJs', async () => {
        await typeCheckConsumer(jsConsumer, 'consumer.js', { ...node16, allowJs: true, checkJs: true });
    });
});
