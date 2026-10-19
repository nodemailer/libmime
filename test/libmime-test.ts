import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import libmime from '../src/libmime.js';
import * as charset from '../src/charset.js';
import { getCharsetName } from '../src/get-charset-name.js';
import { expectLinear } from './fixtures/timing.js';

describe('libmime', () => {
    describe('#isPlainText', () => {
        it('should detect plain text', () => {
            assert.strictEqual(libmime.isPlainText('abc'), true);
            assert.strictEqual(libmime.isPlainText('abc\x02'), false);
            assert.strictEqual(libmime.isPlainText('abcõ'), false);
        });
        it('should return true', () => {
            assert.strictEqual(libmime.isPlainText('az09\t\r\n~!?'), true);
        });

        it('should return false on low bits', () => {
            assert.strictEqual(libmime.isPlainText('az09\n\x08!?'), false);
        });

        it('should return false on high bits', () => {
            assert.strictEqual(libmime.isPlainText('az09\nõ!?'), false);
        });
    });

    describe('#hasLongerLines', () => {
        it('should detect longer lines', () => {
            assert.strictEqual(libmime.hasLongerLines('abc\ndef', 5), false);
            assert.strictEqual(libmime.hasLongerLines('juf\nabcdef\nghi', 5), true);
        });
    });

    describe('#encodeWord', () => {
        it('should encode quoted-printable', () => {
            assert.strictEqual('=?UTF-8?Q?See_on_=C3=B5hin_test?=', libmime.encodeWord('See on õhin test'));
        });

        it('should encode base64', () => {
            assert.strictEqual('=?UTF-8?B?U2VlIG9uIMO1aGluIHRlc3Q=?=', libmime.encodeWord('See on õhin test', 'B'));
        });

        it('should split quoted-printable on maxLength', () => {
            assert.strictEqual(
                '=?UTF-8?Q?See_on_=C3=B5hin_t?= =?UTF-8?Q?est_natin_natin_na?= =?UTF-8?Q?tin?=',
                libmime.encodeWord('See on õhin test natin natin natin', 'Q', 30)
            );
        });

        it('should keep emoji surrogate pairs together when splitting base64', () => {
            let input = 'Hello 😊😊😊😊😊😊 world',
                encoded = libmime.encodeWord(input, 'B', 25);

            // each chunk must be valid base64 of complete utf-8, so round-trip must equal input
            assert.strictEqual(libmime.decodeWords(encoded), input);
            assert.notStrictEqual(encoded.indexOf('?= =?'), -1);
        });
    });

    describe('#encodeWords', () => {
        it('should treat U+0080 as a char that needs encoding', () => {
            assert.strictEqual(libmime.encodeWords('abc \u0080def', 'Q'), 'abc =?UTF-8?Q?=C2=80def?=');
        });

        it('should encode Ascii range', () => {
            let input1 = 'метель" вьюга',
                input2 = "метель'вьюга",
                input3 = 'Verão você vai adorar!',
                output1 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C=22_?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=',
                output2 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C=27?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=',
                output3 = '=?UTF-8?Q?Ver=C3=A3o_voc=C3=AA?= vai adorar!';

            assert.strictEqual(libmime.encodeWords(input1, 'Q', 52), output1);
            assert.strictEqual(libmime.encodeWords(input2, 'Q', 52), output2);
            assert.strictEqual(libmime.encodeWords(input3, 'Q', 52), output3);
        });

        it('should encode using base64', () => {
            assert.strictEqual(libmime.encodeWords('Tere õhin', 'B'), 'Tere =?UTF-8?B?w7VoaW4=?=');
        });

        it('should accept fromCharset as third argument', () => {
            // Jõgeva encoded as ISO-8859-13 bytes
            let buf = Buffer.from([0x4a, 0xf5, 0x67, 0x65, 0x76, 0x61]);
            assert.strictEqual(libmime.encodeWords(buf, 'Q', 'iso-8859-13'), '=?UTF-8?Q?J=C3=B5geva?=');
        });

        it('should leave pure ascii input unchanged', () => {
            assert.strictEqual(libmime.encodeWords('plain ascii string'), 'plain ascii string');
        });

        it('should end the encoded part with the last word that has non ascii characters', () => {
            assert.strictEqual(libmime.encodeWords('õ ascii õ end'), '=?UTF-8?Q?=C3=B5_ascii_=C3=B5?= end');
            assert.strictEqual(libmime.encodeWords('a b õc d'), 'a b =?UTF-8?Q?=C3=B5c?= d');
            // a non ascii whitespace char (NBSP) ends a word like any other whitespace
            assert.strictEqual(libmime.encodeWords('x\u00a0õ y'), '=?UTF-8?Q?x=C2=A0=C3=B5?= y');
            assert.strictEqual(libmime.encodeWords('õ\u00a0b'), '=?UTF-8?Q?=C3=B5=C2=A0b?=');
        });

        it('should encode a long non ascii word in linear time', { timeout: 5000 }, () => {
            // the regex that found the end of the encoded part was quadratic, 100k chars took 10 seconds
            let input = 'é'.repeat(100000) + ' é';
            let start = Date.now();
            let encoded = libmime.encodeWords(input, 'Q');
            let duration = Date.now() - start;
            assert.ok(duration < 500);
            assert.match(encoded, /^=\?UTF-8\?Q\?/);
            assert.strictEqual(libmime.decodeWords(encoded), input);
        });
    });

    describe('#decodeWord', () => {
        it('should decode quoted-printable payload', () => {
            assert.strictEqual(libmime.decodeWord('UTF-8', 'Q', 'See_on_=C3=B5hin_test'), 'See on õhin test');
        });

        it('should decode base64 payload', () => {
            assert.strictEqual(libmime.decodeWord('UTF-8', 'B', 'U2VlIG9uIMO1aGluIHRlc3Q='), 'See on õhin test');
        });

        it('should ignore RFC 2231 language tag in charset', () => {
            // ISO-8859-13 with a language tag — without the strip iconv would not recognize the charset
            assert.strictEqual(libmime.decodeWord('ISO-8859-13*EN', 'Q', 'J=F5geva'), 'Jõgeva');
        });

        it('should recover from whitespace between = and hex digits', () => {
            // line splitting can leave the '=' separated from the hex pair by whitespace
            assert.strictEqual(libmime.decodeWord('UTF-8', 'Q', '= C3=B5'), 'õ');
            assert.strictEqual(libmime.decodeWord('UTF-8', 'Q', '=C3=\n B5'), 'õ');
        });
    });

    describe('#decodeWords', () => {
        it('should decode lower case hex escapes in Q encoding', () => {
            assert.strictEqual(libmime.decodeWords('=?utf-8?Q?=c3=a1?='), '\u00e1');
        });

        it('should keep an escape that is not two hex digits in Q encoding', () => {
            assert.strictEqual(libmime.decodeWords('=?utf-8?Q?a=zz?='), 'a=zz');
            assert.strictEqual(libmime.decodeWords('=?utf-8?Q?a=4z?='), 'a=4z');
            assert.strictEqual(libmime.decodeWords('=?utf-8?Q?a=4?='), 'a=4');
        });

        it('should decode', () => {
            assert.strictEqual('Hello: See on õhin test', libmime.decodeWords('Hello: =?UTF-8?q?See_on_=C3=B5hin_test?='));
            assert.strictEqual('See on õhin test', libmime.decodeWords('=?UTF-8?q?See_on_=C3=B5hin_test?='));

            assert.strictEqual(
                libmime.decodeWords('=?gb2312?B?z/u30czh0NHIq8Pmyf28ti3Dv8jV0MXTw7ncvNK5qcT6x+HLybbU1csswNbP?=\r\n	 =?gb2312?B?7dDFz6Ih?='),
                '消费提醒全面升级-每日信用管家供您轻松对账,乐享信息!'
            );
        });

        it('should decode mime words', () => {
            assert.strictEqual(
                'Jõge-vaŽ zz Jõge-vaŽJõge-vaŽJõge-vaŽ',
                libmime.decodeWords(
                    '=?ISO-8859-13?Q?J=F5ge-va=DE?= zz =?ISO-8859-13?Q?J=F5ge-va=DE?= =?ISO-8859-13?Q?J=F5ge-va=DE?= =?ISO-8859-13?Q?J=F5ge-va=DE?='
                )
            );
            assert.strictEqual('Sssś Lałalalala', libmime.decodeWords('=?UTF-8?B?U3NzxZsgTGHFgmFsYQ==?= =?UTF-8?B?bGFsYQ==?='));
        });

        it('should decode ascii range', () => {
            let input1 = 'метель" вьюга',
                input2 = "метель'вьюга",
                output1 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C=22_?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=',
                output2 = "=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C'?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=";

            assert.strictEqual(libmime.decodeWords(output1), input1);
            assert.strictEqual(libmime.decodeWords(output2), input2);
        });

        it('should join before parsing', () => {
            assert.strictEqual(
                'GLG: Regulation of Taxi in China - 张一兵',
                libmime.decodeWords('=?utf-8?B?R0xHOiBSZWd1bGF0aW9uIG9mIFRheGkgaW4gQ2hpbmEgLSDl?= =?utf-8?B?vKDkuIDlhbU=?=')
            );
        });

        it('should join base64 encoding which end with = and decode correctly', () => {
            const input = '=?UTF-8?B?MjAxOSDovrLmm4bmlrDlubTpm7vlrZDos4DljaHlj4rnsL3lkI3mqg==?= =?UTF-8?B?lA==?=';
            assert.strictEqual(libmime.decodeWords(input), '2019 農曆新年電子賀卡及簽名檔');
        });

        it('should split QP on maxLength', () => {
            let inputStr = 'Jõgeva Jõgeva Jõgeva mugeva Jõgeva Jõgeva Jõgeva Jõgeva Jõgeva',
                outputStr =
                    '=?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?mugeva_J?= =?UTF-8?Q?=C3=B5geva_J?= =?UTF-8?Q?=C3=B5geva_J?= =?UTF-8?Q?=C3=B5geva_J?= =?UTF-8?Q?=C3=B5geva_J?= =?UTF-8?Q?=C3=B5geva?=',
                encoded = libmime.encodeWords(inputStr, 'Q', 16);

            assert.strictEqual(outputStr, encoded);
            assert.strictEqual(inputStr, libmime.decodeWords(encoded));
        });

        it('should split base64 on maxLength', () => {
            let inputStr = 'õõõõõ õõõõõ õõõõõ mugeva õõõõõ õõõõõ õõõõõ õõõõõ Jõgeva',
                outputStr =
                    '=?UTF-8?B?w7XDtcO1w7XDtSA=?= =?UTF-8?B?w7XDtcO1w7XDtSA=?= =?UTF-8?B?w7XDtcO1w7XDtSBt?= =?UTF-8?B?dWdldmEgw7XDtcO1?= =?UTF-8?B?w7XDtSDDtcO1w7U=?= =?UTF-8?B?w7XDtSDDtcO1w7U=?= =?UTF-8?B?w7XDtSDDtcO1w7U=?= =?UTF-8?B?w7XDtSBKw7VnZXZh?=',
                encoded = libmime.encodeWords(inputStr, 'B', 30);

            assert.strictEqual(outputStr, encoded);
            assert.strictEqual(inputStr, libmime.decodeWords(encoded));
        });

        it('should ignore language param', () => {
            assert.strictEqual('Hello: See on õhin test', libmime.decodeWords('Hello: =?UTF-8*EN?q?See_on_=C3=B5hin_test?='));
        });

        it('should handle invalidly split mime words', () => {
            assert.strictEqual(
                'гос (передай кому надо тоже',
                libmime.decodeWords(
                    '=?utf-8?Q?=D0=B3=D0=BE=D1=81_?==?utf-8?Q?(=D0=BF=D0=B5=D1=80=D0=B5=\r\n D0=B4=D0=B0=D0=B9_=D0=BA=D0=BE=D0?=\r\n =?utf-8?Q?=BC=D1=83_=D0=BD=D0=B0=D0=B4=D0=BE_=D1=82=D0=BE=D0=B6=D0=B5?='
                )
            );
        });

        it('should decode using jconv module', () => {
            assert.strictEqual(libmime.decodeWords('=?ISO-2022-JP?B?GyRCM1g5OzU7PVEwdzgmPSQ4IUYkMnFKczlwGyhC?='), '学校技術員研修検討会報告');
        });

        it('should also decode content empty part', () => {
            assert.strictEqual(libmime.decodeWords('=?UTF-8?Q??= =?UTF-8?Q?=E4=BD=A0=E5=A5=BD?='), '你好');
        });

        it('should not join adjacent base64 words with mismatched charsets', () => {
            // both encode 'õ' but in different charsets — they must be decoded independently,
            // not concatenated and decoded once
            assert.strictEqual(libmime.decodeWords('=?UTF-8?B?w7U=?= =?ISO-8859-13?B?9Q==?='), 'õõ');
        });

        it('should not join adjacent quoted-printable words with mismatched charsets', () => {
            assert.strictEqual(libmime.decodeWords('=?UTF-8?Q?=C3=B5?= =?ISO-8859-13?Q?=F5?='), 'õõ');
        });

        it('should not decode with the utf-7, base64 or hex codecs', () => {
            // iconv-lite knows these, but a message is not written in them. UTF-7 would turn
            // "+ADw-script+AD4-" into "<script>" past any filter that looked at the raw header
            assert.strictEqual(libmime.decodeWords('=?utf-7?Q?+ADw-script+AD4-?='), '+ADw-script+AD4-');
            assert.strictEqual(libmime.decodeWords('=?UTF7?B?' + Buffer.from('+ADw-script+AD4-').toString('base64') + '?='), '+ADw-script+AD4-');
            assert.strictEqual(libmime.decodeWords('=?utf-7-imap?Q?&ADw-script&AD4-?='), '&ADw-script&AD4-');
            assert.strictEqual(libmime.decodeWords('=?hex?Q?3c7363726970743e?='), '3c7363726970743e');
            assert.strictEqual(libmime.decodeWords('=?base64?Q?PHNjcmlwdD4=3D?='), 'PHNjcmlwdD4=');
        });
    });

    describe('#buildHeaderParam', () => {
        it('should encode a value that looks like an encoded word', () => {
            assert.deepStrictEqual(libmime.buildHeaderParam('filename', 'a=?b', 50), [{ key: 'filename*0*', value: "utf-8''a%3D%3Fb" }]);
        });

        it('should not split a plain value of exactly maxLength', () => {
            assert.deepStrictEqual(libmime.buildHeaderParam('title', 'a'.repeat(50), 50), [{ key: 'title', value: 'a'.repeat(50) }]);
        });

        it('should return unmodified', () => {
            assert.deepStrictEqual(
                [
                    {
                        key: 'title',
                        value: 'this is just a title'
                    }
                ],
                libmime.buildHeaderParam('title', 'this is just a title', 500)
            );
        });

        it('should encode and split ascii', () => {
            assert.deepStrictEqual(
                [
                    {
                        key: 'title*0',
                        value: 'this '
                    },
                    {
                        key: 'title*1',
                        value: 'is ju'
                    },
                    {
                        key: 'title*2',
                        value: 'st a '
                    },
                    {
                        key: 'title*3',
                        value: 'title'
                    }
                ],
                libmime.buildHeaderParam('title', 'this is just a title', 5)
            );
        });

        it('should encode double byte unicode characters', () => {
            assert.deepStrictEqual(
                [
                    {
                        key: 'title*0*',
                        value: "utf-8''Unicode%20title%20%F0%9F%98%8A"
                    }
                ],
                libmime.buildHeaderParam('title', 'Unicode title 😊', 50)
            );
        });

        it('should encode and split unicode', () => {
            assert.deepStrictEqual(
                [
                    {
                        key: 'title*0*',
                        value: "utf-8''this%20is%20"
                    },
                    {
                        key: 'title*1',
                        value: 'just a title '
                    },
                    {
                        key: 'title*2*',
                        value: '%C3%B5%C3%A4%C3%B6'
                    },
                    {
                        key: 'title*3*',
                        value: '%C3%BC'
                    }
                ],
                libmime.buildHeaderParam('title', 'this is just a title õäöü', 20)
            );
        });

        it('should encode and split filename with dashes', () => {
            assert.deepStrictEqual(
                [
                    {
                        key: 'filename*0*',
                        value: "utf-8''%C6%94------%C6%94------%C6%94------%C6%94"
                    },
                    {
                        key: 'filename*1*',
                        value: '------%C6%94------%C6%94------%C6%94------.pdf'
                    }
                ],
                libmime.buildHeaderParam('filename', 'Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------.pdf', 50)
            );
        });

        it('should encode and decode', () => {
            let input =
                'Lorěm ipsum doloř siť amet, háš peřpetua compřéhenšam at, ei nám modó soleát éxpétěndá! Boňorum vocibůs dignisšim pro ad, ea sensibus efficiendi intellegam ius. Ad nam aperiam delicata voluptaria, vix nobis luptatum ea, ců úsú graeco viďiššě ňusqúam. ';
            let headerLine =
                'content-disposition: attachment; ' +
                libmime
                    .buildHeaderParam('filename', input, 50)
                    .map(item => item.key + '="' + item.value + '"')
                    .join('; ');
            let parsedHeader = libmime.parseHeaderValue(headerLine);
            assert.strictEqual(input, libmime.decodeWords(parsedHeader.params.filename));
        });

        it('should normalize input that is neither a string nor a Buffer', () => {
            assert.deepStrictEqual(libmime.buildHeaderParam('size', 12345, 50), [{ key: 'size', value: '12345' }]);
            assert.deepStrictEqual(libmime.buildHeaderParam('size', 0, 50), [{ key: 'size', value: '0' }]);
            assert.deepStrictEqual(libmime.buildHeaderParam('size', null, 50), [{ key: 'size', value: '' }]);
            assert.deepStrictEqual(libmime.buildHeaderParam('size', undefined, 50), [{ key: 'size', value: '' }]);
        });

        it('should accept a Buffer as input', () => {
            assert.deepStrictEqual(libmime.buildHeaderParam('filename', Buffer.from('Jõgeva.txt'), 50), [
                {
                    key: 'filename*0*',
                    value: "utf-8''J%C3%B5geva.txt"
                }
            ]);

            assert.deepStrictEqual(libmime.buildHeaderParam('filename', Buffer.from('Jõgeva.txt', 'latin1'), 50, 'iso-8859-1'), [
                {
                    key: 'filename*0*',
                    value: "utf-8''J%C3%B5geva.txt"
                }
            ]);
        });
    });

    describe('#decodeHeader', () => {
        it('should split a header line into key and value', () => {
            assert.deepStrictEqual(libmime.decodeHeader('Subject: Hello world'), {
                key: 'subject',
                value: 'Hello world'
            });
        });

        it('should lowercase the key', () => {
            assert.deepStrictEqual(libmime.decodeHeader('SUBJECT: Hello'), {
                key: 'subject',
                value: 'Hello'
            });
        });

        it('should split only on the first colon', () => {
            assert.deepStrictEqual(libmime.decodeHeader('URL: https://example.com:8080/path'), {
                key: 'url',
                value: 'https://example.com:8080/path'
            });
        });

        it('should unfold continuation lines', () => {
            assert.deepStrictEqual(libmime.decodeHeader('Subject: line one\r\n\tcontinued'), {
                key: 'subject',
                value: 'line one continued'
            });
        });

        it('should return empty key and value for an empty line', () => {
            assert.deepStrictEqual(libmime.decodeHeader(''), {
                key: '',
                value: ''
            });
        });

        it('should return empty key and value when no colon is present', () => {
            assert.deepStrictEqual(libmime.decodeHeader('no colon here'), {
                key: '',
                value: ''
            });
        });
    });

    describe('#decodeHeaders', () => {
        it('should decode headers', () => {
            let headersObj = {
                    subject: ['Tere =?UTF-8?Q?J=C3=B5geva?='],
                    'x-app': ['My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 1', 'My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 2'],
                    'long-line': [
                        'tere =?UTF-8?Q?=C3=B5klva?= karu =?UTF-8?Q?m=C3=B5kva_=C5=A1apaka=C5=A1?= tutikas suur maja, =?UTF-8?Q?k=C3=B5rge?= hoone, segane jutt'
                    ]
                },
                headersStr =
                    'Subject: Tere =?UTF-8?Q?J=C3=B5geva?=\r\n' +
                    'X-APP: My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 1\r\n' +
                    'X-APP: My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 2\r\n' +
                    'Long-Line: tere =?UTF-8?Q?=C3=B5klva?= karu\r\n' +
                    ' =?UTF-8?Q?m=C3=B5kva_=C5=A1apaka=C5=A1?= tutikas suur maja,\r\n' +
                    ' =?UTF-8?Q?k=C3=B5rge?= hoone, segane jutt';

            assert.deepStrictEqual(headersObj, libmime.decodeHeaders(headersStr));
        });

        it('should not pollute prototype or crash on special header keys', () => {
            let headersObj = libmime.decodeHeaders('__proto__: value1\r\nConstructor: value2\r\nConstructor: value3\r\nToString: value4');

            // reading headersObj.__proto__ would return the prototype, so check the own property instead
            assert.strictEqual(Object.getPrototypeOf(headersObj), Object.prototype);
            assert.deepStrictEqual(Object.getOwnPropertyDescriptor(headersObj, '__proto__')?.value, ['value1']);

            assert.deepStrictEqual(Object.keys(headersObj), ['__proto__', 'constructor', 'tostring']);
            assert.deepStrictEqual(headersObj.constructor, ['value2', 'value3']);
            assert.deepStrictEqual(headersObj.tostring, ['value4']);
        });

        it('should stop at the end of the header block', () => {
            // the body must not be folded into the last header
            assert.deepStrictEqual(libmime.decodeHeaders('A: 1\r\n\r\n B: 2'), { a: ['1'] });
            assert.deepStrictEqual(libmime.decodeHeaders('A: 1\r\n\r\nB: 2'), { a: ['1'] });
            // a trailing line break does not add an empty key
            assert.deepStrictEqual(libmime.decodeHeaders('A: 1\r\n'), { a: ['1'] });
            // a line break in front of the block is not a terminator, a caller might pass
            // along the break that separates a mime part boundary from its headers
            assert.deepStrictEqual(libmime.decodeHeaders('\r\nA: 1\r\nB: 2'), { a: ['1'], b: ['2'] });
        });

        it('should only fold lines that start with a space or a tab', () => {
            assert.deepStrictEqual(libmime.decodeHeaders('A: 1\r\n B: 2'), { a: ['1 B: 2'] });
            assert.deepStrictEqual(libmime.decodeHeaders('A: 1\r\n\tB: 2'), { a: ['1 B: 2'] });
            // other whitespace does not fold, so B stays a header of its own
            assert.deepStrictEqual(libmime.decodeHeaders('A: 1\r\n\u00a0B: 2'), { a: ['1'], b: ['2'] });
            assert.deepStrictEqual(libmime.decodeHeaders('A: 1\r\n\fB: 2'), { a: ['1'], b: ['2'] });
        });

        it('should keep a continuation line in front of the first header as is', () => {
            assert.deepStrictEqual(libmime.decodeHeaders(' A: 1\r\nB: 2\r\n 3\r\n\t4'), { a: ['1'], b: ['2 3 4'] });
        });

        it('should unfold many continuation lines in linear time', { timeout: 20000 }, () => {
            expectLinear(
                n => 'X-A: 1\r\n 2\r\n'.repeat(n),
                headers => libmime.decodeHeaders(headers),
                100000
            );
            assert.deepStrictEqual(libmime.decodeHeaders('X-A: 1\r\n 2\r\n'.repeat(3)), { 'x-a': ['1 2', '1 2', '1 2'] });
        });
    });

    describe('#parseHeaderValue', () => {
        it('should handle default value only', () => {
            let str = 'text/plain',
                obj = {
                    value: 'text/plain',
                    params: {}
                };

            assert.deepStrictEqual(libmime.parseHeaderValue(str), obj);
        });

        it('should handle unquoted params', () => {
            let str = 'text/plain; CHARSET= UTF-8; format=flowed;',
                obj = {
                    value: 'text/plain',
                    params: {
                        charset: 'UTF-8',
                        format: 'flowed'
                    }
                };

            assert.deepStrictEqual(libmime.parseHeaderValue(str), obj);
        });

        it('should handle quoted params', () => {
            let str = 'text/plain; filename= ";;;\\""; format=flowed;',
                obj = {
                    value: 'text/plain',
                    params: {
                        filename: ';;;"',
                        format: 'flowed'
                    }
                };

            assert.deepStrictEqual(libmime.parseHeaderValue(str), obj);
        });

        it('should handle multi line values', () => {
            let str =
                    'text/plain; single_encoded*="UTF-8\'\'%C3%95%C3%84%C3%96%C3%9C";\n' +
                    " multi_encoded*0*=UTF-8''%C3%96%C3%9C;\n" +
                    ' multi_encoded*1*=%C3%95%C3%84;\n' +
                    ' no_charset*0=OA;\n' +
                    ' no_charset*1=OU;',
                obj = {
                    value: 'text/plain',
                    params: {
                        single_encoded: 'ÕÄÖÜ',
                        multi_encoded: 'ÖÜÕÄ',
                        no_charset: 'OAOU'
                    }
                };

            assert.deepStrictEqual(libmime.parseHeaderValue(str), obj);
        });

        it('should handle multi line ascii values', () => {
            let str =
                    'text/plain;\n' +
                    '\tname*0=emailengine_uuendamise_kasud_ja_muud_asjad_ja_veelgi_pikem_pealk;\n' +
                    '\tname*1=iri.txt;\n' +
                    '\tx-apple-part-url=99AFDE83-8953-43B4-BE59-F59D6160AFAB',
                obj = {
                    value: 'text/plain',
                    params: {
                        name: 'emailengine_uuendamise_kasud_ja_muud_asjad_ja_veelgi_pikem_pealkiri.txt',
                        'x-apple-part-url': '99AFDE83-8953-43B4-BE59-F59D6160AFAB'
                    }
                };

            assert.deepStrictEqual(libmime.parseHeaderValue(str), obj);
        });

        it('should handle ARC header from MS', () => {
            let str =
                    'i=1; mx.microsoft.com 1; spf=fail (sender ip is 52.138.216.130) smtp.rcpttodomain=recipient.com smtp.mailfrom=sender.com; dmarc=fail (p=reject sp=reject pct=100) action=oreject header.from=sender.com; dkim=none (message not signed); arc=none (0)',
                obj = {
                    value: 'i=1',
                    params: {
                        // the authserv-id and version make up a key without a value
                        'mx.microsoft.com 1': '',
                        spf: 'fail (sender ip is 52.138.216.130) smtp.rcpttodomain=recipient.com smtp.mailfrom=sender.com',
                        dmarc: 'fail (p=reject sp=reject pct=100) action=oreject header.from=sender.com',
                        dkim: 'none (message not signed)',
                        arc: 'none (0)'
                    }
                };

            assert.deepStrictEqual(libmime.parseHeaderValue(str), obj);
        });

        it('should handle params only', () => {
            let str = '; CHARSET= UTF-8; format=flowed;',
                obj = {
                    value: '',
                    params: {
                        charset: 'UTF-8',
                        format: 'flowed'
                    }
                };

            assert.deepStrictEqual(libmime.parseHeaderValue(str), obj);
        });

        it('should handle trailing key-only param', () => {
            let str = 'text/plain; charset=utf-8; flag',
                obj = {
                    value: 'text/plain',
                    params: {
                        charset: 'utf-8',
                        flag: ''
                    }
                };

            assert.deepStrictEqual(libmime.parseHeaderValue(str), obj);
        });

        it('should handle escaped backslash inside a quoted param', () => {
            let str = 'text/plain; name="a\\\\b"',
                obj = {
                    value: 'text/plain',
                    params: {
                        name: 'a\\b'
                    }
                };

            assert.deepStrictEqual(libmime.parseHeaderValue(str), obj);
        });

        it('should handle a key-only param in the middle of the list', () => {
            let str = 'attachment; inline; filename=a.txt',
                obj = {
                    value: 'attachment',
                    params: {
                        inline: '',
                        filename: 'a.txt'
                    }
                };

            assert.deepStrictEqual(libmime.parseHeaderValue(str), obj);
        });

        it('should keep whitespace inside quotes', () => {
            assert.deepStrictEqual(libmime.parseHeaderValue('attachment; filename=" a.txt "'), {
                value: 'attachment',
                params: {
                    filename: ' a.txt '
                }
            });

            // whitespace outside of the quotes is not part of the value
            assert.deepStrictEqual(libmime.parseHeaderValue('attachment ;  filename = "a.txt"  '), {
                value: 'attachment',
                params: {
                    filename: 'a.txt'
                }
            });

            assert.deepStrictEqual(libmime.parseHeaderValue('attachment; filename= a b '), {
                value: 'attachment',
                params: {
                    filename: 'a b'
                }
            });
        });

        it('should let a continuation param override a plain param in either order', () => {
            // rfc6266 section 4.3, the plain param is only the ascii fallback of the extended one
            let obj = {
                value: 'attachment',
                params: {
                    filename: 'Jõgeva.txt'
                }
            };

            assert.deepStrictEqual(libmime.parseHeaderValue('attachment; filename="Jogeva.txt"; filename*=UTF-8\'\'J%C3%B5geva.txt'), obj);
            assert.deepStrictEqual(libmime.parseHeaderValue('attachment; filename*=UTF-8\'\'J%C3%B5geva.txt; filename="Jogeva.txt"'), obj);

            // an empty or valueless fallback must not annihilate the extended value either
            assert.deepStrictEqual(libmime.parseHeaderValue("attachment; filename=; filename*=UTF-8''invoice.exe").params, { filename: 'invoice.exe' });
            assert.deepStrictEqual(libmime.parseHeaderValue("attachment; filename; filename*=UTF-8''invoice.exe").params, { filename: 'invoice.exe' });

            // and the multi segment form behaves the same
            assert.deepStrictEqual(libmime.parseHeaderValue('inline; filename="image.png"; filename*0*=UTF-8\'\'image; filename*1*=.svg').params, {
                filename: 'image.svg'
            });
        });

        it('should handle nested continuation keys', () => {
            // each continuation group is assembled on its own, nothing turns into "[object Object]"
            assert.deepStrictEqual(libmime.parseHeaderValue('attachment; a**=x; a*=y').params, { 'a*': 'x', a: 'y' });
            assert.deepStrictEqual(libmime.parseHeaderValue('text/plain; foo*1**0*=a; foo*1*=b').params, { 'foo*1*': 'a', foo: 'b' });
        });

        it('should not let a charset value inject a mime word', () => {
            assert.deepStrictEqual(libmime.parseHeaderValue("attachment; filename*0*=utf-8?B?QUJD?=''zzz").params, { filename: 'zzz' });
            assert.deepStrictEqual(libmime.parseHeaderValue("attachment; filename*0*=ut?f8''abc").params, { filename: 'abc' });
        });

        it('should decode an rfc2231 value once and name it in decodedParams', () => {
            // percent-encoding an encoded word must not get it decoded a second time
            let parsed = libmime.parseHeaderValue("attachment; filename*=utf-8''invoice%3D%3Futf-8%3FQ%3F%3D2Eexe%3F%3D");
            assert.strictEqual(parsed.params.filename, 'invoice=?utf-8?Q?=2Eexe?=');
            assert.deepStrictEqual(parsed.decodedParams, ['filename']);

            // the segments of a continuation without a charset are decoded as mime words, once
            parsed = libmime.parseHeaderValue('attachment; filename*0="=?utf-8?Q?=3D=3Futf-8=3FQ=3F=3D2Eexe=3F=3D?="; filename*1=".txt"; x=y');
            assert.deepStrictEqual(parsed.params, { filename: '=?utf-8?Q?=2Eexe?=.txt', x: 'y' });
            assert.deepStrictEqual(parsed.decodedParams, ['filename']);

            // a plain param is returned as is, decoding it is up to the caller
            parsed = libmime.parseHeaderValue('attachment; filename="=?utf-8?Q?=2Eexe?="');
            assert.strictEqual(parsed.params.filename, '=?utf-8?Q?=2Eexe?=');
            assert.deepStrictEqual(parsed.decodedParams, []);
        });

        it('should keep decodedParams out of the enumerable result', () => {
            let parsed = libmime.parseHeaderValue("attachment; filename*=utf-8''a.txt");
            assert.deepStrictEqual(Object.keys(parsed), ['value', 'params']);
            assert.deepStrictEqual(JSON.parse(JSON.stringify(parsed)), { value: 'attachment', params: { filename: 'a.txt' } });
        });

        it('should not pollute Object.prototype via __proto__ param keys', () => {
            // covers every code path that stores a parsed param
            let cases = [
                ['text/plain; __proto__; x=1', ''],
                ['text/plain; __proto__=plain; x=1', 'plain'],
                ['text/plain; __proto__=plain', 'plain'],
                ['text/plain; x=1; __proto__', ''],
                ["text/plain; __proto__*0*=utf-8''polluted", 'polluted'],
                ['text/plain; __proto__*0=abc', 'abc']
            ];

            for (let [str, value] of cases) {
                let params = libmime.parseHeaderValue(str).params;

                assert.strictEqual(Object.getPrototypeOf(params), Object.prototype, str);
                // a plain assignment with a string value would not create an own property at all
                assert.strictEqual(Object.getOwnPropertyDescriptor(params, '__proto__')?.value, value, str);

                assert.strictEqual(({} as Record<string, unknown>).charset, undefined, str);
                assert.strictEqual(({} as Record<string, unknown>).values, undefined, str);
                assert.strictEqual(({} as Record<string, unknown>).x, undefined, str);
            }
        });
    });

    describe('#_buildHeaderValue', () => {
        it('should encode a parameter value that looks like an encoded word', () => {
            let built = libmime.buildHeaderValue({ value: 'attachment', params: { filename: '=?utf-8?Q?evil?=.txt' } });
            assert.strictEqual(built, "attachment; filename*0*=utf-8''%3D%3Futf-8%3FQ%3Fevil%3F%3D.txt");
            assert.deepStrictEqual(libmime.parseHeaderValue(built).params, { filename: '=?utf-8?Q?evil?=.txt' });
        });

        it('should build header value', () => {
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test'
                }),
                'test'
            );
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: 'b'
                    }
                }),
                'test; a=b'
            );
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: ';'
                    }
                }),
                'test; a=";"'
            );
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: ';"'
                    }
                }),
                'test; a=";\\""'
            );
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: 'b',
                        c: 'd'
                    }
                }),
                'test; a=b; c=d'
            );
        });

        it('should handle unicode filename', () => {
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: 'b',
                        filename: '😁😂 *\'%()<>@,;:\\"[]?=😃😄zzz😊õäöü😓.pdf'
                    }
                }),
                "test; a=b; filename*0*=utf-8''%F0%9F%98%81%F0%9F%98%82%20%2A%27%25%28%29; filename*1*=%3C%3E%40%2C%3B%3A%5C%22%5B%5D%3F%3D%F0%9F%98%83; filename*2*=%F0%9F%98%84zzz%F0%9F%98%8A%C3%B5%C3%A4%C3%B6; filename*3*=%C3%BC%F0%9F%98%93.pdf"
            );
        });

        it('should handle dashed filename', () => {
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        filename: 'Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------Ɣ------.pdf'
                    }
                }),
                "test; filename*0*=utf-8''%C6%94------%C6%94------%C6%94------%C6%94; filename*1*=------%C6%94------%C6%94------%C6%94------.pdf"
            );
        });

        it('should split emoji filename', () => {
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        a: 'b',
                        filename: 'Jõge-vaŽJõge-vaŽJõge-vaŽ.pdf'
                    }
                }),
                "test; a=b; filename*0*=utf-8''J%C3%B5ge-va%C5%BDJ%C3%B5ge-va%C5%BDJ; filename*1*=%C3%B5ge-va%C5%BD.pdf"
            );
        });

        it('should quote filename with spaces', () => {
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        filename: 'document a.pdf'
                    }
                }),
                'test; filename="document a.pdf"'
            );
        });

        // For exhaustive list of special characters
        // Refer: https://www.w3.org/Protocols/rfc1341/4_Content-Type.html
        it('should quote filename with special characters', () => {
            // The case of browser downloads when we download multiple files with same name.
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        filename: 'receipt(3).pdf'
                    }
                }),
                'test; filename="receipt(3).pdf"'
            );

            // For headers which are comma separated as in case of multiple from members elements.
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        filename: 'jack,jill.pdf'
                    }
                }),
                'test; filename="jack,jill.pdf"'
            );

            // Added support for some more special characters
            let correctString = [
                'space="x y"',
                'small_bracket_open="x(y"',
                'small_bracket_close="x)y"',
                'angle_bracket_open="x<y"',
                'angle_bracket_close="x>y"',
                'at_the_rate="x@y"',
                'semicolon="x;y"',
                'colon="x:y"',
                'back_slash="x\\\\y"',
                'single_quote="x\'y"',
                'double_quotes="x\\"y"',
                'forward_slash="x/y"',
                'big_bracket_open="x[y"',
                'big_bracket_close="x]y"',
                'question_mark="x?y"',
                'comma="x,y"',
                'equals="x=y"',
                'negative_in_mid=x-y',
                'negative_in_start="-x"'
            ].join('; ');

            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'test',
                    params: {
                        space: 'x y',
                        small_bracket_open: 'x(y',
                        small_bracket_close: 'x)y',
                        angle_bracket_open: 'x<y',
                        angle_bracket_close: 'x>y',
                        at_the_rate: 'x@y',
                        semicolon: 'x;y',
                        colon: 'x:y',
                        back_slash: 'x\\y',
                        single_quote: "x'y",
                        double_quotes: 'x"y',
                        forward_slash: 'x/y',
                        big_bracket_open: 'x[y',
                        big_bracket_close: 'x]y',
                        question_mark: 'x?y',
                        comma: 'x,y',
                        equals: 'x=y',
                        negative_in_mid: 'x-y',
                        negative_in_start: '-x'
                    }
                }),
                'test; ' + correctString
            );
        });

        it('should split long pure-ascii param via RFC 2231 continuation', () => {
            let longAscii = 'a'.repeat(75);
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'attachment',
                    params: { filename: longAscii }
                }),
                'attachment; filename*0=' + 'a'.repeat(50) + '; filename*1=' + 'a'.repeat(25)
            );
        });

        it('should handle a param value that is not a string', () => {
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'attachment',
                    params: { size: 12345 }
                }),
                'attachment; size=12345'
            );

            // a falsy value must not turn into an empty param
            assert.strictEqual(
                libmime.buildHeaderValue({
                    value: 'attachment',
                    params: { size: 0 }
                }),
                'attachment; size=0'
            );
        });
    });

    describe('#encodeFlowed', () => {
        it('should wrap flowed text', () => {
            let str = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere\r\nFrom\r\n Hello\r\n> abc\r\nabc',
                folded =
                    'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere \r\n' +
                    'tere tere tere tere tere\r\n' +
                    ' From\r\n' +
                    '  Hello\r\n' +
                    ' > abc\r\n' +
                    'abc';
            assert.strictEqual(libmime.encodeFlowed(str), folded);
        });
    });

    describe('#decodeFlowed', () => {
        it('should remove soft line breaks', () => {
            let str = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere\nFrom\n Hello\n> abc\nabc',
                folded =
                    'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere \r\n' +
                    'tere tere tere tere tere\r\n' +
                    ' From\r\n' +
                    '  Hello\r\n' +
                    ' > abc\r\n' +
                    'abc';
            assert.strictEqual(libmime.decodeFlowed(folded), str);
        });

        it('should remove soft line breaks and spacing', () => {
            let str = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere teretere tere tere tere tere\nFrom\n Hello\n> abc\nabc',
                folded =
                    'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere \r\n' +
                    'tere tere tere tere tere\r\n' +
                    ' From\r\n' +
                    '  Hello\r\n' +
                    ' > abc\r\n' +
                    'abc';
            assert.strictEqual(libmime.decodeFlowed(folded, true), str);
        });

        it('should remove SP CRLF before space', () => {
            let str = 'first\nsecond\nthird continued',
                folded = 'first\r\nsecond\r\nthird \r\n continued';
            assert.strictEqual(libmime.decodeFlowed(folded, true), str);
        });

        it('should remove SP CRLF after space', () => {
            let str = 'first\nsecond\nthird continued',
                folded = 'first\r\nsecond\r\nthird  \r\ncontinued';
            assert.strictEqual(libmime.decodeFlowed(folded, true), str);
        });

        it('should preserve signature delimiter as a hard break', () => {
            // a line ending in '-- ' is the rfc 3676 signature delimiter and
            // must NOT be unwrapped even though it ends with a trailing space
            let folded = 'hello\r\n-- \r\nFooter line\r\nSecond line';
            assert.strictEqual(libmime.decodeFlowed(folded), 'hello\n-- \nFooter line\nSecond line');
        });

        it('should only treat a whole "-- " line as the signature delimiter', () => {
            // "-- " at the end of a longer line is an ordinary soft break
            assert.strictEqual(libmime.decodeFlowed('a -- \r\nb'), 'a -- b');
            assert.strictEqual(libmime.decodeFlowed('-- \r\n-- \r\nb'), '-- \n-- \nb');
            // a delsp join that happens to produce "-- " is a signature delimiter as well
            assert.strictEqual(libmime.decodeFlowed('- \r\n- \r\nb', true), '-- \nb');
            // an empty line after a soft break does not end the paragraph, it still ends with a space
            assert.strictEqual(libmime.decodeFlowed('a \r\n\r\nb \r\n'), 'a b ');
            assert.strictEqual(libmime.decodeFlowed('a  \r\n\r\nb', true), 'ab');
        });

        it('should decode long soft wrapped paragraphs in linear time', { timeout: 20000 }, () => {
            let build = (n: number) => 'word word word \r\n'.repeat(n) + 'end';
            expectLinear(build, str => libmime.decodeFlowed(str), 25000);
            expectLinear(build, str => libmime.decodeFlowed(str, true), 25000);
            assert.strictEqual(libmime.decodeFlowed(build(3)), 'word word word word word word word word word end');
            assert.strictEqual(libmime.decodeFlowed(build(3), true), 'word word wordword word wordword word wordend');
        });

        it('should join soft wrapped quoted lines without copying the continuation quote marker', () => {
            assert.strictEqual(libmime.decodeFlowed('> quoted soft \r\n> continued\r\nnew'), '> quoted soft continued\nnew');
            assert.strictEqual(libmime.decodeFlowed('>> deep soft \r\n>> more\r\n> shallow'), '>> deep soft more\n> shallow');
            assert.strictEqual(libmime.decodeFlowed('>quoted soft \r\n>continued'), '>quoted soft continued');
        });

        it('should treat the space after a quote marker as stuffing, not a soft line break', () => {
            // an empty quoted line written as "> " used to swallow the next quoted line as "> > Also, ..."
            assert.strictEqual(libmime.decodeFlowed('> \r\n> Also, the delivery\r\n> the system.'), '> \n> Also, the delivery\n> the system.');
            assert.strictEqual(libmime.decodeFlowed('> a\r\n>'), '> a\n>');
        });

        it('should never join lines across a change of quote depth', () => {
            assert.strictEqual(libmime.decodeFlowed('a \r\n> b'), 'a \n> b');
            assert.strictEqual(libmime.decodeFlowed('> a \r\nb'), '> a \nb');
            assert.strictEqual(libmime.decodeFlowed('> a \r\n>> b'), '> a \n>> b');
            // a space-stuffed ">" is text at depth 0, not a quote marker
            assert.strictEqual(libmime.decodeFlowed('foo \r\n >bar'), 'foo >bar');
        });

        it('should apply delsp to quoted soft line breaks', () => {
            assert.strictEqual(libmime.decodeFlowed('> split \r\n> word', true), '> splitword');
        });

        it('should treat a quoted "-- " line as a signature delimiter', () => {
            assert.strictEqual(libmime.decodeFlowed('> -- \r\n> sig'), '> -- \n> sig');
        });

        it('should decode long quoted soft wrapped paragraphs in linear time', { timeout: 20000 }, () => {
            let build = (n: number) => '>> word word \r\n'.repeat(n) + '>> end';
            expectLinear(build, str => libmime.decodeFlowed(str), 25000);
            expectLinear(build, str => libmime.decodeFlowed(str, true), 25000);
            assert.strictEqual(libmime.decodeFlowed(build(2)), '>> word word word word end');
        });
    });

    describe('#charset', () => {
        describe('#encode', () => {
            it('should encode UTF-8 to Buffer', () => {
                let str = '신',
                    encoded = Buffer.from([0xec, 0x8b, 0xa0]);

                assert.deepStrictEqual(encoded, charset.encode(str));
            });
        });

        describe('#decode', () => {
            it('should decode UTF-8 to Buffer', () => {
                let str = '신',
                    encoded = Buffer.from([0xec, 0x8b, 0xa0]);

                assert.deepStrictEqual(str, charset.decode(encoded));
            });

            it('should decode non UTF-8 Buffer', () => {
                let str = '신',
                    encoding = 'ks_c_5601-1987',
                    encoded = Buffer.from([0xbd, 0xc5]);

                assert.deepStrictEqual(str, charset.decode(encoded, encoding));
            });

            it('should decode EUC-JP', () => {
                // 日本 in EUC-JP
                let encoded = Buffer.from([0xc6, 0xfc, 0xcb, 0xdc]);
                assert.strictEqual(charset.decode(encoded, 'EUC-JP'), '日本');
            });

            it('should decode an ISO-2022-JP body', () => {
                // "ESC $ B" switches to JIS X 0208, "ESC ( B" back to ASCII
                let encoded = Buffer.concat([
                    Buffer.from([0x1b, 0x24, 0x42, 0x46, 0x7c, 0x4b, 0x5c, 0x38, 0x6c, 0x1b, 0x28, 0x42]),
                    Buffer.from(' Japanese\r\nline 2')
                ]);
                assert.strictEqual(charset.decode(encoded, 'ISO-2022-JP'), '\u65e5\u672c\u8a9e Japanese\r\nline 2');
            });

            it('should decode an ISO-2022-JP string the same as a Buffer', () => {
                let jis = '\x1b$B$3$s$K$A$O\x1b(B';
                assert.strictEqual(charset.decode(jis as unknown as Buffer, 'ISO-2022-JP'), '\u3053\u3093\u306b\u3061\u306f');
            });

            it('should decode NEC row 13 characters', () => {
                // circled digit one and numero sign live in the NEC special area (JIS row 13, CP932 0x87xx),
                // which plain JIS X 0208 decoders map to nothing
                let jis = Buffer.from([0x1b, 0x24, 0x42, 0x2d, 0x21, 0x2d, 0x62, 0x1b, 0x28, 0x42]);
                assert.strictEqual(charset.decode(jis, 'ISO-2022-JP'), '\u2460\u2116');
                assert.strictEqual(charset.decode(Buffer.from([0x87, 0x40, 0x87, 0x82]), 'CP932'), '\u2460\u2116');
            });

            it('should fall back to UTF-8 for an unknown charset', () => {
                assert.strictEqual(charset.decode(Buffer.from([0x74, 0xc3, 0xb5]), 'x-unknown-charset'), 't\u00f5');
                // invalid UTF-8 is replaced, not thrown
                assert.strictEqual(charset.decode(Buffer.from([0x74, 0xf5]), 'x-unknown-charset'), 't\ufffd');
            });

            it('should treat the utf-7, base64 and hex codecs as unknown charsets', () => {
                assert.strictEqual(charset.decode(Buffer.from('+ADw-script+AD4-'), 'utf-7'), '+ADw-script+AD4-');
                assert.strictEqual(charset.decode(Buffer.from('+ADw-script+AD4-'), 'UTF7'), '+ADw-script+AD4-');
                // the year suffix iconv-lite strips off a name must not get around the check
                assert.strictEqual(charset.decode(Buffer.from('+ADw-script+AD4-'), 'utf-7:1998'), '+ADw-script+AD4-');
                assert.strictEqual(charset.decode(Buffer.from('&ADw-script&AD4-'), 'utf-7-imap'), '&ADw-script&AD4-');
                // aliases iconv-lite resolves to the same codecs
                assert.strictEqual(charset.decode(Buffer.from('+ADw-script+AD4-'), 'unicode-1-1-utf-7'), '+ADw-script+AD4-');
                assert.strictEqual(libmime.decodeWords('=?unicode-1-1-utf-7?Q?+ADw-script+AD4-?='), '+ADw-script+AD4-');
                assert.strictEqual(charset.decode(Buffer.from('3c3e'), 'hex'), '3c3e');
                assert.strictEqual(charset.decode(Buffer.from('PD4='), 'base64'), 'PD4=');
            });
        });

        describe('#convert', () => {
            it('should only pass a Buffer through for an exact UTF-8 name', () => {
                // a name that merely contains utf-8 is an unknown charset and gets the same fallback
                let invalid = Buffer.from([0x74, 0xff]);
                assert.strictEqual(charset.convert(invalid, 'utf-8'), invalid);
                assert.deepStrictEqual(charset.convert(invalid, 'x-utf-8-mac'), charset.convert(invalid, 'x-unknown-charset'));
                assert.deepStrictEqual(charset.convert(invalid, 'x-utf-8-mac'), Buffer.from('t\ufffd'));
            });

            it('should convert non UTF-8 to Buffer', () => {
                let converted = Buffer.from([0xec, 0x8b, 0xa0]),
                    encoding = 'ks_c_5601-1987',
                    encoded = Buffer.from([0xbd, 0xc5]);

                assert.deepStrictEqual(converted, charset.convert(encoded, encoding));
            });
        });

        describe('#normalizeCharset', () => {
            it('should resolve curated aliases', () => {
                assert.strictEqual(charset.normalizeCharset('latin1'), 'windows-1252');
            });

            it('should resolve win-NNNN to windows-NNNN', () => {
                assert.strictEqual(charset.normalizeCharset('win-1257'), 'windows-1257');
            });

            it('should normalize separator variants', () => {
                assert.strictEqual(charset.normalizeCharset('utf_8'), 'UTF-8');
            });

            it('should uppercase unknown charsets', () => {
                assert.strictEqual(charset.normalizeCharset('mychrset'), 'MYCHRSET');
            });

            it('should default missing or invalid input to UTF-8', () => {
                assert.strictEqual(charset.normalizeCharset(), 'UTF-8');
                assert.strictEqual(charset.normalizeCharset(null), 'UTF-8');
                assert.strictEqual(charset.normalizeCharset(''), 'UTF-8');
            });
        });
    });

    describe('mimetypes', () => {
        describe('#detectExtension', () => {
            it('should find exact match', () => {
                let extension = 'doc',
                    contentType = 'application/msword';

                assert.strictEqual(libmime.detectExtension(contentType), extension);
            });

            it('should find best match', () => {
                let extension = 'jpeg',
                    contentType = 'image/jpeg';

                assert.strictEqual(libmime.detectExtension(contentType), extension);
                assert.strictEqual(libmime.detectExtension('text/plain'), 'txt');
            });

            it('should find default match', () => {
                let extension = 'bin',
                    contentType = 'sugri/mugri';

                assert.strictEqual(libmime.detectExtension(contentType), extension);

                contentType = 'application/octet-stream';

                assert.strictEqual(libmime.detectExtension(contentType), extension);
            });

            it('should not resolve inherited Object.prototype members', () => {
                assert.strictEqual(libmime.detectExtension('constructor'), 'bin');
                assert.strictEqual(libmime.detectExtension('__proto__'), 'bin');
                assert.strictEqual(libmime.detectExtension('tostring'), 'bin');
            });
        });

        describe('#detectMimeType', () => {
            it('should find exact match', () => {
                let extension = 'doc',
                    contentType = 'application/msword';

                assert.strictEqual(libmime.detectMimeType(extension), contentType);
            });

            it('should find best match', () => {
                let extension = 'index.js',
                    contentType = 'application/javascript';

                assert.strictEqual(libmime.detectMimeType(extension), contentType);
            });

            it('should strip a leading dot from the extension', () => {
                assert.strictEqual(libmime.detectMimeType('.jpg'), 'image/jpeg');
            });

            it('should pick the last segment of a multi-dot filename', () => {
                assert.strictEqual(libmime.detectMimeType('archive.tar.gz'), 'application/x-gzip');
            });

            it('should fall back to application/octet-stream for unknown extensions', () => {
                assert.strictEqual(libmime.detectMimeType('unknownext'), 'application/octet-stream');
            });

            it('should not resolve inherited Object.prototype members', () => {
                assert.strictEqual(libmime.detectMimeType('invoice.constructor'), 'application/octet-stream');
                assert.strictEqual(libmime.detectMimeType('__proto__'), 'application/octet-stream');
                assert.strictEqual(libmime.detectMimeType('tostring'), 'application/octet-stream');
            });
        });
    });

    describe('#splitMimeEncodedString', () => {
        it('should only walk back over UTF-8 continuation bytes', () => {
            // =7F is ASCII and =C2 starts a sequence, neither may pull the escape in front of it along
            assert.deepStrictEqual(libmime.splitMimeEncodedString('abcdefghi=41=7F', 12), ['abcdefghi=41', '=7F']);
            assert.deepStrictEqual(libmime.splitMimeEncodedString('abcdefghi=41=C2=A2', 12), ['abcdefghi=41', '=C2=A2']);
        });

        it('should split plain text at maxlen', () => {
            assert.deepStrictEqual(libmime.splitMimeEncodedString('abcdefghijklmnop', 12), ['abcdefghijkl', 'mnop']);
        });

        it('should not split an escaped octet', () => {
            assert.deepStrictEqual(libmime.splitMimeEncodedString('abcdefghij=C3=B5', 12), ['abcdefghij', '=C3=B5']);
        });

        it('should not split a multi byte UTF-8 sequence', () => {
            assert.deepStrictEqual(libmime.splitMimeEncodedString('=C3=B5=C3=B5=C3=B5=C3=B5=C3=B5', 12), ['=C3=B5=C3=B5', '=C3=B5=C3=B5', '=C3=B5']);
        });

        it('should use at least 12 characters per part', () => {
            assert.deepStrictEqual(libmime.splitMimeEncodedString('=E2=82=AC=E2=82=AC', 5), ['=E2=82=AC', '=E2=82=AC']);
            assert.deepStrictEqual(libmime.splitMimeEncodedString('', 12), []);
        });
    });

    describe('#safeEncodeURIComponent', () => {
        it('should encode the characters encodeURIComponent leaves alone', () => {
            assert.strictEqual(libmime.safeEncodeURIComponent("a b*'()"), 'a%20b%2A%27%28%29');
        });

        it('should encode non ASCII characters as UTF-8', () => {
            assert.strictEqual(libmime.safeEncodeURIComponent('\u00f5\u20ac\ud83d\ude00'), '%C3%B5%E2%82%AC%F0%9F%98%80');
        });

        it('should handle empty and non string input', () => {
            assert.strictEqual(libmime.safeEncodeURIComponent(undefined), '');
            assert.strictEqual(libmime.safeEncodeURIComponent(null), '');
            assert.strictEqual(libmime.safeEncodeURIComponent(12), '12');
        });

        it('should not throw on a lone surrogate', () => {
            assert.doesNotThrow(() => libmime.safeEncodeURIComponent('\ud83d'));
        });
    });

    describe('#encodeURICharComponent', () => {
        it('should percent encode every UTF-8 byte of a char', () => {
            assert.strictEqual(libmime.encodeURICharComponent('?'), '%3F');
            assert.strictEqual(libmime.encodeURICharComponent('\u0000'), '%00');
            assert.strictEqual(libmime.encodeURICharComponent('š'), '%C5%A1');
            assert.strictEqual(libmime.encodeURICharComponent('€'), '%E2%82%AC');
            assert.strictEqual(libmime.encodeURICharComponent('😀'), '%F0%9F%98%80');
        });
    });

    describe('#foldLines', () => {
        it('should Fold long header line', () => {
            let inputStr = 'Subject: Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla',
                outputStr =
                    'Subject: Testin command line kirja\r\n' +
                    ' =?UTF-8?Q?=C3=B5kva_kakva_m=C3=B5ni_t=C3=B5nis_k?=\r\n' +
                    ' =?UTF-8?Q?=C3=B5llas_p=C3=B5llas_t=C3=B5llas_r?=\r\n' +
                    ' =?UTF-8?Q?=C3=B5llas_ju=C5=A1la_ku=C5=A1la_tu?= =?UTF-8?Q?=C5=A1la?= musla',
                encodedHeaderLine = libmime.encodeWords(inputStr, 'Q', 52);

            assert.strictEqual(outputStr, libmime.foldLines(encodedHeaderLine, 76));
        });

        it('should Fold flowed text', () => {
            let inputStr =
                    'Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla',
                outputStr =
                    'Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas \r\n' +
                    'jušla kušla tušla musla Testin command line kirja õkva kakva mõni tõnis \r\n' +
                    'kõllas põllas tõllas rõllas jušla kušla tušla musla';

            assert.strictEqual(outputStr, libmime.foldLines(inputStr, 76, true));
        });

        it('should fold one long line', () => {
            let inputStr =
                    'Subject: =?UTF-8?Q?=CB=86=C2=B8=C3=81=C3=8C=C3=93=C4=B1=C3=8F=CB=87=C3=81=C3=9B^=C2=B8\\=C3=81=C4=B1=CB=86=C3=8C=C3=81=C3=9B=C3=98^\\=CB=9C=C3=9B=CB=9D=E2=84=A2=CB=87=C4=B1=C3=93=C2=B8^\\=CB=9C=EF=AC=81^\\=C2=B7\\=CB=9C=C3=98^=C2=A3=CB=9C#=EF=AC=81^\\=C2=A3=EF=AC=81^\\=C2=A3=EF=AC=81^\\?=',
                outputStr =
                    'Subject:\r\n =?UTF-8?Q?=CB=86=C2=B8=C3=81=C3=8C=C3=93=C4=B1=C3=8F=CB=87=C3=81=C3=9B^=C2=B8\\=C3=81=C4=B1=CB=86=C3=8C=C3=81=C3=9B=C3=98^\\=CB=9C=C3=9B=CB=9D=E2=84=A2=CB=87=C4=B1=C3=93=C2=B8^\\=CB=9C=EF=AC=81^\\=C2=B7\\=CB=9C=C3=98^=C2=A3=CB=9C#=EF=AC=81^\\=C2=A3=EF=AC=81^\\=C2=A3=EF=AC=81^\\?=';

            assert.strictEqual(outputStr, libmime.foldLines(inputStr, 76));
        });
    });

    describe('#normalizeCharset', () => {
        it('should delegate to libcharset.normalizeCharset', () => {
            assert.strictEqual(libmime.normalizeCharset('iso-8859-8-i'), 'ISO-8859-8');
            assert.strictEqual(libmime.normalizeCharset('iso-8859-8-e'), 'ISO-8859-8');
            assert.strictEqual(libmime.normalizeCharset('ISO-8859-8'), 'ISO-8859-8');
        });
    });

    describe('#splitMimeEncodedString on malformed input', () => {
        it('should not loop forever on a run of UTF-8 continuation bytes', { timeout: 5000 }, () => {
            assert.deepStrictEqual(libmime.splitMimeEncodedString('=80=80=80=80=80=80=80=80', 12), ['=80=80=80=80', '=80=80=80=80']);
        });

        it('should not loop forever on a dangling escape at the end', { timeout: 5000 }, () => {
            assert.deepStrictEqual(libmime.splitMimeEncodedString('abc=', 12), ['abc', '=']);
            assert.deepStrictEqual(libmime.splitMimeEncodedString('=', 12), ['=']);
            assert.deepStrictEqual(libmime.splitMimeEncodedString('abcdefghijk=A', 12), ['abcdefghijk', '=A']);
        });

        it('should only walk back over whole escapes', () => {
            assert.deepStrictEqual(libmime.splitMimeEncodedString('aaaaaaa=C3a=80bbbb', 12), ['aaaaaaa=C3a', '=80bbbb']);
        });

        it('should split a Q word of a Buffer that is not valid UTF-8', { timeout: 5000 }, () => {
            let encoded = libmime.encodeWord(Buffer.from([0x61, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80, 0x80]), 'Q', 20);
            assert.strictEqual(encoded, '=?UTF-8?Q?a?= =?UTF-8?Q?=80=80=80=80?= =?UTF-8?Q?=80=80=80?=');
        });
    });

    describe('#encodeWord chunking', () => {
        it('should base64 encode the chunks of a Buffer once', () => {
            let input = 'ÕÄÖÜ'.repeat(10);
            let encoded = libmime.encodeWord(Buffer.from(input), 'B', 30);
            assert.ok(encoded.split(' ').length > 1, encoded);
            assert.strictEqual(libmime.decodeWords(encoded), input);
            assert.strictEqual(encoded, libmime.encodeWord(input, 'B', 30));
        });

        it('should keep astral characters outside the emoji block whole', () => {
            let input = '\u{20000}'.repeat(10) + ' \u{1F600}';
            for (let maxLength of [13, 16, 19, 32]) {
                let encoded = libmime.encodeWord(input, 'B', maxLength);
                assert.strictEqual(libmime.decodeWords(encoded), input, String(maxLength));
                assert.ok(!libmime.decodeWords(encoded).includes('\ufffd'), String(maxLength));
            }
        });

        it('should not let an unpaired surrogate swallow the next char', () => {
            let encoded = libmime.encodeWord('a\ud800\u{1F600}b', 'B', 16);
            assert.strictEqual(libmime.decodeWords(encoded), 'a\ufffd\u{1F600}b');
        });
    });

    describe('#buildHeaderValue hardening', () => {
        it('should not let an unpaired surrogate break a parameter apart', () => {
            let built = libmime.buildHeaderValue({ value: 'attachment', params: { filename: 'ä\ud800;\ud800 name\ud800=evil.exe' } });
            assert.ok(!/[;=]\s*name|\\ud800|[\ud800-\udfff]/.test(built.replace(/^attachment; filename\*0\*=/, '')), built);
            let parsed = libmime.parseHeaderValue(built);
            assert.deepStrictEqual(Object.keys(parsed.params), ['filename']);
            assert.strictEqual(parsed.params.filename, 'ä\ufffd;\ufffd name\ufffd=evil.exe');
            assert.strictEqual(libmime.safeEncodeURIComponent('\ud800;"'), '%EF%BF%BD%3B%22');
        });

        it('should flag every continuation that holds an escape as encoded', () => {
            let list = libmime.buildHeaderParam('f', 'ä' + 'a'.repeat(80) + 'ä', 50);
            for (let item of list) {
                if (item.value.includes('%')) {
                    assert.ok(item.key.endsWith('*'), JSON.stringify(item));
                }
            }
            assert.strictEqual(libmime.parseHeaderValue('x; ' + list.map(item => item.key + '=' + item.value).join('; ')).params.f, 'ä' + 'a'.repeat(80) + 'ä');
        });

        it('should encode control chars and DEL in parameter values', () => {
            for (let value of ['a\tb.txt', 'a\nb.txt', 'a\r\nb.txt', 'a\x7fb.txt', 'A'.repeat(60) + '\n' + 'B'.repeat(60)]) {
                let built = libmime.buildHeaderValue({ value: 'attachment', params: { filename: value } });
                assert.ok(!/[\x00-\x1f\x7f]/.test(built), JSON.stringify(built));
                assert.strictEqual(libmime.parseHeaderValue(built).params.filename, value, JSON.stringify(built));
            }
        });

        it('should quote an empty parameter value', () => {
            assert.strictEqual(
                libmime.buildHeaderValue({ value: 'multipart/mixed', params: { flag: '', boundary: 'b' } }),
                'multipart/mixed; flag=""; boundary=b'
            );
        });

        it('should drop control chars from the value and the parameter names', () => {
            assert.strictEqual(
                libmime.buildHeaderValue({ value: 'text/plain\r\nX-Evil: 1', params: { 'charset\r\nX-Evil': 'utf-8' } }),
                'text/plainX-Evil: 1; charsetX-Evil=utf-8'
            );
        });

        it('should keep quoting a value with a quote mark', () => {
            assert.strictEqual(libmime.buildHeaderValue({ value: 'attachment', params: { filename: 'a "b".txt' } }), 'attachment; filename="a \\"b\\".txt"');
        });
    });

    describe('#format=flowed space stuffing', () => {
        it('should stuff the continuation lines folding starts', () => {
            let input = 'a'.repeat(68) + ' >quoted text here and more From the start';
            let encoded = libmime.encodeFlowed(input, 76);
            for (let line of encoded.split('\r\n')) {
                assert.ok(!/^(>|From)/.test(line), JSON.stringify(encoded));
            }
            assert.strictEqual(libmime.decodeFlowed(encoded), input);

            let fromLine = 'b'.repeat(72) + ' From me';
            assert.strictEqual(libmime.encodeFlowed(fromLine, 76), 'b'.repeat(72) + ' \r\n From me');
            assert.strictEqual(libmime.decodeFlowed(libmime.encodeFlowed(fromLine, 76)), fromLine);
        });

        it('should remove the stuffing of a continuation line', () => {
            assert.strictEqual(libmime.decodeFlowed('foo \r\n From bar'), 'foo From bar');
            assert.strictEqual(libmime.decodeFlowed('foo \r\n >bar'), 'foo >bar');
        });

        it('should trim spaces in front of a hard line break', () => {
            let encoded = libmime.encodeFlowed('line with trailing space \nnext', 76);
            assert.strictEqual(encoded, 'line with trailing space\r\nnext');
            assert.strictEqual(libmime.decodeFlowed(encoded), 'line with trailing space\nnext');
        });

        it('should keep the signature separator', () => {
            let encoded = libmime.encodeFlowed('text\n-- \nsignature', 76);
            assert.strictEqual(encoded, 'text\r\n-- \r\nsignature');
            assert.strictEqual(libmime.decodeFlowed(encoded), 'text\n-- \nsignature');
        });
    });

    describe('#mimetypes table', () => {
        it('should resolve the corrected entries', () => {
            assert.strictEqual(libmime.detectMimeType('x.pyc'), 'application/x-bytecode.python');
            assert.strictEqual(libmime.detectExtension('application/x-bytecode.python'), 'pyc');
            assert.strictEqual(libmime.detectMimeType('x.ccxml'), 'application/ccxml+xml');
            assert.strictEqual(libmime.detectExtension('application/ccxml+xml'), 'ccxml');
            assert.strictEqual(libmime.detectExtension('text/x-java-source,java'), 'bin');
            assert.strictEqual(libmime.detectMimeType('Main.java'), 'text/plain');
        });

        it('should resolve the added entries', () => {
            let cases: [string, string, string][] = [
                ['geojson', 'application/geo+json', 'geojson'],
                ['md', 'text/markdown', 'md'],
                ['markdown', 'text/markdown', 'md'],
                ['avif', 'image/avif', 'avif'],
                ['heic', 'image/heic', 'heic'],
                ['heif', 'image/heif', 'heif'],
                ['woff2', 'font/woff2', 'woff2'],
                ['wasm', 'application/wasm', 'wasm'],
                ['opus', 'audio/opus', 'opus'],
                ['yaml', 'application/yaml', 'yaml'],
                ['yml', 'application/yaml', 'yaml']
            ];
            for (let [extension, mimeType, reverse] of cases) {
                assert.strictEqual(libmime.detectMimeType('file.' + extension), mimeType, extension);
                assert.strictEqual(libmime.detectExtension(mimeType), reverse, mimeType);
            }
            assert.strictEqual(libmime.detectMimeType('song.m4a'), 'audio/mp4');
            assert.strictEqual(libmime.detectExtension('audio/x-m4a'), 'm4a');
            assert.strictEqual(libmime.detectMimeType('module.mjs'), 'text/javascript');
            assert.strictEqual(libmime.detectExtension('font/woff'), 'woff');
        });
    });

    describe('#charset table lookups', () => {
        it('should only resolve own string values', () => {
            for (let name of ['default', 'constructor', '__proto__', 'hasOwnProperty', 'toString']) {
                assert.strictEqual(charset.normalizeCharset(name), name.toUpperCase());
            }
        });
    });

    describe('#getCharsetName', () => {
        it('should resolve the charsets Node.js knows, ignoring case and separators', () => {
            assert.strictEqual(getCharsetName('UTF8'), 'utf8');
            assert.ok(getCharsetName('ISO-8859-2'));
            assert.strictEqual(getCharsetName('ISO-8859-2'), getCharsetName('iso_8859_2'));
            assert.strictEqual(getCharsetName(' Windows-1257 '), 'windows-1257');
            assert.strictEqual(getCharsetName('iso-8859-16'), false);
            assert.strictEqual(getCharsetName(undefined), false);
        });
    });

    describe('#decodeWord with an unknown encoding', () => {
        it('should keep the text as UTF-8', () => {
            assert.strictEqual(libmime.decodeWord('utf-8', 'X', 'abc õ'), 'abc õ');
        });
    });

    describe('#detectMimeType name match', () => {
        it('should prefer the type that matches the extension by name', () => {
            assert.strictEqual(libmime.detectMimeType('feed.xml'), 'application/xml');
            assert.strictEqual(libmime.detectMimeType('.XML'), 'application/xml');
            assert.strictEqual(libmime.detectMimeType('archive.zip'), 'application/zip');
        });
    });

    describe('#foldLines with line breaks', () => {
        it('should keep the existing line breaks', () => {
            let input = 'a'.repeat(10) + '\r\n' + 'b '.repeat(50);
            let folded = libmime.foldLines(input, 30);
            assert.ok(folded.startsWith('a'.repeat(10) + '\r\n'));
            assert.ok(
                folded.split('\r\n').every(line => line.length <= 30),
                folded
            );
        });
    });
});
