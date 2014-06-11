'use strict';

var libmime = require('../src/libmime');
var base64 = require('../src/base64');
var charset = require('../src/charset');

var chai = require('chai');
var expect = chai.expect;
chai.Assertion.includeStack = true;

describe('libmime', function() {
    describe('#mimeEncode', function() {
        it('shoud encode UTF-8', function() {
            var str = 'tere ÕÄÖÕ',
                encodedStr = 'tere =C3=95=C3=84=C3=96=C3=95';

            expect(libmime.mimeEncode(str)).to.equal(encodedStr);
        });

        it('shoud encode non UTF-8', function() {
            var buf = new Buffer([0xBD, 0xC5]),
                encoding = 'ks_c_5601-1987',
                encodedStr = '=EC=8B=A0';

            expect(libmime.mimeEncode(buf, encoding)).to.equal(encodedStr);
        });
    });

    describe('#mimeDecode', function() {
        it('should decode UTF-8', function() {
            var str = 'tere ÕÄÖÕ',
                encodedStr = 'tere =C3=95=C3=84=C3=96=C3=95';

            expect(libmime.mimeDecode(encodedStr)).to.equal(str);
        });

        it('should decode non UTF-8', function() {
            var str = '신',
                encoding = 'ks_c_5601-1987',
                encodedStr = '=BD=C5';

            expect(libmime.mimeDecode(encodedStr, encoding)).to.equal(str);
        });

    });

    describe('#base64Encode', function() {
        it('should base64Encode UTF-8', function() {
            var str = 'tere ÕÄÖÕ',
                encodedStr = 'dGVyZSDDlcOEw5bDlQ==';

            expect(libmime.base64Encode(str)).to.equal(encodedStr);
        });

        it('should base64Encode non UTF-8', function() {
            var buf = new Buffer([0xBD, 0xC5]),
                encoding = 'ks_c_5601-1987',
                encodedStr = '7Iug';

            expect(libmime.base64Encode(buf, encoding)).to.equal(encodedStr);
        });
    });

    describe('#base64Decode', function() {
        it('should decode UTF-8', function() {
            var str = 'tere ÕÄÖÕ',
                encodedStr = 'dGVyZSDDlcOEw5bDlQ==';

            expect(libmime.base64Decode(encodedStr)).to.equal(str);
        });

        it('should decode non UTF-8', function() {
            var str = '신',
                encoding = 'ks_c_5601-1987',
                encodedStr = 'vcU=';

            expect(libmime.base64Decode(encodedStr, encoding)).to.equal(str);
        });
    });

    describe('#quotedPrintableEncode', function() {
        it('should encode UTF-8 to quoted-printable', function() {
            var str = 'tere ÕÄ \t\nÕÄ \t\nÖÕ',
                encodedStr = 'tere =C3=95=C3=84=20=09\r\n=C3=95=C3=84=20=09\r\n=C3=96=C3=95';

            expect(libmime.quotedPrintableEncode(str)).to.equal(encodedStr);
        });

        it('should encode short string', function() {
            expect('Tere =C3=95=C3=84=C3=96=C3=9C!').to.equal(libmime.quotedPrintableEncode(new Buffer([0x54, 0x65, 0x72, 0x65, 0x20, 0xD5, 0xC4, 0xD6, 0xDC, 0x21]), 'Latin_1'));
            expect('Tere =C3=95=C3=84=C3=96=C3=9C=C5=A0=C5=BD!').to.equal(libmime.quotedPrintableEncode('Tere ÕÄÖÜŠŽ!'));
            expect('Tere =C5=A0=C5=BD!').to.equal(libmime.quotedPrintableEncode(new Buffer([0x54, 0x65, 0x72, 0x65, 0x20, 0xD0, 0xDE, 0x21]), 'Win-1257'));
        });

        it('should encode surrogate pair', function() {
            // pile of poo :)
            expect('=F0=9F=92=A9').to.equal(libmime.quotedPrintableEncode('\ud83d\udca9'));
        });
    });

    describe('#quotedPrintableDecode', function() {
        it('should decode quoted-printable to UTF-8', function() {
            var str = 'tere ÕÄ \t\r\nÕÄ \t\r\nÖÕ',
                encodedStr = 'tere =C3=95=C3=84=20=09\r\n=C3=95=\r\n=C3=84=\r\n=20=09\r\n=C3=96=C3=95=';

            expect(libmime.quotedPrintableDecode(encodedStr)).to.equal(str);
        });

        it('should decode string', function() {
            var longLine = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
                'ABCDEFGHIÄÄÄPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
                'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789' +
                'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789',
                longLineEncoded = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHI=\r\n' +
                '=C3=84=C3=84=C3=84PQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ=\r\n' +
                'KLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVW=\r\n' +
                'XYZabcdefghijklmnopqrstuvwxyz0123456789';

            expect(longLine).to.equal(libmime.quotedPrintableDecode(longLineEncoded));
        });

        it('should decode string with soft linebreaks', function() {
            var input = 'Tere =\r\nvana kere=',
                output = 'Tere vana kere';

            expect(output).to.equal(libmime.quotedPrintableDecode(input));
        });

        it('should decode surrogate pair', function() {
            // pile of poo :)
            expect('\ud83d\udca9').to.equal(libmime.quotedPrintableDecode('=F0=9F=92=A9'));
        });
    });

    describe('#mimeWordEncode', function() {
        it('should encode', function() {
            expect('=?UTF-8?Q?See_on_=C3=B5hin_test?=').to.equal(libmime.mimeWordEncode('See on õhin test'));
        });

        it('should QP-encode mime word', function() {
            expect('=?UTF-8?Q?J=C3=B5ge-va=C5=BD?=').to.equal(libmime.mimeWordEncode(new Buffer([0x4A, 0xF5, 0x67, 0x65, 0x2D, 0x76, 0x61, 0xDE]), 'Q', 'iso-8859-13'));
        });
    });

    describe('#mimeWordsEncode', function() {
        it('should encode Ascii range', function() {
            var input1 = 'метель" вьюга',
                input2 = 'метель\'вьюга',
                output1 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C=22_?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=',
                output2 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C\'?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=';

            expect(libmime.mimeWordsEncode(input1, 'Q', 52)).to.equal(output1);
            expect(libmime.mimeWordsEncode(input2, 'Q', 52)).to.equal(output2);
        });
    });

    describe('#mimeWordsDecode', function() {
        it('should decode', function() {
            expect('Hello: See on õhin test').to.equal(libmime.mimeWordsDecode('Hello: =?UTF-8?q?See_on_=C3=B5hin_test?='));
            expect('See on õhin test').to.equal(libmime.mimeWordDecode('=?UTF-8?q?See_on_=C3=B5hin_test?='));
        });

        it('should decode mime words', function() {
            expect('Jõge-vaŽ zz Jõge-vaŽJõge-vaŽJõge-vaŽ').to.equal(libmime.mimeWordsDecode('=?ISO-8859-13?Q?J=F5ge-va=DE?= zz =?ISO-8859-13?Q?J=F5ge-va=DE?= =?ISO-8859-13?Q?J=F5ge-va=DE?= =?ISO-8859-13?Q?J=F5ge-va=DE?='));
            expect('Sssś Lałalalala').to.equal(libmime.mimeWordsDecode('=?UTF-8?B?U3NzxZsgTGHFgmFsYQ==?= =?UTF-8?B?bGFsYQ==?='));
        });

        it('should decode QP-encoded mime word', function() {
            expect('Jõge-vaŽ').to.equal(libmime.mimeWordDecode('=?ISO-8859-13?Q?J=F5ge-va=DE?='));
        });

        it('should decode ascii range', function() {
            var input1 = 'метель" вьюга',
                input2 = 'метель\'вьюга',
                output1 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C=22_?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=',
                output2 = '=?UTF-8?Q?=D0=BC=D0=B5=D1=82=D0=B5=D0=BB=D1=8C\'?= =?UTF-8?Q?=D0=B2=D1=8C=D1=8E=D0=B3=D0=B0?=';

            expect(libmime.mimeWordsDecode(output1)).to.equal(input1);
            expect(libmime.mimeWordsDecode(output2)).to.equal(input2);
        });

        it('should split QP on maxLength', function() {
            var inputStr = 'Jõgeva Jõgeva Jõgeva mugeva Jõgeva Jõgeva Jõgeva Jõgeva Jõgeva',
                outputStr = '=?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva?= mugeva ' +
                '=?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva_?= ' +
                '=?UTF-8?Q?J=C3=B5geva_?= =?UTF-8?Q?J=C3=B5geva?=',
                encoded = libmime.mimeWordsEncode(inputStr, 'Q', 16);

            expect(outputStr).to.equal(encoded);
            expect(inputStr).to.equal(libmime.mimeWordsDecode(encoded));
        });

        it('should split base64 on maxLength', function() {
            var inputStr = 'Jõgeva Jõgeva Jõgeva mugeva Jõgeva Jõgeva Jõgeva Jõgeva Jõgeva',
                outputStr = '=?UTF-8?B?SsO1Zw==?= =?UTF-8?B?ZXZh?= =?UTF-8?B?IErDtQ==?= =?UTF-8?B?Z2V2?= ' +
                '=?UTF-8?B?YSBK?= =?UTF-8?B?w7VnZQ==?= =?UTF-8?B?dmE=?= mugeva =?UTF-8?B?SsO1Zw==?= ' +
                '=?UTF-8?B?ZXZh?= =?UTF-8?B?IErDtQ==?= =?UTF-8?B?Z2V2?= =?UTF-8?B?YSBK?= ' +
                '=?UTF-8?B?w7VnZQ==?= =?UTF-8?B?dmEg?= =?UTF-8?B?SsO1Zw==?= =?UTF-8?B?ZXZh?= ' +
                '=?UTF-8?B?IErDtQ==?= =?UTF-8?B?Z2V2?= =?UTF-8?B?YQ==?=',
                encoded = libmime.mimeWordsEncode(inputStr, 'B', 19);

            expect(outputStr).to.equal(encoded);
            expect(inputStr).to.equal(libmime.mimeWordsDecode(encoded));
        });

        it('should ignore language param', function() {
            expect('Hello: See on õhin test').to.equal(libmime.mimeWordsDecode('Hello: =?UTF-8*EN?q?See_on_=C3=B5hin_test?='));
        });
    });

    describe('#continuationEncode', function() {
        it('should return unmodified', function() {
            expect([{
                key: 'title',
                value: 'this is just a title'
            }]).to.deep.equal(libmime.continuationEncode('title', 'this is just a title', 500));
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
            }]).to.deep.equal(libmime.continuationEncode('title', 'this is just a title', 5));
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
            }]).to.deep.equal(libmime.continuationEncode('title', 'this is just a title õäöü', 20));
        });

        it('should encode and decode', function() {
            var input = 'Lorěm ipsum doloř siť amet, háš peřpetua compřéhenšam at, ei nám modó soleát éxpétěndá! Boňorum vocibůs dignisšim pro ad, ea sensibus efficiendi intellegam ius. Ad nam aperiam delicata voluptaria, vix nobis luptatum ea, ců úsú graeco viďiššě ňusqúam. ';
            var headerLine = 'content-disposition: attachment; ' + libmime.continuationEncode('filename', input, 50).map(function(item) {
                return item.key + '="' + item.value + '"';
            }).join('; ');
            var parsedHeader = libmime.parseStructuredHeaderValue(headerLine);
            expect(input).to.equal(libmime.mimeWordsDecode(parsedHeader.params.filename));
        });
    });

    describe('#foldLines', function() {
        it('should Fold long header line', function() {
            var inputStr = 'Subject: Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla',
                outputStr = 'Subject: Testin command line kirja =?UTF-8?Q?=C3=B5kva?= kakva\r\n' +
                ' =?UTF-8?Q?m=C3=B5ni_t=C3=B5nis_k=C3=B5llas_p=C3=B5?=\r\n' +
                ' =?UTF-8?Q?llas_t=C3=B5llas_r=C3=B5llas_ju=C5=A1la_?=\r\n' +
                ' =?UTF-8?Q?ku=C5=A1la_tu=C5=A1la?= musla',
                encodedHeaderLine = libmime.mimeWordsEncode(inputStr, 'Q', 52);

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

    describe('#headerLineEncode', function() {
        it('should encode and fold header line', function() {
            var key = 'Subject',
                value = 'Testin command line kirja õkva kakva mõni tõnis kõllas põllas tõllas rõllas jušla kušla tušla musla',
                outputStr = 'Subject: Testin command line kirja =?UTF-8?Q?=C3=B5kva?= kakva\r\n' +
                ' =?UTF-8?Q?m=C3=B5ni_t=C3=B5nis_k=C3=B5llas_p=C3=B5?=\r\n' +
                ' =?UTF-8?Q?llas_t=C3=B5llas_r=C3=B5llas_ju=C5=A1la_?=\r\n' +
                ' =?UTF-8?Q?ku=C5=A1la_tu=C5=A1la?= musla',
                encodedHeaderLine = libmime.headerLineEncode(key, value);

            expect(outputStr).to.equal(encodedHeaderLine);
        });
    });

    describe('#headerLinesDecode', function() {
        it('should decode headers', function() {
            var headersObj = {
                    'subject': 'Tere =?UTF-8?Q?J=C3=B5geva?=',
                    'x-app': ['My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 1', 'My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 2'],
                    'long-line': 'tere =?UTF-8?Q?=C3=B5klva?= karu =?UTF-8?Q?m=C3=B5kva_=C5=A1apaka=C5=A1?= tutikas suur maja, =?UTF-8?Q?k=C3=B5rge?= hoone, segane jutt'
                },
                headersStr = 'Subject: Tere =?UTF-8?Q?J=C3=B5geva?=\r\n' +
                'X-APP: My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 1\r\n' +
                'X-APP: My =?UTF-8?Q?=C5=A1=C5=A1=C5=A1=C5=A1?= app line 2\r\n' +
                'Long-Line: tere =?UTF-8?Q?=C3=B5klva?= karu\r\n' +
                ' =?UTF-8?Q?m=C3=B5kva_=C5=A1apaka=C5=A1?= tutikas suur maja,\r\n' +
                ' =?UTF-8?Q?k=C3=B5rge?= hoone, segane jutt';

            expect(headersObj).to.deep.equal(libmime.headerLinesDecode(headersStr));
        });
    });

    describe('#parseStructuredHeaderValue', function() {
        it('should handle default value only', function() {
            var str = 'text/plain',
                obj = {
                    value: 'text/plain',
                    params: {}
                };

            expect(libmime.parseStructuredHeaderValue(str)).to.deep.equal(obj);
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

            expect(libmime.parseStructuredHeaderValue(str)).to.deep.equal(obj);
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

            expect(libmime.parseStructuredHeaderValue(str)).to.deep.equal(obj);
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

            expect(libmime.parseStructuredHeaderValue(str)).to.deep.equal(obj);
        });
    });

    describe('#_buildHeaderValue', function() {
        it('should build header value', function() {
            expect(libmime.buildStructuredHeaderValue({
                value: 'test'
            })).to.equal('test');
            expect(libmime.buildStructuredHeaderValue({
                value: 'test',
                params: {
                    a: 'b'
                }
            })).to.equal('test; a=b');
            expect(libmime.buildStructuredHeaderValue({
                value: 'test',
                params: {
                    a: ';'
                }
            })).to.equal('test; a=";"');
            expect(libmime.buildStructuredHeaderValue({
                value: 'test',
                params: {
                    a: ';"'
                }
            })).to.equal('test; a=";\\""');
            expect(libmime.buildStructuredHeaderValue({
                value: 'test',
                params: {
                    a: 'b',
                    c: 'd'
                }
            })).to.equal('test; a=b; c=d');
        });

        it('should split unicode filename', function() {
            expect(libmime.buildStructuredHeaderValue({
                value: 'test',
                params: {
                    a: 'b',
                    filename: 'Jõge-vaŽJõge-vaŽJõge-vaŽ.pdf'
                }
            })).to.equal('test; a=b; filename*0*="utf-8\'\'J%C3%B5ge-va%C5%BDJ%C3%B5ge-va%C5%BDJ"; filename*1*="%C3%B5ge-va%C5%BD.pdf"');
        });
    });

    describe('#addSoftLinebreaks', function() {
        it('should add soft line breaks', function() {
            var str = '=C3=B5=C3=A4=C3=B6=C3=BC=C3=B5=C3=A4=C3=B6=C3=BC=C3=B5=C3=A4=C3=B6=C3=BC' +
                '=C3=B5=C3=A4=C3=B6=C3=BC=C3=B5=C3=A4=C3=B6=C3=BC=C3=B5=C3=A4=C3=B6=C3=BC' +
                '=C3=B5=C3=A4=C3=B6=C3=B5',
                folded = '=C3=B5=C3=A4=C3=B6=C3=BC=C3=B5=C3=A4=C3=B6=C3=BC=C3=B5=C3=A4=C3=B6=C3=BC=\r\n' +
                '=C3=B5=C3=A4=C3=B6=C3=BC=C3=B5=C3=A4=C3=B6=C3=BC=C3=B5=C3=A4=C3=B6=C3=BC=\r\n' +
                '=C3=B5=C3=A4=C3=B6=C3=B5';

            expect(libmime.addSoftLinebreaks(str, 'q')).to.equal(folded);
        });

        it('should not wrap between encoded chars', function() {
            var str = 'a=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F',
                folded = 'a=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=5F=\r\n=5F=5F';

            expect(libmime.addSoftLinebreaks(str, 'q')).to.equal(folded);
        });

        it('should encode long string', function() {
            var str = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM' +
                'NOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
                'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm' +
                'nopqrstuvwxyz0123456789',
                folded = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLM=\r\n' +
                'NOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ=\r\n' +
                'abcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklm=\r\n' +
                'nopqrstuvwxyz0123456789';

            expect(libmime.addSoftLinebreaks(str, 'q')).to.equal(folded);
        });

        it('should quote at line edge', function() {
            var str = 'Title: <a href=3D=22http://www.elezea.com/2012/09/iphone-5-local-maximum/=22>The future of e-commerce is storytelling</a> <br>',
                folded = 'Title: <a href=3D=22http://www.elezea.com/2012/09/iphone-5-local-maximum/=\r\n=22>The future of e-commerce is storytelling</a> =\r\n<br>';
            expect(libmime.addSoftLinebreaks(str, 'q')).to.equal(folded);
        });

        it('should wrap long string with UTF-8 sequence on edge', function() {
            var str = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHI' +
                '=C3=84=C3=84=C3=84PQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ' +
                'KLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVW' +
                'XYZabcdefghijklmnopqrstuvwxyz0123456789',
                folded = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHI=\r\n' +
                '=C3=84=C3=84=C3=84PQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJ=\r\n' +
                'KLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVW=\r\n' +
                'XYZabcdefghijklmnopqrstuvwxyz0123456789';
            expect(libmime.addSoftLinebreaks(str, 'q')).to.equal(folded);
        });

        it('should wrap long base64 string to fixed line length', function() {
            var str = 'LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t' +
                'LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t' +
                'LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t' +
                'LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t' +
                'LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t' +
                'LS0tLS0tLS0tLS0tLS0=',
                folded = 'LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t\r\n' +
                'LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t\r\n' +
                'LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t\r\n' +
                'LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t\r\n' +
                'LS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0t\r\n' +
                'LS0tLS0tLS0tLS0tLS0=';
            expect(libmime.addSoftLinebreaks(str, 'b')).to.equal(folded);
        });

        it('should wrap flowed text', function() {
            var str = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere\r\nFrom\r\n Hello\r\n> abc\r\nabc',
                folded = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere \r\n' +
                'tere tere tere tere tere\r\n' +
                ' From\r\n' +
                '  Hello\r\n' +
                ' > abc\r\n' +
                'abc';
            expect(libmime.addSoftLinebreaks(str, 'f')).to.equal(folded);
        });

    });

    describe('#flowedDecode', function() {
        it('should remove soft line breaks', function() {
            var str = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere\nFrom\n Hello\n> abc\nabc',
                folded = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere \r\n' +
                'tere tere tere tere tere\r\n' +
                ' From\r\n' +
                '  Hello\r\n' +
                ' > abc\r\n' +
                'abc';
            expect(libmime.flowedDecode(folded)).to.equal(str);
        });

        it('should remove soft line breaks and spacing', function() {
            var str = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere teretere tere tere tere tere\nFrom\n Hello\n> abc\nabc',
                folded = 'tere tere tere tere tere tere tere tere tere tere tere tere tere tere tere \r\n' +
                'tere tere tere tere tere\r\n' +
                ' From\r\n' +
                '  Hello\r\n' +
                ' > abc\r\n' +
                'abc';
            expect(libmime.flowedDecode(folded, true)).to.equal(str);
        });
    });

    describe('#base64', function() {
        describe('#encode', function() {
            it('should convert UTF-8 string to base64', function() {
                var str = 'abc123ÕÄÖÜŠŽ신',
                    b64 = 'YWJjMTIzw5XDhMOWw5zFoMW97Iug';

                expect(b64).to.equal(base64.encode(str));
            });

            it('should convert Buffer to Base64', function() {
                var buf = new Buffer([0x61, 0x62, 0x63, 0x31, 0x32, 0x33, 0xc3, 0x95, 0xc3, 0x84, 0xc3, 0x96, 0xc3, 0x9c, 0xc5, 0xa0, 0xc5, 0xbd, 0xec, 0x8b, 0xa0]),
                    b64 = 'YWJjMTIzw5XDhMOWw5zFoMW97Iug';
                expect(b64).to.equal(base64.encode(buf));
            });
        });

        describe('#decode', function() {
            it('should convert base64 to UTF-8 string', function() {
                var str = 'abc123ÕÄÖÜŠŽ신',
                    b64 = 'YWJjMTIzw5XDhMOWw5zFoMW97Iug';

                expect(str).to.equal(base64.decode(b64, 'string'));
            });

            it('should convert base64 to Buffer', function() {
                var buf = new Buffer([0x61, 0x62, 0x63, 0x31, 0x32, 0x33, 0xc3, 0x95, 0xc3, 0x84, 0xc3, 0x96, 0xc3, 0x9c, 0xc5, 0xa0, 0xc5, 0xbd, 0xec, 0x8b, 0xa0]),
                    b64 = 'YWJjMTIzw5XDhMOWw5zFoMW97Iug';

                expect(buf).to.deep.equal(base64.decode(b64, 'buffer'));
            });

            it('should convert base64 to Buffer, default outputEncoding', function() {
                var buf = new Buffer([0x61, 0x62, 0x63, 0x31, 0x32, 0x33, 0xc3, 0x95, 0xc3, 0x84, 0xc3, 0x96, 0xc3, 0x9c, 0xc5, 0xa0, 0xc5, 0xbd, 0xec, 0x8b, 0xa0]),
                    b64 = 'YWJjMTIzw5XDhMOWw5zFoMW97Iug';

                expect(buf).to.deep.equal(base64.decode(b64));
            });

            it('should convert base64 with spaces to UTF-8 string', function() {
                var str = 'abc123ÕÄÖÜŠŽ신',
                    b64 = ' Y W J j M T     \nI z w 5 X D hM O W w 5 z F o M W 9 7 I ug';

                expect(str).to.equal(base64.decode(b64, 'string'));
            });

            it('should convert base64 with invalid symbols to UTF-8 string', function() {
                var str = 'abc123ÕÄÖÜŠŽ신',
                    b64 = 'õYüWŠJŽj M\rT\t\nI$zw5XDhMOWw5\bzFoMW\ud83d\udca997Iug';

                expect(str).to.equal(base64.decode(b64, 'string'));
            });
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
        describe('#detectMimeType', function() {
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
        });

        describe('#detectExtension', function() {
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
});