import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import libmime from '../src/libmime.js';
import * as charset from '../src/charset.js';
import { FUZZ_SEED, Rng, forEachCase, hostile, mutate, paramName, show, wellFormed } from './fixtures/fuzz.js';
import { expectLinear } from './fixtures/timing.js';

// Fuzzing with hostile input: strings assembled from fragments of MIME syntax, random text,
// control chars and unpaired surrogates, and random edits of those. The parsers read headers
// of untrusted messages, so for any such input they must not throw, must not touch any
// prototype, and must return the documented shapes. The builders must never emit anything a
// header line can not carry, whatever they are given. A failure names its seed and case,
// reproduce it with FUZZ_SEED=<seed> FUZZ_ITERATIONS=<n>.

const CHARSET_NAMES = [
    'utf-8',
    'UTF8',
    'latin1',
    'iso-8859-2',
    'windows-1257',
    'koi8-r',
    'shift_jis',
    'euc-jp',
    'iso-2022-jp',
    'jis',
    'gb2312',
    'big5',
    'ks_c_5601-1987',
    'utf-16',
    'utf-16be',
    'utf-7',
    'unicode-1-1-utf-7',
    'utf-7-imap',
    'base64',
    'hex',
    'binary',
    'ucs2',
    'x-unknown',
    '',
    '__proto__',
    'constructor',
    'iso-8859-99',
    'utf-32'
];

const HEADER_KEYS = ['Subject', 'X-A', 'Content-Type', '__proto__', 'constructor', 'toString', 'hasOwnProperty', ' ', ''];

function forEachInput(offset: number, fn: (input: string, rng: Rng, context: string) => void): void {
    forEachCase(offset, (rng, context) => {
        let input = rng.chance(0.3) ? mutate(rng, hostile(rng, 16)) : hostile(rng, 16);
        fn(input, rng, `${context} ${show(input)}`);
    });
}

function assertPrototypesIntact(): void {
    assert.deepStrictEqual(Object.keys(Object.prototype), []);
    assert.strictEqual(({} as Record<string, unknown>).polluted, undefined);
}

describe('Fuzzing', () => {
    describe('parsers', () => {
        it('decodeWords returns a string and leaves text without encoded words as it is', () => {
            forEachInput(101, (input, _rng, context) => {
                let decoded = libmime.decodeWords(input);
                assert.strictEqual(typeof decoded, 'string', context);
                if (!input.includes('=?')) {
                    assert.strictEqual(decoded, input, context);
                }
            });
        });

        it('decodeWords never decodes with a refused codec', () => {
            forEachInput(102, (input, rng, context) => {
                let name = rng.pick(['utf-7', 'UTF7', 'unicode-1-1-utf-7', 'utf-7-imap', 'base64', 'hex', 'utf-7*en']);
                let payload = input.replace(/[?\s]/g, '');
                // decoded as UTF-8, the same as for a charset nobody knows
                assert.strictEqual(libmime.decodeWords(`=?${name}?B?${payload}?=`), libmime.decodeWords(`=?x-unknown?B?${payload}?=`), context);
                assert.strictEqual(libmime.decodeWords(`=?${name}?Q?${payload}?=`), libmime.decodeWords(`=?x-unknown?Q?${payload}?=`), context);
            });
        });

        it('parseHeaderValue returns plain params and never touches a prototype', () => {
            forEachInput(103, (input, _rng, context) => {
                let parsed = libmime.parseHeaderValue(input);
                assert.strictEqual(typeof parsed.value, 'string', context);
                assert.strictEqual(Object.getPrototypeOf(parsed), Object.prototype, context);
                assert.strictEqual(Object.getPrototypeOf(parsed.params), Object.prototype, context);
                // decodedParams is not enumerable, the serialized shape stays {value, params}
                assert.deepStrictEqual(Object.keys(parsed), ['value', 'params'], context);
                for (let [key, value] of Object.entries(parsed.params)) {
                    assert.strictEqual(typeof value, 'string', context);
                    assert.strictEqual(key, key.toLowerCase(), context);
                }
                for (let key of parsed.decodedParams) {
                    assert.ok(Object.hasOwn(parsed.params, key), context);
                }
                assertPrototypesIntact();
            });
        });

        it('decodeHeaders returns lowercased keys with arrays of unfolded values', () => {
            forEachInput(104, (input, rng, context) => {
                let lines: string[] = [];
                for (let i = rng.int(1, 6); i > 0; i--) {
                    lines.push((rng.chance(0.8) ? rng.pick(HEADER_KEYS) + ':' : '') + mutate(rng, input).slice(0, 60));
                }
                let block = lines.join(rng.pick(['\r\n', '\n', '\r']));
                let headers = libmime.decodeHeaders(block);
                let at = context + ' ' + show(block);
                assert.strictEqual(Object.getPrototypeOf(headers), Object.prototype, at);
                for (let [key, values] of Object.entries(headers)) {
                    assert.strictEqual(key, key.trim().toLowerCase(), at);
                    assert.ok(Array.isArray(values) && values.length > 0, at);
                    for (let value of values) {
                        assert.strictEqual(typeof value, 'string', at);
                        assert.ok(!/[\r\n]/.test(value), at);
                    }
                }
                assertPrototypesIntact();
            });
        });

        it('decodeHeader splits any line into a key and a value', () => {
            forEachInput(105, (input, _rng, context) => {
                let header = libmime.decodeHeader(input);
                assert.strictEqual(typeof header.key, 'string', context);
                assert.strictEqual(typeof header.value, 'string', context);
                assert.ok(!header.key.includes(':'), context);
            });
        });

        it('decodeFlowed, the detect functions and the charset functions accept anything', () => {
            forEachInput(106, (input, rng, context) => {
                assert.strictEqual(typeof libmime.decodeFlowed(input), 'string', context);
                assert.strictEqual(typeof libmime.decodeFlowed(input, true), 'string', context);
                assert.match(libmime.detectMimeType(input), /^[^/\s]+\/[^/\s]+$/, context);
                assert.match(libmime.detectExtension(input), /^[^.\s/]+$/, context);

                let name = rng.chance(0.8) ? rng.pick(CHARSET_NAMES) : input;
                let bytes = rng.bytes(rng.int(0, 40));
                assert.strictEqual(typeof charset.normalizeCharset(name), 'string', context);
                assert.strictEqual(typeof charset.decode(bytes, name), 'string', context);
                assert.ok(Buffer.isBuffer(charset.convert(bytes, name)), context);
                assert.strictEqual(typeof libmime.decodeWord(name, rng.pick(['Q', 'B', 'q', 'b', 'X']), input.replace(/\?/g, '')), 'string', context);
            });
        });
    });

    describe('builders', () => {
        it('buildHeaderValue emits printable ASCII that parses back into the same params', () => {
            forEachInput(107, (input, rng, context) => {
                let key = paramName(rng, 9);
                let built = libmime.buildHeaderValue({ value: 'text/plain', params: { [key]: input, other: 'x' } });
                let at = context + ' ' + show(built);
                assert.ok(!/[\x00-\x1f\x7f-￿]/.test(built), at);
                let parsed = libmime.parseHeaderValue(built);
                // no parameter can be smuggled in or out
                assert.deepStrictEqual(Object.keys(parsed.params).sort(), [key, 'other'].sort(), at);
                assert.strictEqual(parsed.params[key], wellFormed(input), at);
                assert.strictEqual(parsed.params.other, 'x', at);
            });
        });

        it('buildHeaderValue drops control chars from the value and the parameter names', () => {
            forEachInput(108, (input, _rng, context) => {
                let built = libmime.buildHeaderValue({
                    value: 'text/plain' + input.slice(0, 10),
                    params: { ['a' + input.slice(0, 5).replace(/[^\x00-\x1f\x7f]/g, '')]: 'x' }
                });
                assert.ok(!/[\x00-\x1f\x7f]/.test(built), context + ' ' + show(built));
            });
        });

        it('encodeWord and encodeWords emit printable ASCII that decodes back', () => {
            forEachInput(109, (input, rng, context) => {
                for (let encoding of ['Q', 'B']) {
                    let encoded = libmime.encodeWord(input, encoding, rng.pick([0, 20, 75]));
                    let at = context + ' ' + show(encoded);
                    assert.ok(!/[^!-~ ]/.test(encoded), at);
                    assert.strictEqual(libmime.decodeWords(encoded), wellFormed(input), at);
                }
                assert.ok(!/[^\x00-\x7f]/.test(libmime.encodeWords(input)), context);
            });
        });

        it('safeEncodeURIComponent leaves only unreserved chars and escapes', () => {
            forEachInput(110, (input, _rng, context) => {
                let encoded = libmime.safeEncodeURIComponent(input);
                assert.match(encoded, /^(?:[A-Za-z0-9!._~-]|%[0-9A-F]{2})*$/, context);
                assert.strictEqual(decodeURIComponent(encoded), wellFormed(input), context);
            });
        });

        it('foldLines and splitMimeEncodedString only cut, never change the input', () => {
            forEachInput(111, (input, rng, context) => {
                let folded = libmime.foldLines(input, rng.int(1, 80), rng.chance(0.5));
                assert.strictEqual(folded.replace(/\r\n/g, ''), input.replace(/\r\n/g, ''), context);
                let chunks = libmime.splitMimeEncodedString(input, rng.int(1, 30));
                assert.strictEqual(chunks.join(''), input, context);
                assert.ok(
                    chunks.every(chunk => chunk.length > 0),
                    context
                );
            });
        });
    });

    describe('linear time on large hostile input', () => {
        // One hostile chunk repeated: whatever it holds, doubling the input must not quadruple the
        // time. Each entry is [name, function, chunk repeats]
        let rng = new Rng(FUZZ_SEED + 112);
        let chunk = Array.from({ length: 20 }, () => hostile(rng, 12)).join(' ');
        let cases: [string, (input: string) => unknown, number][] = [
            ['decodeWords', input => libmime.decodeWords(input), 400],
            ['parseHeaderValue', input => libmime.parseHeaderValue(input), 400],
            ['decodeHeaders', input => libmime.decodeHeaders(input), 400],
            ['decodeFlowed', input => libmime.decodeFlowed(input, true), 400],
            ['encodeWords', input => libmime.encodeWords(input), 200],
            ['encodeWord', input => libmime.encodeWord(input, 'Q', 52), 200],
            ['buildHeaderParam', input => libmime.buildHeaderParam('f', input, 50), 50],
            ['foldLines', input => libmime.foldLines(input, 76), 200],
            ['encodeFlowed', input => libmime.encodeFlowed(input, 76), 200],
            ['splitMimeEncodedString', input => libmime.splitMimeEncodedString(input, 40), 200]
        ];
        for (let [name, fn, repeats] of cases) {
            it(name, { timeout: 30000 }, () => {
                expectLinear(n => chunk.repeat(n), fn, repeats);
            });
        }
    });
});
