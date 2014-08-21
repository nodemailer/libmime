'use strict';

var libmime = require('../src/libmime');
var charset = require('../src/charset');

var chai = require('chai');
var expect = chai.expect;
chai.Assertion.includeStack = true;

describe('libmime', function() {

    describe('#isPlainText', function() {
        it('should detect plain text', function() {
            expect(libmime.isPlainText('abc')).to.be.true;
            expect(libmime.isPlainText('abc\x02')).to.be.false;
            expect(libmime.isPlainText('abcõ')).to.be.false;
        });
        it('should return true', function() {
            expect(libmime.isPlainText('az09\t\r\n~!?')).to.be.true;
        });

        it('should return false on low bits', function() {
            expect(libmime.isPlainText('az09\n\x08!?')).to.be.false;
        });

        it('should return false on high bits', function() {
            expect(libmime.isPlainText('az09\nõ!?')).to.be.false;
        });
    });

    describe('#hasLongerLines', function() {
        it('should detect longer lines', function() {
            expect(libmime.hasLongerLines('abc\ndef', 5)).to.be.false;
            expect(libmime.hasLongerLines('juf\nabcdef\nghi', 5)).to.be.true;
        });
    });

    describe('#encodeWord', function() {
        it('should encode', function() {
            expect('=?UTF-8?Q?See_on_=C3=B5hin_test?=').to.equal(libmime.encodeWord('See on õhin test'));
        });
    });

    describe('#encodeWords', function() {
        it('should encode Ascii range', function() {
            var input1 = 'метель" вьюга',
                input2 = 'метель\'вьюга',
                output1 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C=22_?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=',
                output2 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C\'?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=';

            expect(libmime.encodeWords(input1, 'Q', 52)).to.equal(output1);
            expect(libmime.encodeWords(input2, 'Q', 52)).to.equal(output2);
        });
    });

    describe('#decodeWords', function() {
        it('should decode', function() {
            expect('Hello: See on õhin test').to.equal(libmime.decodeWords('Hello: =?UTF-8?q?See_on_=C3=B5hin_test?='));
            expect('See on õhin test').to.equal(libmime.decodeWord('=?UTF-8?q?See_on_=C3=B5hin_test?='));
        });

        it('should decode mime words', function() {
            expect('Jõge-vaŽ zz Jõge-vaŽJõge-vaŽJõge-vaŽ').to.equal(libmime.decodeWords('=?ISO-8859-13?Q?J=F5ge-va=DE?= zz =?ISO-8859-13?Q?J=F5ge-va=DE?= =?ISO-8859-13?Q?J=F5ge-va=DE?= =?ISO-8859-13?Q?J=F5ge-va=DE?='));
            expect('Sssś Lałalalala').to.equal(libmime.decodeWords('=?UTF-8?B?U3NzxZsgTGHFgmFsYQ==?= =?UTF-8?B?bGFsYQ==?='));
        });

        it('should decode QP-encoded mime word', function() {
            expect('Jõge-vaŽ').to.equal(libmime.decodeWord('=?ISO-8859-13?Q?J=F5ge-va=DE?='));
        });

        it('should decode ascii range', function() {
            var input1 = 'метель" вьюга',
                input2 = 'метель\'вьюга',
                output1 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C=22_?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=',
                output2 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C\'?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=';

            expect(libmime.decodeWords(output1)).to.equal(input1);
            expect(libmime.decodeWords(output2)).to.equal(input2);
        });

        it('should split QP on maxLength', function() {
            var inputStr = 'Jõgeva Jõgeva Jõgeva mugeva Jõgeva Jõgeva Jõgeva Jõgeva Jõgeva',
                outputStr = '=?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva?= mugeva ' +
                '=?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva_?= ' +
                '=?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva?=',
                encoded = libmime.encodeWords(inputStr, 'Q', 16);

            expect(outputStr).to.equal(encoded);
            expect(inputStr).to.equal(libmime.decodeWords(encoded));
        });

        it('should split base64 on maxLength', function() {
            var inputStr = 'Jõgeva Jõgeva Jõgeva mugeva Jõgeva Jõgeva Jõgeva Jõgeva Jõgeva',
                outputStr = '=?UTF-8?B?SsO1Zw==?= =?UTF-8?B?ZXZh?= =?UTF-8?B?IErDtQ==?= =?UTF-8?B?Z2V2?= =?UTF-8?B?YSBK?= =?UTF-8?B?w7VnZQ==?= =?UTF-8?B?dmE=?= mugeva =?UTF-8?B?SsO1Zw==?= =?UTF-8?B?ZXZh?= =?UTF-8?B?IErDtQ==?= =?UTF-8?B?Z2V2?= =?UTF-8?B?YSBK?= =?UTF-8?B?w7VnZQ==?= =?UTF-8?B?dmEg?= =?UTF-8?B?SsO1Zw==?= =?UTF-8?B?ZXZh?= =?UTF-8?B?IErDtQ==?= =?UTF-8?B?Z2V2?= =?UTF-8?B?YQ==?=',
                encoded = libmime.encodeWords(inputStr, 'B', 19);

            expect(outputStr).to.equal(encoded);
            expect(inputStr).to.equal(libmime.decodeWords(encoded));
        });

        it('should ignore language param', function() {
            expect('Hello: See on õhin test').to.equal(libmime.decodeWords('Hello: =?UTF-8*EN?q?See_on_=C3=B5hin_test?='));
        });
    });

    describe('#buildHeaderParam', function() {
        it('should return unmodified', function() {
            expect([{
                key: 'title',
                value: 'this is just a title'
            }]).to.deep.equal(libmime.buildHeaderParam('title', 'this is just a title', 500));
        });

        it('should encode and split ascii', function() {
            expect([{
                key: 'title*0',
                value: 'this '
            }, {
                key: 'title*1',
                value: 'is ju'
            }, {
                key: 'title*2',
                value: 'st a '
            }, {
                key: 'title*3',
                value: 'title'
            }]).to.deep.equal(libmime.buildHeaderParam('title', 'this is just a title', 5));
        });

        it('should encode and split unicode', function() {
            expect([{
                key: 'title*0*',
                value: 'utf-8\'\'this%20is%20'
            }, {
                key: 'title*1',
                value: 'just a title '
            }, {
                key: 'title*2*',
                value: '%C3%B5%C3%A4%C3%B6'
            }, {
                key: 'title*3*',
                value: '%C3%BC'
            }]).to.deep.equal(libmime.buildHeaderParam('title', 'this is just a title õäöü', 20));
        });

        it('should encode and decode', function() {
            var input = 'Lorěm ipsum doloř siť amet, háš peřpetua compřéhenšam at, ei nám modó soleát éxpétěndá! Boňorum vocibůs dignisšim pro ad, ea sensibus efficiendi intellegam ius. Ad nam aperiam delicata voluptaria, vix nobis luptatum ea, ců úsú graeco viďiššě ňusqúam. ';
            var headerLine = 'content-disposition: attachment; ' + libmime.buildHeaderParam('filename', input, 50).map(function(item) {
                return item.key + '="' + item.value + '"';
            }).join('; ');
            var parsedHeader = libmime.parseHeaderValue(headerLine);
            expect(input).to.equal(libmime.decodeWords(parsedHeader.params.filename));
        });
    });

    describe('#decodeHeaders', function() {
        it('should decode headers', function() {
            var headersObj = {
                    'subject': ['Tere =?UTF-8?Q?J=C3=B5geva?='],
                    'x-app': ['My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 1', 'My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 2'],
                    'long-line': ['tere =?UTF-8?Q?=C3=B5klva?= karu =?UTF-8?Q?m=C3=B5kva_=C5=A1apaka=C5=A1?= tutikas suur maja, =?UTF-8?Q?k=C3=B5rge?= hoone, segane jutt']
                },
                headersStr = 'Subject: Tere =?UTF-8?Q?J=C3=B5geva?=\r\n' +
                'X-APP: My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 1\r\n' +
                'X-APP: My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 2\r\n' +
                'Long-Line: tere =?UTF-8?Q?=C3=B5klva?= karu\r\n' +
                ' =?UTF-8?Q?m=C3=B5kva_=C5=A1apaka=C5=A1?= tutikas suur maja,\r\n' +
                ' =?UTF-8?Q?k=C3=B5rge?= hoone, segane jutt';

            expect(headersObj).to.deep.equal(libmime.decodeHeaders(headersStr));
        });
    });

    describe('#parseHeaderValue', function() {
        it('should handle default value only', function() {
            var str = 'text/plain',
                obj = {
                    value: 'text/plain',
                    params: {}
                };

            expect(libmime.parseHeaderValue(str)).to.deep.equal(obj);
        });

        it('should handle unquoted params', function() {
            var str = 'text/plain; CHARSET= UTF-8; format=flowed;',
                obj = {
                    value: 'text/plain',
                    params: {
                        'charset': 'UTF-8',
                        'format': 'flowed'
                    }
                };

            expect(libmime.parseHeaderValue(str)).to.deep.equal(obj);
        });

        it('should handle quoted params', function() {
            var str = 'text/plain; filename= ";;;\\\""; format=flowed;',
                obj = {
                    value: 'text/plain',
                    params: {
                        'filename': ';;;"',
                        'format': 'flowed'
                    }
                };

            expect(libmime.parseHeaderValue(str)).to.deep.equal(obj);
        });

        it('should handle multi line values', function() {
            var str = 'text/plain; single_encoded*="UTF-8\'\'%C3%95%C3%84%C3%96%C3%9C";\n' +
                ' multi_encoded*0*=UTF-8\'\'%C3%96%C3%9C;\n' +
                ' multi_encoded*1*=%C3%95%C3%84;\n' +
                ' no_charset*0=OA;\n' +
                ' no_charset*1=OU;\n' +
                ' invalid*=utf-8\'\' _?\'=%ab',
                obj = {
                    value: 'text/plain',
                    params: {
                        'single_encoded': '=?UTF-8?Q?=C3=95=C3=84=C3=96=C3=9C?=',
                        'multi_encoded': '=?UTF-8?Q?=C3=96=C3=9C=C3=95=C3=84?=',
                        'no_charset': 'OAOU',
                        'invalid': '=?utf-8?Q?_=5f=3f\'=3d=ab?='
                    }
                };

            expect(libmime.parseHeaderValue(str)).to.deep.equal(obj);
        });
    });

    describe('#_buildHeaderValue', function() {
        it('should build header value', function() {
            expect(libmime.buildHeaderValue({
                value: 'test'
            })).to.equal('test');
            expect(libmime.buildHeaderValue({
                value: 'test',
                params: {
                    a: 'b'
                }
            })).to.equal('test; a=b');
            expect(libmime.buildHeaderValue({
                value: 'test',
                params: {
                    a: ';'
                }
            })).to.equal('test; a=";"');
            expect(libmime.buildHeaderValue({
                value: 'test',
                params: {
                    a: ';"'
                }
            })).to.equal('test; a=";\\""');
            expect(libmime.buildHeaderValue({
                value: 'test',
                params: {
                    a: 'b',
                    c: 'd'
                }
            })).to.equal('test; a=b; c=d');
        });

        it('should split unicode filename', function() {
            expect(libmime.buildHeaderValue({
                value: 'test',
                params: {
                    a: 'b',
                    filename: 'Jõge-vaŽJõge-vaŽJõge-vaŽ.pdf'
                }
            })).to.equal('test; a=b; filename*0*="utf-8\'\'J%C3%B5ge-va%C5%BDJ%C3%B5ge-va%C5%BDJ"; filename*1*="%C3%B5ge-va%C5%BD.pdf"');
        });

        it('should quote filename with spaces', function() {
            expect(libmime.buildHeaderValue({
                value: 'test',
                params: {
                    filename: 'document a.pdf'
                }
            })).to.equal('test; filename="document a.pdf"');
        });
    });

    describe('#encodeFlowed', function() {
        it('should wrap flowed text', function() {
            var str = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere\r\nFrom\r\n Hello\r\n> abc\r\nabc',
                folded = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere \r\n' +
                'tere tere tere tere tere\r\n' +
                ' From\r\n' +
                '  Hello\r\n' +
                ' > abc\r\n' +
                'abc';
            expect(libmime.encodeFlowed(str)).to.equal(folded);
        });
    });

    describe('#decodeFlowed', function() {
        it('should remove soft line breaks', function() {
            var str = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere\nFrom\n Hello\n> abc\nabc',
                folded = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere \r\n' +
                'tere tere tere tere tere\r\n' +
                ' From\r\n' +
                '  Hello\r\n' +
                ' > abc\r\n' +
                'abc';
            expect(libmime.decodeFlowed(folded)).to.equal(str);
        });

        it('should remove soft line breaks and spacing', function() {
            var str = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere teretere tere tere tere tere\nFrom\n Hello\n> abc\nabc',
                folded = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere \r\n' +
                'tere tere tere tere tere\r\n' +
                ' From\r\n' +
                '  Hello\r\n' +
                ' > abc\r\n' +
                'abc';
            expect(libmime.decodeFlowed(folded, true)).to.equal(str);
        });
    });

    describe('#charset', function() {
        describe('#encode', function() {
            it('should encode UTF-8 to Buffer', function() {
                var str = '신',
                    encoded = new Buffer([0xEC, 0x8B, 0xA0]);

                expect(encoded).to.deep.equal(charset.encode(str));
            });
        });

        describe('#decode', function() {
            it('should decode UTF-8 to Buffer', function() {
                var str = '신',
                    encoded = new Buffer([0xEC, 0x8B, 0xA0]);

                expect(str).to.deep.equal(charset.decode(encoded));
            });

            it('should decode non UTF-8 Buffer', function() {
                var str = '신',
                    encoding = 'ks_c_5601-1987',
                    encoded = new Buffer([0xBD, 0xC5]);

                expect(str).to.deep.equal(charset.decode(encoded, encoding));
            });
        });

        describe('#convert', function() {
            it('should convert non UTF-8 to Buffer', function() {
                var converted = new Buffer([0xEC, 0x8B, 0xA0]),
                    encoding = 'ks_c_5601-1987',
                    encoded = new Buffer([0xBD, 0xC5]);

                expect(converted).to.deep.equal(charset.convert(encoded, encoding));
            });
        });
    });

    describe('mimetypes', function() {
        describe('#detectExtension', function() {
            it('should find exact match', function() {
                var extension = 'doc',
                    contentType = 'application/msword';

                expect(libmime.detectExtension(contentType)).to.equal(extension);
            });

            it('should find best match', function() {
                var extension = 'jpeg',
                    contentType = 'image/jpeg';

                expect(libmime.detectExtension(contentType)).to.equal(extension);
            });

            it('should find default match', function() {
                var extension = 'bin',
                    contentType = 'sugri/mugri';

                expect(libmime.detectExtension(contentType)).to.equal(extension);

                contentType = 'application/octet-stream';

                expect(libmime.detectExtension(contentType)).to.equal(extension);
            });
        });

        describe('#detectMimeType', function() {
            it('should find exact match', function() {
                var extension = 'doc',
                    contentType = 'application/msword';

                expect(libmime.detectMimeType(extension)).to.equal(contentType);
            });

            it('should find best match', function() {
                var extension = 'index.js',
                    contentType = 'application/javascript';

                expect(libmime.detectMimeType(extension)).to.equal(contentType);
            });
        });
    });

    describe('#foldLines', function() {
        it('should Fold long header line', function() {
            var inputStr = 'Subject: Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla',
                outputStr = 'Subject: Testin command line kirja =?UTF-8?Q?=C3=B5kva?= kakva\r\n' +
                ' =?UTF-8?Q?m=C3=B5ni_t=C3=B5nis_k=C3=B5llas_p=C3=B5?=\r\n' +
                ' =?UTF-8?Q?llas_t=C3=B5llas_r=C3=B5llas_ju=C5=A1la_?=\r\n' +
                ' =?UTF-8?Q?ku=C5=A1la_tu=C5=A1la?= musla',
                encodedHeaderLine = libmime.encodeWords(inputStr, 'Q', 52);

            expect(outputStr).to.equal(libmime.foldLines(encodedHeaderLine, 76));
        });

        it('should Fold flowed text', function() {
            var inputStr = 'Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla',
                outputStr = 'Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas \r\n' +
                'jušla kušla tušla musla Testin command line kirja õkva kakva mõni tõnis \r\n' +
                'kõllas põllas tõllas rõllas jušla kušla tušla musla';

            expect(outputStr).to.equal(libmime.foldLines(inputStr, 76, true));
        });

        it('should fold one long line', function() {
            var inputStr = 'Subject: =?UTF-8?Q?=CB=86=C2=B8=C3=81=C3=8C=C3=93=C4=B1=C3=8F=CB=87=C3=81=C3=9B^=C2=B8\\=C3=81=C4=B1=CB=86=C3=8C=C3=81=C3=9B=C3=98^\\=CB=9C=C3=9B=CB=9D=E2=84=A2=CB=87=C4=B1=C3=93=C2=B8^\\=CB=9C=EF=AC=81^\\=C2=B7\\=CB=9C=C3=98^=C2=A3=CB=9C#=EF=AC=81^\\=C2=A3=EF=AC=81^\\=C2=A3=EF=AC=81^\\?=',
                outputStr = 'Subject:\r\n =?UTF-8?Q?=CB=86=C2=B8=C3=81=C3=8C=C3=93=C4=B1=C3=8F=CB=87=C3=81=C3=9B^=C2=B8\\=C3=81=C4=B1=CB=86=C3=8C=C3=81=C3=9B=C3=98^\\=CB=9C=C3=9B=CB=9D=E2=84=A2=CB=87=C4=B1=C3=93=C2=B8^\\=CB=9C=EF=AC=81^\\=C2=B7\\=CB=9C=C3=98^=C2=A3=CB=9C#=EF=AC=81^\\=C2=A3=EF=AC=81^\\=C2=A3=EF=AC=81^\\?=';

            expect(outputStr).to.equal(libmime.foldLines(inputStr, 76));
        });
    });
});