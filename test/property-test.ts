import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createRequire } from 'node:module';
import iconv from 'iconv-lite';
import encodingJapanese from 'encoding-japanese';
import libmime from '../src/libmime.js';
import * as charset from '../src/charset.js';
import { randomSplit, runStream } from './fixtures/stream.js';
import { forEachCase, loneSurrogate, paramName, show, text, wellFormed, words, type Rng } from './fixtures/fuzz.js';

// Property based tests: every case is generated from the seed, and the assertions are the
// invariants that hold for any input of the generated kind (decoding what was encoded gives
// the input back, a built header parses back to what it was built from, ...). A failure names
// its seed and case, reproduce it with FUZZ_SEED=<seed> FUZZ_ITERATIONS=<n>.

// nodemailer carries its own copy of the encoders, fixed independently of this one, and is
// used as a differential oracle: where both claim to implement the same thing, they must agree
const require = createRequire(import.meta.url);
const mimeFuncs = require('nodemailer/lib/mime-funcs');

// One encoded word, or several separated by single spaces
const ENCODED_WORDS = /^=\?UTF-8\?[QB]\?[!-~]*?\?=( =\?UTF-8\?[QB]\?[!-~]*?\?=)*$/;

// Order of the params is not part of the contract, rfc2231 parameters are assembled after the plain ones
const sorted = (params: Record<string, string>) => Object.fromEntries(Object.entries(params).sort(([a], [b]) => (a < b ? -1 : 1)));

// The payload of a Q encoded word of random text
const qPayload = (rng: Rng) => libmime.encodeWord(text(rng, 60), 'Q').slice('=?UTF-8?Q?'.length, -2);

describe('Properties', () => {
    describe('encoded words', () => {
        it('decodes what encodeWord encoded, as one or several well formed words', () => {
            forEachCase(1, (rng, context) => {
                let input = text(rng, 80);
                for (let encoding of ['Q', 'B']) {
                    let maxLength = rng.pick([0, 13, 20, 30, 52, 75]);
                    let encoded = libmime.encodeWord(input, encoding, maxLength);
                    let at = `${context} ${show([input, encoding, maxLength, encoded])}`;
                    assert.match(encoded, ENCODED_WORDS, at);
                    assert.strictEqual(libmime.decodeWords(encoded), input, at);
                    assert.strictEqual(libmime.encodeWord(Buffer.from(input), encoding, maxLength), encoded, at);
                    if (maxLength && input) {
                        // a word holds whole characters, so the smallest limits can not be met
                        for (let word of encoded.split(' ')) {
                            assert.ok(word.length <= Math.max(maxLength, 24), at);
                            let decoded = libmime.decodeWords(word);
                            assert.ok(decoded.length > 0, at);
                            assert.ok(!decoded.includes('\ufffd'), at);
                        }
                    }
                }
            });
        });

        it('replaces an unpaired surrogate and keeps everything around it', () => {
            forEachCase(2, (rng, context) => {
                let input = text(rng, 10) + loneSurrogate(rng) + text(rng, 10);
                for (let encoding of ['Q', 'B']) {
                    let encoded = libmime.encodeWord(input, encoding, rng.pick([0, 20, 40]));
                    assert.strictEqual(libmime.decodeWords(encoded), wellFormed(input), `${context} ${show([input, encoded])}`);
                }
            });
        });

        it('decodes what encodeWords encoded and leaves ASCII as it is', () => {
            forEachCase(3, (rng, context) => {
                // text that looks like an encoded word is not encoded by encodeWords, see the README
                let input = words(rng, 10).replace(/[=]\?/g, '=');
                let encoded = libmime.encodeWords(input, rng.pick(['Q', 'B']), rng.pick([0, 40]));
                let at = `${context} ${show([input, encoded])}`;
                assert.strictEqual(libmime.decodeWords(encoded), input, at);
                assert.ok(!/[^\x00-\x7f]/.test(encoded), at);
                if (!/[^\x00-\x7f]/.test(input)) {
                    assert.strictEqual(encoded, input, at);
                }
            });
        });

        it('decodes words in other charsets the way the charset decoder does', () => {
            let charsets = ['iso-8859-1', 'iso-8859-2', 'windows-1251', 'koi8-r', 'shift_jis', 'euc-kr', 'gbk', 'big5'];
            forEachCase(4, (rng, context) => {
                let name = rng.pick(charsets);
                let bytes = iconv.encode(text(rng, 20, ['ascii', 'latin', 'cyrillic', 'cjk']), name);
                let q = Array.from(bytes, byte => '=' + byte.toString(16).toUpperCase().padStart(2, '0')).join('');
                let expected = charset.decode(bytes, name);
                let at = `${context} ${show([name, bytes.toString('hex')])}`;
                assert.strictEqual(libmime.decodeWords(`=?${name}?Q?${q}?=`), expected, at);
                assert.strictEqual(libmime.decodeWords(`=?${name}?B?${bytes.toString('base64')}?=`), expected, at);
                // an RFC 2231 language tag is ignored
                assert.strictEqual(libmime.decodeWords(`=?${name}*en?B?${bytes.toString('base64')}?=`), expected, at);
            });
        });
    });

    describe('header values', () => {
        it('parses back the params buildHeaderValue built, whatever they hold', () => {
            forEachCase(5, (rng, context) => {
                let params: Record<string, string> = {};
                for (let i = rng.int(1, 4); i > 0; i--) {
                    params[paramName(rng, 11)] = text(rng, 120, ['ascii', 'specials', 'latin', 'cjk', 'astral', 'controls', 'breaks']);
                }
                let value = rng.pick(['attachment', 'inline', 'text/plain', 'multipart/mixed']);
                let built = libmime.buildHeaderValue({ value, params });
                let at = `${context} ${show([params, built])}`;
                // nothing that a header line can not carry raw
                assert.ok(!/[\x00-\x1f\x7f-￿]/.test(built), at);
                let parsed = libmime.parseHeaderValue(built);
                assert.strictEqual(parsed.value, value, at);
                assert.deepStrictEqual(sorted(parsed.params), sorted(params), at);
            });
        });

        it('splits a parameter into continuations that join back into the value', () => {
            forEachCase(6, (rng, context) => {
                let value = text(rng, 150, ['ascii', 'latin', 'cjk', 'astral', 'controls']);
                let maxLength = rng.int(10, 80);
                let list = libmime.buildHeaderParam('title', value, maxLength);
                let at = `${context} ${show([value, maxLength, list])}`;
                list.forEach((item, i) => {
                    if (list.length > 1) {
                        assert.match(item.key, new RegExp('^title\\*' + i + '\\*?$'), at);
                    }
                    // an unstarred continuation is literal text, it must not hold escapes
                    if (!item.key.endsWith('*')) {
                        assert.ok(!item.value.includes('%') || libmime.isPlainText(value, true), at);
                    }
                });
                let header = 'x; ' + list.map(item => item.key + '=' + (item.key.endsWith('*') ? item.value : JSON.stringify(item.value))).join('; ');
                assert.strictEqual(libmime.parseHeaderValue(header).params.title, value, at);
            });
        });
    });

    describe('format=flowed', () => {
        it('decodes what encodeFlowed encoded, minus the trailing spaces and the last line break', () => {
            forEachCase(7, (rng, context) => {
                let lines: string[] = [];
                for (let i = rng.int(1, 5); i > 0; i--) {
                    let prefix = rng.chance(0.25) ? rng.pick(['>', '> ', 'From ', ' ', '  ']) : '';
                    lines.push(rng.chance(0.15) ? '' : prefix + words(rng, 25, ['ascii', 'latin', 'cjk']) + (rng.chance(0.2) ? '  ' : ''));
                }
                let input = lines.join(rng.pick(['\n', '\r\n']));
                let lineLength = rng.int(20, 78);
                let encoded = libmime.encodeFlowed(input, lineLength);
                let at = `${context} ${show([input, lineLength, encoded])}`;
                assert.strictEqual(libmime.decodeFlowed(encoded), input.replace(/\r\n/g, '\n').replace(/ +$/gm, '').replace(/\n$/, ''), at);
                for (let line of encoded.split('\r\n')) {
                    // a line that starts like a quote or an mbox separator is always stuffed
                    assert.ok(!/^(>|From )/.test(line), at);
                    // only a single word that does not fit can make a line longer than the limit
                    assert.ok(line.length <= lineLength + 1 || !/\S\s+\S/.test(line.trim()), at);
                }
            });
        });
    });

    describe('folding', () => {
        it('only inserts line breaks into whitespace', () => {
            forEachCase(8, (rng, context) => {
                let input = words(rng, 40, ['ascii', 'latin', 'specials']);
                let lineLength = rng.int(5, 80);
                for (let afterSpace of [false, true]) {
                    let folded = libmime.foldLines(input, lineLength, afterSpace);
                    let at = `${context} ${show([input, lineLength, afterSpace, folded])}`;
                    assert.strictEqual(folded.replace(/\r\n/g, ''), input, at);
                    for (let line of folded.split('\r\n')) {
                        assert.ok(line.length <= lineLength || !/\S\s+\S/.test(line.trim()), at);
                        if (!afterSpace) {
                            assert.ok(!line.endsWith(' ') || line.trim() === '', at);
                        }
                    }
                }
            });
        });
    });

    describe('splitMimeEncodedString', () => {
        it('splits a Q payload into chunks of whole escapes and whole characters', () => {
            forEachCase(9, (rng, context) => {
                let payload = qPayload(rng);
                let maxlen = rng.int(12, 50);
                let chunks = libmime.splitMimeEncodedString(payload, maxlen);
                let at = `${context} ${show([payload, maxlen, chunks])}`;
                assert.strictEqual(chunks.join(''), payload, at);
                for (let chunk of chunks) {
                    assert.ok(chunk.length > 0 && chunk.length <= maxlen, at);
                    assert.ok(!/[=][0-9A-F]?$/i.test(chunk), at);
                    assert.ok(!libmime.decodeWords('=?UTF-8?Q?' + chunk + '?=').includes('\ufffd'), at);
                }
            });
        });
    });

    describe('charsets', () => {
        it('decodes valid multibyte text the way it was encoded', () => {
            let alphabets: Record<string, string> = {
                shift_jis: 'あいうえおカタカナ日本語漢字テスト',
                'euc-jp': 'あいうえおカタカナ日本語漢字',
                'euc-kr': '한국어테스트문자',
                gbk: '中文字符测试简体',
                gb18030: '中文字符测试简体😀',
                big5: '中文字符測試繁體',
                'utf-16le': 'abcõ中😀',
                'utf-16be': 'abcõ中😀',
                'iso-8859-5': 'абвгдежзийклмноп',
                'koi8-r': 'абвгдежзийклмноп'
            };
            forEachCase(10, (rng, context) => {
                let name = rng.pick(Object.keys(alphabets));
                let input = rng.string(alphabets[name] + 'abc 123', rng.int(0, 30));
                let bytes = iconv.encode(input, name);
                let at = `${context} ${show([name, input])}`;
                assert.strictEqual(charset.decode(bytes, name), input, at);
                assert.deepStrictEqual(charset.convert(bytes, name), Buffer.from(input), at);
            });
        });

        it('decodes ISO-2022-JP the way encoding-japanese encoded it', () => {
            forEachCase(11, (rng, context) => {
                let input = rng.string('あいうえおカタカナ日本語漢字テスト abc', rng.int(0, 30));
                let jis = Buffer.from(encodingJapanese.convert(encodingJapanese.stringToCode(input), { to: 'JIS', from: 'UNICODE' }));
                assert.strictEqual(charset.decode(jis, 'iso-2022-jp'), input, `${context} ${show(input)}`);
            });
        });

        it('decodes UTF-8 bytes the way TextDecoder does', () => {
            let decoder = new TextDecoder('utf-8');
            forEachCase(12, (rng, context) => {
                let bytes = rng.bytes(rng.int(0, 40));
                assert.strictEqual(charset.decode(bytes, 'utf-8'), decoder.decode(bytes), `${context} ${bytes.toString('hex')}`);
            });
        });

        // Older ICU builds (Node 20 and 22) ship single byte tables that differ from the WHATWG
        // indexes in places, so TextDecoder is only used as the oracle where it matches them
        const whatwgTables =
            new TextDecoder('iso-8859-1').decode(Buffer.from([0x80])) === '\u20ac' &&
            new TextDecoder('ibm866').decode(Buffer.from([0x1a])) === '\x1a' &&
            new TextDecoder('windows-1253').decode(Buffer.from([0xaa])) === '\ufffd';

        it('maps every byte of the single byte charsets the way TextDecoder does', { skip: !whatwgTables && 'TextDecoder tables differ from WHATWG' }, () => {
            // TextDecoder follows the WHATWG encoding standard, as browsers and webmail do. Where a
            // charset leaves a byte undefined, iconv-lite gives U+FFFD and WHATWG a C1 control
            let names = [
                'iso-8859-1',
                'iso-8859-2',
                'iso-8859-4',
                'iso-8859-5',
                'iso-8859-7',
                'iso-8859-9',
                'iso-8859-13',
                'iso-8859-15',
                'windows-1250',
                'windows-1251',
                'windows-1252',
                'windows-1253',
                'windows-1257',
                'koi8-r',
                'ibm866',
                'windows-874'
            ];
            for (let name of names) {
                let decoder = new TextDecoder(name);
                for (let byte = 0; byte < 256; byte++) {
                    let buf = Buffer.from([byte]);
                    let ours = charset.decode(buf, name);
                    let whatwg = decoder.decode(buf);
                    if (ours !== whatwg) {
                        assert.ok(ours === '\ufffd' && /^[\x80-\x9f]$/.test(whatwg), `${name} byte ${byte.toString(16)}: ${show([ours, whatwg])}`);
                    }
                }
            }
        });
    });

    describe('decode streams', () => {
        // Charsets with the text each one can represent. The streams must decode however the input
        // is cut into chunks, a multibyte character split in two included
        const unicode = ['ascii', 'latin', 'cyrillic', 'cjk', 'astral', 'combining'] as const;
        const streamCharsets: Record<string, (rng: Rng) => Buffer> = {
            'utf-8': rng => Buffer.from(text(rng, 40, [...unicode])),
            'utf-16': rng => Buffer.concat([Buffer.from(rng.pick([[], [0xff, 0xfe]])), iconv.encode(text(rng, 40, [...unicode]), 'utf-16le')]),
            'utf-32': rng => iconv.encode(text(rng, 40, [...unicode]), rng.pick(['utf-32le', 'utf-32be']), { addBOM: rng.chance(0.5) }),
            'utf-16be': rng => iconv.encode(text(rng, 40, [...unicode]), 'utf-16be'),
            'utf-16le': rng => iconv.encode(text(rng, 40, [...unicode]), 'utf-16le'),
            gb18030: rng => iconv.encode(text(rng, 40, [...unicode]), 'gb18030'),
            'big5-hkscs': rng => iconv.encode(rng.string('\u4e2d\u6587\u5b57\u00ca\u0304\u00ea\u030c\u{20000}abc', rng.int(0, 30)), 'big5hkscs'),
            shift_jis: rng => iconv.encode(rng.string('\u3042\u3044\u30ab\u65e5\u672c abc', rng.int(0, 30)), 'shift_jis'),
            'euc-jp': rng => iconv.encode(rng.string('\u3042\u3044\u30ab\u65e5\u672c abc', rng.int(0, 30)), 'euc-jp'),
            'euc-kr': rng => iconv.encode(rng.string('\ud55c\uad6d\uc5b4 abc', rng.int(0, 30)), 'euc-kr'),
            gbk: rng => iconv.encode(rng.string('\u4e2d\u6587\u5b57\u7b26 abc', rng.int(0, 30)), 'gbk'),
            'windows-1251': rng => iconv.encode(text(rng, 40, ['ascii', 'cyrillic']), 'windows-1251'),
            'iso-2022-jp': rng =>
                Buffer.from(
                    encodingJapanese.convert(encodingJapanese.stringToCode(rng.string('\u3042\u3044\u30ab\u65e5\u672c abc', rng.int(0, 30))), {
                        to: 'JIS',
                        from: 'UNICODE'
                    })
                ),
            'utf-7': rng => Buffer.from(text(rng, 40, ['ascii', 'specials'])),
            'x-unknown': rng => Buffer.from(text(rng, 40, [...unicode]))
        };

        it('outputs what decode() gives for the whole input, however it is chunked', async () => {
            let cases: { name: string; bytes: Buffer; chunks: Buffer[]; context: string }[] = [];
            forEachCase(15, (rng, context) => {
                let name = rng.pick(Object.keys(streamCharsets));
                // valid text in the charset, or random bytes that are mostly not
                let bytes = rng.chance(0.7) ? streamCharsets[name](rng) : rng.bytes(rng.int(0, 40));
                cases.push({ name, bytes, chunks: randomSplit(rng, bytes), context });
            });
            let outputs = await Promise.all(cases.map(({ name, chunks }) => runStream(charset.createDecodeStream(name), chunks)));
            cases.forEach(({ name, bytes, chunks, context }, i) => {
                assert.deepStrictEqual(
                    outputs[i],
                    Buffer.from(charset.decode(bytes, name)),
                    `${context} ${show([name, bytes.toString('hex'), chunks.map(c => c.length)])}`
                );
            });
        });
    });

    describe('differential against nodemailer', () => {
        it('encodes words the same way', () => {
            forEachCase(13, (rng, context) => {
                let input = text(rng, 80);
                for (let encoding of ['Q', 'B']) {
                    let maxLength = rng.pick([0, 13, 20, 40, 52, 75]);
                    // Known, harmless differences: libqp escapes a leading "-" or "." (the start of a
                    // QP line), and nodemailer starts with an empty word when the first char is an
                    // astral one and the limit is too small to hold it
                    if ((encoding === 'Q' && /^[-.]/.test(input)) || (encoding === 'B' && /^[\ud800-\udbff]/.test(input))) {
                        continue;
                    }
                    assert.strictEqual(
                        libmime.encodeWord(input, encoding, maxLength),
                        mimeFuncs.encodeWord(input, encoding, maxLength),
                        `${context} ${show([input, encoding, maxLength])}`
                    );
                }
            });
        });

        it('folds, splits and builds parameters the same way', () => {
            forEachCase(14, (rng, context) => {
                let input = words(rng, 30, ['ascii', 'latin', 'specials']);
                let lineLength = rng.int(10, 80);
                let afterSpace = rng.chance(0.5);
                assert.strictEqual(
                    libmime.foldLines(input, lineLength, afterSpace),
                    mimeFuncs.foldLines(input, lineLength, afterSpace),
                    `${context} ${show([input, lineLength])}`
                );

                let payload = qPayload(rng);
                let maxlen = rng.int(12, 40);
                assert.deepStrictEqual(
                    libmime.splitMimeEncodedString(payload, maxlen),
                    mimeFuncs.splitMimeEncodedString(payload, maxlen),
                    `${context} ${show([payload, maxlen])}`
                );

                // nodemailer encodes a quote instead of quoting it, and libmime encodes text that looks like an encoded word
                let value = text(rng, 120, ['ascii', 'latin', 'cjk', 'astral', 'controls']).replace(/"|=\?/g, '');
                let maxLength = rng.pick([20, 50]);
                assert.deepStrictEqual(
                    libmime.buildHeaderParam('f', value, maxLength),
                    mimeFuncs.buildHeaderParam('f', value, maxLength),
                    `${context} ${show([value, maxLength])}`
                );
                assert.strictEqual(libmime.isPlainText(value), mimeFuncs.isPlainText(value), `${context} ${show(value)}`);
                assert.strictEqual(libmime.isPlainText(value, true), mimeFuncs.isPlainText(value, true), `${context} ${show(value)}`);
                assert.strictEqual(libmime.safeEncodeURIComponent(value), mimeFuncs.safeEncodeURIComponent(value), `${context} ${show(value)}`);
            });
        });
    });
});
