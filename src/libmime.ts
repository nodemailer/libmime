/* eslint no-div-regex: 0 */

import { Buffer } from 'node:buffer';
import libbase64 from 'libbase64';
import libqp from 'libqp';
import * as libcharset from './charset.js';
import * as mimetypes from './mimetypes.js';

import type {
    DecodeHeadersOptions,
    HeaderLine,
    HeaderObject,
    HeaderParam,
    LibmimeConfig,
    ParsedHeaderValue,
    ParseHeaderValueOptions,
    StructuredHeaderValue
} from './types.js';
import type * as types from './types.js';

export type * from './types.js';

const STAGE_KEY = 0x1001;
const STAGE_VALUE = 0x1002;

/**
 * Offset of the ")" that closes the rfc822 comment opening at `start`, or -1 when the
 * comment never closes. Comments nest, and a backslash escapes the character after it
 */
const findCommentEnd = (str: string, start: number): number => {
    let depth = 0;
    for (let i = start, len = str.length; i < len; i++) {
        let chr = str.charAt(i);
        if (chr === '\\') {
            i++;
        } else if (chr === '(') {
            depth++;
        } else if (chr === ')' && --depth === 0) {
            return i;
        }
    }
    return -1;
};

// Sets an own property on a plain object. A regular assignment with a
// '__proto__' key would silently modify the object's prototype instead of
// creating an own property, so it needs special handling.
const setOwnProperty = <T>(obj: Record<string, T>, key: string, value: T): void => {
    if (key === '__proto__') {
        Object.defineProperty(obj, key, {
            value,
            writable: true,
            enumerable: true,
            configurable: true
        });
    } else {
        obj[key] = value;
    }
};

// Header names decodeHeaders() leaves out with the skipPrototypeKeys option. Keys are lowercased,
// so of these only '__proto__' and 'constructor' can ever match
const PROTOTYPE_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype));

// Whitespace that separates the tokens of a header value. Kept as a char comparison,
// a regex test would be run for every single char of every parsed header
const isWSP = (chr: string): boolean => chr === ' ' || chr === '\t' || chr === '\r' || chr === '\n' || chr === '\f' || chr === '\v';

export class Libmime {
    config: LibmimeConfig;

    constructor(config?: LibmimeConfig) {
        this.config = config || {};
    }

    /**
     * Checks if a value is plaintext string (uses only printable 7bit chars)
     *
     * When isParam is set the value is destined for a header parameter, so HT, CR and LF
     * are not plaintext either: a header parameter has no way to carry them. HT is a valid
     * fold point, so folding and unfolding a header would rewrite it as a space, and CR/LF
     * cannot appear in a header value at all. DEL is neither a token character nor qtext,
     * so it can not be carried bare or quoted. Such values have to go through the rfc2231
     * parameter continuation encoding instead, the same way non-ASCII text does.
     *
     * @param {String} value String to be tested
     * @param {Boolean} [isParam] Set to true if the value is a header parameter value
     * @returns {Boolean} true if it is a plaintext string
     */
    isPlainText(value: unknown, isParam?: boolean): boolean {
        let re = isParam ? /[\x00-\x1f\x7f\u0080-\uFFFF]/ : /[\x00-\x08\x0b\x0c\x0e-\x1f\u0080-\uFFFF]/;
        return typeof value === 'string' && !re.test(value);
    }

    // A parameter value goes out as is only when it is plain text that does not look like an encoded
    // word. Receivers decode encoded words found in parameter values (and libmime itself does so for
    // unencoded continuations), so as plain text it would come back as something else
    private isPlainParamValue(value: unknown): value is string {
        return this.isPlainText(value, true) && !(value as string).includes('=?');
    }

    /**
     * Checks if a multi line string containes lines longer than the selected value.
     *
     * Useful when detecting if a mail message needs any processing at all:
     * if only plaintext characters are used and lines are short, then there is
     * no need to encode the values in any way. If the value is plaintext but has
     * longer lines then allowed, then use format=flowed
     *
     * @param {String} str String to be tested
     * @param {Number} lineLength Max line length to check for
     * @returns {Boolean} Returns true if there is at least one line longer than lineLength chars
     */
    hasLongerLines(str: string, lineLength: number): boolean {
        return new RegExp('^.{' + (lineLength + 1) + ',}', 'm').test(str);
    }

    /**
     * Decodes a string from a format=flowed soft wrapping.
     *
     * @param {String} str Plaintext string with format=flowed to decode
     * @param {Boolean} [delSp] If true, delete leading spaces (delsp=yes)
     * @return {String} Mime decoded string
     */
    decodeFlowed(input: unknown, delSp?: boolean): string {
        let str = (input || '').toString();

        let lines = str.split(/\r?\n/);

        let result: string[] = [];

        // The current paragraph is kept as a list of non-empty pieces and joined once when it
        // ends. Appending to one string and testing it with a regex on every line re-scans (and
        // flattens) the whole paragraph each time, which is quadratic on long soft-wrapped bodies.
        let parts: string[] = [],
            partsLength = 0,
            // quote depth and the original quote prefix ("> ", ">>" ...) of the current paragraph
            depth = 0,
            prefix = '';

        let pushPart = (part: string) => {
            if (part) {
                parts.push(part);
                partsLength += part.length;
            }
        };

        // remove soft linebreaks
        // soft linebreaks are added after space symbols
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];

            // RFC 3676 section 4.5: a quoted line starts with one or more ">" characters and the one
            // space directly after them is space-stuffing. The quote marker is not content, so a soft
            // line break only joins lines of the same quote depth and drops the continuation's marker.
            let lineDepth = 0;
            while (line.charCodeAt(lineDepth) === 0x3e /* > */) {
                lineDepth++;
            }
            let prefixLength = lineDepth && line.charCodeAt(lineDepth) === 0x20 /* space */ ? lineDepth + 1 : lineDepth;
            let content = line.slice(prefixLength);

            // the last piece is never empty, so it holds the last character of the paragraph
            let last = parts.length ? parts[parts.length - 1] : '';

            // Lines never contain a line break, so a signature separator can only be the whole
            // paragraph (without its quote marker) being exactly "-- "
            let isSoftBreak = lineDepth === depth && last.endsWith(' ') && !(partsLength === 3 && parts.join('') === '-- ');

            if (isSoftBreak) {
                if (delSp) {
                    // delsp adds space to text to be able to fold it
                    // these spaces can be removed once the text is unfolded
                    parts.pop();
                    partsLength -= last.length;
                    pushPart(last.slice(0, -1));
                    pushPart(content);
                } else {
                    // remove space stuffing of the continuation line, the stuffing of a paragraph's first
                    // line is removed below. Without delsp the text is only wrapped after spaces, so a
                    // leading space can only be stuffing (http://tools.ietf.org/html/rfc3676#section-4.4).
                    // The stuffing of a quoted line is already part of its prefix.
                    pushPart(lineDepth ? content : content.replace(/^ /, ''));
                }
            } else {
                if (i > 0) {
                    result.push(prefix + parts.join(''));
                }

                parts = [];
                partsLength = 0;
                depth = lineDepth;
                prefix = line.slice(0, prefixLength);
                pushPart(content);
            }
        }

        if (partsLength || prefix) {
            result.push(prefix + parts.join(''));
        }

        // remove whitespace stuffing
        // http://tools.ietf.org/html/rfc3676#section-4.4
        return result.join('\n').replace(/^ /gm, '');
    }

    /**
     * Adds soft line breaks to content marked with format=flowed to
     * ensure that no line in the message is never longer than lineLength
     *
     * @param {String} str Plaintext string that requires wrapping
     * @param {Number} [lineLength=76] Maximum length of a line
     * @return {String} String with forced line breaks
     */
    encodeFlowed(str: string, lineLength?: number): string {
        lineLength = lineLength || 76;

        // space stuffing http://tools.ietf.org/html/rfc3676#section-4.2
        let stuff = (line: string) => line.replace(/^( |From|>)/i, ' $1');

        let flowed: string[] = [];
        str.split(/\r?\n/).forEach(line => {
            // A space in front of a hard line break would turn it into a soft one and the decoder would
            // join the next line to this one, so trailing spaces are trimmed (rfc3676 section 4.2). The
            // signature separator "-- " is the one line that keeps its trailing space
            if (line !== '-- ') {
                line = line.replace(/ +$/, '');
            }

            let folded = this.foldLines(stuff(line), lineLength, true).split('\r\n');
            // the lines that folding starts need stuffing as much as the first one does,
            // a continuation line that starts with ">" would be read as a quote
            for (let i = 1; i < folded.length; i++) {
                folded[i] = stuff(folded[i]);
            }
            flowed.push(folded.join('\r\n'));
        });
        return flowed.join('\r\n');
    }

    /**
     * Encodes a string or an Buffer to an UTF-8 MIME Word (rfc2047)
     *
     * @param {String|Buffer} data String to be encoded
     * @param {String} mimeWordEncoding='Q' Encoding for the mime word, either Q or B
     * @param {Number} [maxLength=0] If set, split mime words into several chunks if needed
     * @return {String} Single or several mime words joined together
     */
    encodeWord(data: string | Buffer, mimeWordEncoding?: string, maxLength?: number): string {
        mimeWordEncoding = (mimeWordEncoding || 'Q').toString().toUpperCase().trim().charAt(0);
        maxLength = maxLength || 0;

        let encodedStr = '';
        let toCharset = 'UTF-8';

        if (maxLength && maxLength > 7 + toCharset.length) {
            maxLength -= 7 + toCharset.length;
        }

        if (mimeWordEncoding === 'Q') {
            // https://tools.ietf.org/html/rfc2047#section-5 rule (3)
            encodedStr = libqp.encode(data).replace(/[^a-z0-9!*+\-/=]/gi, chr => {
                let ord = chr.charCodeAt(0).toString(16).toUpperCase();
                if (chr === ' ') {
                    return '_';
                } else {
                    return '=' + (ord.length === 1 ? '0' + ord : ord);
                }
            });
        } else if (mimeWordEncoding === 'B') {
            // the chunking loop below splits raw text and base64 encodes each part, so a
            // Buffer goes in as its UTF-8 string: handing it the base64 of the whole input
            // would encode the encoding itself and decode back to base64 text
            encodedStr = typeof data === 'string' ? data : data.toString('utf-8');
            maxLength = maxLength ? Math.max(3, ((maxLength - (maxLength % 4)) / 4) * 3) : 0;
        }

        if (maxLength && (mimeWordEncoding !== 'B' ? encodedStr : libbase64.encode(data)).length > maxLength) {
            if (mimeWordEncoding === 'Q') {
                encodedStr = this.splitMimeEncodedString(encodedStr, maxLength).join('?= =?' + toCharset + '?' + mimeWordEncoding + '?');
            } else {
                // RFC2047 6.3 (2) states that encoded-word must include an integral number of characters, so no chopping unicode sequences
                let parts: string[] = [];
                let lpart = '';
                // iterating a string yields whole code points, a surrogate pair stays together and an
                // unpaired surrogate comes on its own without swallowing the unit that follows it
                for (let chr of encodedStr) {
                    // check if we can add this character to the existing string
                    // without breaking byte length limit
                    if (Buffer.byteLength(lpart + chr) <= maxLength || !lpart) {
                        lpart += chr;
                    } else {
                        // we hit the length limit, so push the existing string and start over
                        parts.push(libbase64.encode(lpart));
                        lpart = chr;
                    }
                }
                if (lpart) {
                    parts.push(libbase64.encode(lpart));
                }

                if (parts.length > 1) {
                    encodedStr = parts.join('?= =?' + toCharset + '?' + mimeWordEncoding + '?');
                } else {
                    encodedStr = parts.join('');
                }
            }
        } else if (mimeWordEncoding === 'B') {
            encodedStr = libbase64.encode(data);
        }

        return '=?' + toCharset + '?' + mimeWordEncoding + '?' + encodedStr + (encodedStr.slice(-2) === '?=' ? '' : '?=');
    }

    /**
     * Normalizes a charset name to its canonical form, resolving common aliases and
     * invalid names. For example `iso-8859-8-i` and `iso-8859-8-e` become `ISO-8859-8`
     * and `win-1257` becomes `windows-1257`. Unknown charsets are returned uppercased.
     * Missing or non-string input defaults to `UTF-8`.
     *
     * @param {String} charset Charset name to normalize
     * @return {String} Canonical charset name
     */
    normalizeCharset(charset?: unknown): string {
        return libcharset.normalizeCharset(charset);
    }

    /**
     * Creates a Transform stream that decodes a body in the given charset into UTF-8 Buffers,
     * resolving the charset name and handling the Japanese charsets the same way header
     * decoding does. An unknown or refused charset (UTF-7, base64, hex) is decoded as UTF-8,
     * and the stream says so with `supported` set to false.
     *
     * @param {String} [charset='UTF-8'] Charset the input is encoded in
     * @return {DecodeStream} Transform stream with `charset` and `supported` properties
     */
    createDecodeStream(charset?: unknown): libcharset.DecodeStream {
        return libcharset.createDecodeStream(charset);
    }

    /**
     * Decodes the inner payload of a single mime encoded-word into a unicode string.
     * Expects the three components of `=?charset?encoding?text?=` already separated.
     *
     * @param {String} charset Charset name from the encoded-word (may include an RFC 2231 language tag, which is ignored)
     * @param {String} encoding Encoding indicator, either 'Q' or 'B' (case insensitive)
     * @param {String} str Encoded payload between the second `?` and the trailing `?=`
     * @return {String} Decoded unicode string
     */
    decodeWord(charset: string, encoding: string, str: string): string {
        // RFC2231 added language tag to the encoding
        // see: https://tools.ietf.org/html/rfc2231#section-5
        // this implementation silently ignores this tag
        let splitPos = charset.indexOf('*');
        if (splitPos >= 0) {
            charset = charset.substring(0, splitPos);
        }
        charset = libcharset.normalizeCharset(charset);

        encoding = encoding.toUpperCase();

        let decoded: Buffer;
        if (encoding === 'Q') {
            str = str
                // remove spaces between = and hex char, this might indicate invalidly applied line splitting
                .replace(/=\s+([0-9a-fA-F])/g, '=$1')
                // convert all underscores to spaces
                .replace(/[_\s]/g, ' ');

            let buf = Buffer.from(str);
            let bytes: number[] = [];
            for (let i = 0, len = buf.length; i < len; i++) {
                let c = buf[i];
                if (i <= len - 2 && c === 0x3d /* = */) {
                    let c1 = this.getHex(buf[i + 1]);
                    let c2 = this.getHex(buf[i + 2]);
                    if (c1 && c2) {
                        let c = parseInt(c1 + c2, 16);
                        bytes.push(c);
                        i += 2;
                        continue;
                    }
                }
                bytes.push(c);
            }
            decoded = Buffer.from(bytes);
        } else if (encoding === 'B') {
            // libbase64 decodes input made of several padded segments segment by segment
            decoded = libbase64.decode(str);
        } else {
            // keep as is, convert Buffer to unicode string, assume utf8
            decoded = Buffer.from(str);
        }

        return libcharset.decode(decoded, charset);
    }

    /**
     * Finds word sequences with non ascii text and converts these to mime words
     *
     * @param {String|Buffer} data String to be encoded
     * @param {String} mimeWordEncoding='Q' Encoding for the mime word, either Q or B
     * @param {Number} [maxLength=0] If set, split mime words into several chunks if needed
     * @param {String} [fromCharset='UTF-8'] Source character set
     * @return {String} String with possible mime words
     */
    encodeWords(data: string | Buffer, mimeWordEncoding?: string, maxLength?: number | string, fromCharset?: string): string {
        if (!fromCharset && typeof maxLength === 'string' && !maxLength.match(/^[0-9]+$/)) {
            fromCharset = maxLength;
            maxLength = undefined;
        }

        let maxLineLength = Number(maxLength) || 0;

        let decodedValue = libcharset.decode(libcharset.convert(data || '', fromCharset));
        let encodedValue: string;

        let firstMatch = decodedValue.match(/(?:^|\s)([^\s]*[\u0080-\uFFFF])/);
        if (!firstMatch) {
            return decodedValue;
        }
        let startIndex =
            firstMatch.index! +
            (
                firstMatch[0].match(/[^\s]/) || {
                    index: 0
                }
            ).index!;

        // The encoded part ends with the word that holds the last non ascii char. Found with a scan,
        // the regex that used to do this rescanned the rest of the word from every non ascii char in
        // it, which made a long non ascii word quadratic
        let lastIndex = decodedValue.length - 1;
        while (lastIndex >= 0 && decodedValue.charCodeAt(lastIndex) < 0x80) {
            lastIndex--;
        }
        let wordEnd = decodedValue.slice(lastIndex + 1).search(/\s/);
        let endIndex = wordEnd < 0 ? decodedValue.length : lastIndex + 1 + wordEnd;

        encodedValue =
            (startIndex ? decodedValue.substring(0, startIndex) : '') +
            this.encodeWord(decodedValue.substring(startIndex, endIndex), mimeWordEncoding || 'Q', maxLineLength) +
            (endIndex < decodedValue.length ? decodedValue.slice(endIndex) : '');

        return encodedValue;
    }

    /**
     * Decode a string that might include one or several mime words
     *
     * @param {String} str String including some mime words that will be decoded
     * @return {String} Decoded unicode string
     */
    decodeWords(str: unknown): string {
        return (
            (str || '')
                .toString()
                // find base64 words that can be joined
                .replace(/(=\?([^?]+)\?[Bb]\?[^?]*\?=)\s*(?==\?([^?]+)\?[Bb]\?[^?]*\?=)/g, (match: string, left: string, chLeft: string, chRight: string) => {
                    // only mark b64 chunks to be joined if charsets match
                    if (libcharset.normalizeCharset(chLeft || '') === libcharset.normalizeCharset(chRight || '')) {
                        // set a joiner marker
                        return left + '__\x00JOIN\x00__';
                    }
                    return match;
                })
                // find QP words that can be joined
                .replace(/(=\?([^?]+)\?[Qq]\?[^?]*\?=)\s*(?==\?([^?]+)\?[Qq]\?[^?]*\?=)/g, (match: string, left: string, chLeft: string, chRight: string) => {
                    // only mark QP chunks to be joined if charsets match
                    if (libcharset.normalizeCharset(chLeft || '') === libcharset.normalizeCharset(chRight || '')) {
                        // set a joiner marker
                        return left + '__\x00JOIN\x00__';
                    }
                    return match;
                })
                // join base64 encoded words
                .replace(/(\?=)?__\x00JOIN\x00__(=\?([^?]+)\?[QqBb]\?)?/g, '')
                // remove spaces between mime encoded words
                .replace(/(=\?[^?]+\?[QqBb]\?[^?]*\?=)\s+(?==\?[^?]+\?[QqBb]\?[^?]*\?=)/g, '$1')
                // decode words
                .replace(/=\?([\w_\-*]+)\?([QqBb])\?([^?]*)\?=/g, (_m: string, charset: string, encoding: string, text: string) =>
                    this.decodeWord(charset, encoding, text)
                )
        );
    }

    getHex(c: number | undefined): string | false {
        if (
            c !== undefined &&
            ((c >= 0x30 /* 0 */ && c <= 0x39) /* 9 */ || (c >= 0x61 /* a */ && c <= 0x66) /* f */ || (c >= 0x41 /* A */ && c <= 0x46)) /* F */
        ) {
            return String.fromCharCode(c);
        }
        return false;
    }

    /**
     * Splits a string by :
     * The result is not mime word decoded, you need to do your own decoding based
     * on the rules for the specific header key
     *
     * @param {String} headerLine Single header line, might include linebreaks as well if folded
     * @return {Object} An object of {key, value}
     */
    decodeHeader(headerLine: unknown): HeaderLine {
        let line = (headerLine || '')
                .toString()
                .replace(/(?:\r?\n|\r)[ \t]*/g, ' ')
                .trim(),
            match = line.match(/^\s*([^:]+):(.*)$/),
            key = ((match && match[1]) || '').trim().toLowerCase(),
            value = ((match && match[2]) || '').trim();

        return {
            key,
            value
        };
    }

    /**
     * Parses a block of header lines. Does not decode mime words as every
     * header might have its own rules (eg. formatted email addresses and such)
     *
     * @param {String} headers Headers string
     * @param {Object} [options] Options
     * @param {Boolean} [options.skipPrototypeKeys] Leave out headers named like an Object.prototype member, eg. `__proto__` and `constructor`
     * @return {Object} An object of headers, where header keys are object keys and every value is an Array of the values for that key
     */
    decodeHeaders(headers: string, options?: DecodeHeadersOptions): HeaderObject {
        let lines = headers.split(/\r?\n|\r/),
            headersObj: HeaderObject = {},
            header: HeaderLine,
            i: number,
            len: number;

        // Empty lines in front of the block are not part of any header, a caller might
        // include the line break that separates a mime part boundary from its headers
        let headersPos = 0;
        while (headersPos < lines.length && lines[headersPos] === '') {
            headersPos++;
        }

        // An empty line terminates the header block, anything after it is the message body.
        // Without this a body line that starts with whitespace would be folded into the last header
        let bodyPos = lines.indexOf('', headersPos);
        lines = lines.slice(headersPos, bodyPos >= 0 ? bodyPos : lines.length);

        // unfold folded lines, a continuation line always starts with a space or a tab
        // Built in one forward pass, removing continuation lines with splice() is quadratic
        let unfolded: string[] = [];
        for (i = 0, len = lines.length; i < len; i++) {
            if (unfolded.length && /^[ \t]/.test(lines[i])) {
                unfolded[unfolded.length - 1] += '\r\n' + lines[i];
            } else {
                unfolded.push(lines[i]);
            }
        }
        lines = unfolded;

        for (i = 0, len = lines.length; i < len; i++) {
            header = this.decodeHeader(lines[i]);
            if (options?.skipPrototypeKeys && PROTOTYPE_KEYS.has(header.key)) {
                continue;
            }
            // own properties only, an attacker controlled key such as '__proto__' or 'toString' would
            // otherwise resolve to an inherited Object.prototype member
            if (!Object.hasOwn(headersObj, header.key)) {
                setOwnProperty(headersObj, header.key, [header.value]);
            } else {
                headersObj[header.key].push(header.value);
            }
        }

        return headersObj;
    }

    /**
     * Joins parsed header value together as 'value; param1=value1; param2=value2'
     * PS: We are following RFC 822 for the list of special characters that we need to keep in quotes.
     *      Refer: https://www.w3.org/Protocols/rfc1341/4_Content-Type.html
     * @param {Object} structured Parsed header value
     * @return {String} joined header value
     */
    buildHeaderValue(structured: StructuredHeaderValue): string {
        let paramsArray: string[] = [];
        let params = structured.params || {};

        Object.keys(params).forEach(key => {
            // filename might include unicode characters so it is a special case
            let value = params[key];
            // a parameter name is a token too and it is emitted without any quoting around it
            let param = key.replace(/[\x00-\x1f\x7f]/g, '');
            if (!this.isPlainParamValue(value) || value.length >= 75) {
                this.buildHeaderParam(param, value, 50).forEach(encodedParam => {
                    if (!/[\s"\\;:/=(),<>@[\]?]|^[-']|'$/.test(encodedParam.value) || encodedParam.key.endsWith('*')) {
                        paramsArray.push(encodedParam.key + '=' + encodedParam.value);
                    } else {
                        paramsArray.push(encodedParam.key + '=' + JSON.stringify(encodedParam.value));
                    }
                });
            } else if (!value.length || /[\s'"\\;:/=(),<>@[\]?]|^-/.test(value)) {
                // a parameter value is a token or a quoted-string and a token is never empty, so
                // a valueless parameter such as the 'flag' of 'multipart/mixed; flag; boundary=b'
                // goes out as 'flag=""' rather than as the 'flag=' that parses as neither
                paramsArray.push(param + '=' + JSON.stringify(value));
            } else {
                paramsArray.push(param + '=' + value);
            }
        });

        // the value ahead of the parameters is a token, it has no way to carry a control
        // char or DEL and there is no quoting construct around it to escape one into
        let value = typeof structured.value === 'string' ? structured.value.replace(/[\x00-\x1f\x7f]/g, '') : structured.value;

        return value + (paramsArray.length ? '; ' + paramsArray.join('; ') : '');
    }

    /**
     * Parses a header value with key=value arguments into a structured
     * object.
     *
     *   parseHeaderValue('text/plain; CHARSET=UTF-8') ->
     *   {
     *     'value': 'text/plain',
     *     'params': {
     *       'charset': 'UTF-8'
     *     }
     *   }
     *
     * The result also carries a non-enumerable `decodedParams` array that names the params
     * assembled from rfc2231 segments (title*=, title*0*=, title*0=). Those values are already
     * decoded, so a caller that runs decodeWords() over the params has to leave them out
     *
     * @param {String} str Header value
     * @param {Object} [options] Options, see ParseHeaderValueOptions
     * @return {Object} Header value as a parsed structure
     */
    parseHeaderValue(str: string, options?: ParseHeaderValueOptions): ParsedHeaderValue {
        // Cleared again by an unclosed "(", see the loop
        let stripComments = !!options?.stripComments;

        let response = {
            value: '',
            params: {}
        } as ParsedHeaderValue;

        // names of the params assembled from rfc2231 segments, see the continuation handling below.
        // Non-enumerable, so the {value, params} shape callers serialize and compare stays as it is
        Object.defineProperty(response, 'decodedParams', {
            value: [],
            writable: true,
            enumerable: false,
            configurable: true
        });

        let key: string | false = false;
        let value = '';
        // Length of the significant part of `value`. Whitespace outside of quotes is
        // not part of the value, while whitespace inside quotes is (rfc2045 section 5.1)
        let valueEnd = 0;
        let stage = STAGE_VALUE;

        let quote = false;
        let escaped = false;
        let chr: string;

        // Whether the last character read belongs to an unquoted token of a parameter value,
        // which a "(" continues: `filename=Invoice(1).pdf` names the file. Anywhere else, in
        // the type, in a parameter name or behind a quoted string, a "(" opens a comment, as
        // it does for Python and postal-mime
        let tokenOpen = false;

        // Stores the collected value, either as the default value, as the value for the
        // current key, or as a key that has no value at all. Runs once per parameter
        let commit = () => {
            let collected = value.substring(0, valueEnd);
            value = '';
            valueEnd = 0;

            if (stage === STAGE_KEY) {
                // key without a value, see emptykey:
                // Header-Key: somevalue; key=value; emptykey
                let name = collected.toLowerCase();
                if (name) {
                    setOwnProperty(response.params, name, '');
                }
            } else if (key === false) {
                // default value
                response.value = collected;
            } else {
                // subkey value
                setOwnProperty(response.params, key, collected);
            }
        };

        for (let i = 0, len = str.length; i < len; i++) {
            chr = str.charAt(i);

            // With stripComments, an rfc822 comment stands anywhere outside a quoted string
            // but right behind a token it would continue. Read as content, `boundary=b (comment)`
            // named a boundary no delimiter line matches, so the parts that Python and
            // postal-mime find stayed hidden from a splitter built on this
            if (stripComments && chr === '(' && !quote && !escaped && !tokenOpen) {
                let end = findCommentEnd(str, i);
                if (end < 0 && str.indexOf(';', i) < 0) {
                    // A comment that never closes runs to the end of the value, as it does for
                    // Python. One that a parameter follows is content instead, with everything
                    // after it, so that the parameter survives, as postal-mime keeps it
                    end = len - 1;
                }
                if (end >= 0) {
                    i = end;
                    continue;
                }
                // Looking for a closing ")" again would scan a run of unclosed "(" to its end
                // once for each of them
                stripComments = false;
            }

            switch (stage) {
                case STAGE_KEY:
                    if (chr === '=') {
                        key = value.substring(0, valueEnd).toLowerCase();
                        value = '';
                        valueEnd = 0;
                        stage = STAGE_VALUE;
                    } else if (chr === ';') {
                        // key without a value, eg. the "inline" in "attachment; inline; filename=a.txt"
                        commit();
                    } else if (isWSP(chr)) {
                        if (value.length) {
                            value += chr;
                        }
                    } else {
                        value += chr;
                        valueEnd = value.length;
                    }
                    break;
                case STAGE_VALUE:
                    if (escaped) {
                        value += chr;
                        valueEnd = value.length;
                        tokenOpen = key !== false && !quote;
                    } else if (chr === '\\') {
                        escaped = true;
                        continue;
                    } else if (chr === '"') {
                        // every char between the quotes is significant, including whitespace
                        quote = !quote;
                        tokenOpen = false;
                    } else if (!quote && chr === ';') {
                        commit();
                        stage = STAGE_KEY;
                        tokenOpen = false;
                    } else if (!quote && isWSP(chr)) {
                        if (value.length) {
                            value += chr;
                        }
                        tokenOpen = false;
                    } else {
                        value += chr;
                        valueEnd = value.length;
                        tokenOpen = key !== false && !quote;
                    }
                    escaped = false;
                    break;
            }
        }

        // finalize remainder
        commit();

        // handle parameter value continuations
        // https://tools.ietf.org/html/rfc2231#section-3

        // Collect the segments of every continuation parameter. These are kept out of
        // response.params so that a half assembled value can not leak into the result
        let continuations = new Map<string, { charset: string | false; values: { nr: number; value: string }[] }>();

        for (let key of Object.keys(response.params)) {
            let match: RegExpMatchArray | null = key.match(/\*((\d+)\*?)?$/);

            if (!match) {
                // nothing to do here, does not seem like a continuation param
                continue;
            }

            let actualKey = key.substring(0, match.index).toLowerCase();
            let nr = Number(match[2]) || 0;
            let value = response.params[key];

            // remove the old reference
            delete response.params[key];

            let continuation = continuations.get(actualKey);
            if (!continuation) {
                continuation = {
                    charset: false,
                    values: []
                };
                continuations.set(actualKey, continuation);
            }

            if (nr === 0 && match[0].charAt(match[0].length - 1) === '*' && (match = value.match(/^([^']*)'[^']*'(.*)$/))) {
                continuation.charset = match[1] || 'utf-8';
                value = match[2]!;
            }

            continuation.values.push({ nr, value });
        }

        // concatenate the split rfc2231 strings and decode the encoded ones
        for (let [key, continuation] of continuations) {
            // NB! An assembled continuation always overrides a plain parameter with the same
            // name, in either source order. The plain form is the legacy ascii fallback of the
            // extended one, so rfc6266 section 4.3 requires picking the extended value. Letting
            // the fallback win would make libmime disagree with the mail clients that follow it
            let value = continuation.values
                .sort((a, b) => a.nr - b.nr)
                .map(val => val.value)
                .join('');

            // Both branches below store a decoded value, so a caller that runs decodeWords() over the
            // params has to leave this one out. A value that percent-encodes an encoded word would
            // otherwise be decoded twice: filename*=utf-8''invoice%3D%3Futf-8%3FQ%3F%3D2Eexe%3F%3D
            // names the file "invoice=?utf-8?Q?=2Eexe?=", not "invoice.exe"
            response.decodedParams.push(key);

            if (!continuation.charset) {
                setOwnProperty(response.params, key, this.decodeWords(value));
                continue;
            }

            // convert "%AB" to the quoted printable "=AB" and decode it as the charset of the parameter.
            // NB! The charset is passed in as an argument instead of building a "=?charset?Q?=AB?=" string,
            // a charset that contains "?" would otherwise inject an encoded word of its own
            let qpValue = value
                // fix invalidly encoded chars
                .replace(/[=_\s]/g, s => {
                    if (s === ' ') {
                        return '_';
                    }
                    let c = s.charCodeAt(0).toString(16);
                    return '%' + (c.length < 2 ? '0' : '') + c;
                })
                // change from urlencoding to percent encoding
                .replace(/%/g, '=');

            setOwnProperty(response.params, key, this.decodeWord(continuation.charset, 'Q', qpValue));
        }

        return response;
    }

    /**
     * Encodes a string or an Buffer to an UTF-8 Parameter Value Continuation encoding (rfc2231)
     * Useful for splitting long parameter values.
     *
     * For example
     *      title="unicode string"
     * becomes
     *     title*0*=utf-8''unicode
     *     title*1*=%20string
     *
     * @param {String} key Parameter name (eg. 'filename')
     * @param {String|Buffer} data String to be encoded
     * @param {Number} [maxLength=50] Max length for generated chunks
     * @param {String} [fromCharset='UTF-8'] Source character set
     * @return {Array} A list of encoded keys and headers
     */
    buildHeaderParam(key: string, data: unknown, maxLength?: number, fromCharset?: string): HeaderParam[] {
        let list: { line: string; encoded?: boolean }[] = [];

        if (typeof data !== 'string' && !Buffer.isBuffer(data)) {
            // documented input is a string or a Buffer, normalize anything else
            data = data === null || data === undefined ? '' : data.toString();
        }

        let encodedStr: string | string[] = typeof data === 'string' ? data : libcharset.decode(data as Buffer, fromCharset);
        let chr: string;
        let line: string;
        let startPos = 0;
        let isEncoded = false;
        let i: number, len: number;

        maxLength = maxLength || 50;

        // process ascii only text
        if (this.isPlainParamValue(data)) {
            // check if conversion is even needed
            if (encodedStr.length <= maxLength) {
                return [
                    {
                        key,
                        value: encodedStr
                    }
                ];
            }

            encodedStr = encodedStr.replace(new RegExp('.{' + maxLength + '}', 'g'), str => {
                list.push({
                    line: str
                });
                return '';
            });

            if (encodedStr) {
                list.push({
                    line: encodedStr
                });
            }
        } else {
            if (/[\uD800-\uDBFF]/.test(encodedStr)) {
                // string contains surrogate pairs, so split it into code points. An unpaired
                // surrogate comes on its own and does not tear apart a valid pair following it
                encodedStr = Array.from(encodedStr);
            }

            // first line includes the charset and language info and needs to be encoded
            // even if it does not contain any unicode characters
            line = "utf-8''";
            isEncoded = true;
            startPos = 0;

            // process text with unicode or special chars
            for (i = 0, len = encodedStr.length; i < len; i++) {
                chr = encodedStr[i];

                if (isEncoded) {
                    chr = this.safeEncodeURIComponent(chr);
                } else {
                    // try to urlencode current char
                    chr = chr === ' ' ? chr : this.safeEncodeURIComponent(chr);
                    // By default it is not required to encode a line, the need
                    // only appears when the string contains unicode or special chars
                    // in this case we start processing the line over and encode all chars
                    if (chr !== encodedStr[i]) {
                        // Check if it is even possible to add the encoded char to the line
                        // If not, there is no reason to use this line, just push it to the list
                        // and start a new line with the char that needs encoding
                        if ((this.safeEncodeURIComponent(line) + chr).length >= maxLength) {
                            list.push({
                                line,
                                encoded: isEncoded
                            });
                            // the line we start here holds an encoded char, so it has to be
                            // flagged as one. Otherwise it gets an unstarred continuation key
                            // and a receiver reads the percent escapes as literal text
                            line = '';
                            isEncoded = true;
                        } else {
                            isEncoded = true;
                            i = startPos;
                            line = '';
                            continue;
                        }
                    }
                }

                // if the line is already too long, push it to the list and start a new one
                if ((line + chr).length >= maxLength) {
                    list.push({
                        line,
                        encoded: isEncoded
                    });
                    line = chr = encodedStr[i] === ' ' ? ' ' : this.safeEncodeURIComponent(encodedStr[i]);
                    if (chr === encodedStr[i]) {
                        isEncoded = false;
                        startPos = i - 1;
                    } else {
                        isEncoded = true;
                    }
                } else {
                    line += chr;
                }
            }

            if (line) {
                list.push({
                    line,
                    encoded: isEncoded
                });
            }
        }

        return list.map((item, i) => ({
            // encoded lines: {name}*{part}*
            // unencoded lines: {name}*{part}
            // if any line needs to be encoded then the first line (part==0) is always encoded
            key: key + '*' + i + (item.encoded ? '*' : ''),
            value: item.line
        }));
    }

    /**
     * Returns file extension for a content type string. If no suitable extensions
     * are found, 'bin' is used as the default extension
     *
     * @param {String} mimeType Content type to be checked for
     * @return {String} File extension
     */
    detectExtension(input: unknown): string {
        let mimeType = (input || '').toString().toLowerCase().replace(/\s/g, '');
        if (!Object.hasOwn(mimetypes.list, mimeType)) {
            return 'bin';
        }

        if (typeof mimetypes.list[mimeType] === 'string') {
            return mimetypes.list[mimeType];
        }

        let mimeParts = mimeType.split('/');

        // search for name match
        for (let i = 0, len = mimetypes.list[mimeType].length; i < len; i++) {
            if (mimeParts[1] === mimetypes.list[mimeType][i]) {
                return mimetypes.list[mimeType][i];
            }
        }

        // use the first one
        return mimetypes.list[mimeType][0] !== '*' ? mimetypes.list[mimeType][0] : 'bin';
    }

    /**
     * Returns content type for a file extension. If no suitable content types
     * are found, 'application/octet-stream' is used as the default content type
     *
     * @param {String} extension Extension (or filename) to be checked for
     * @return {String} Content type
     */
    detectMimeType(input: unknown): string {
        let extension = (input || '').toString().toLowerCase().replace(/\s/g, '').replace(/^\./g, '').split('.').pop() || '';

        if (!Object.hasOwn(mimetypes.extensions, extension)) {
            return 'application/octet-stream';
        }

        if (typeof mimetypes.extensions[extension] === 'string') {
            return mimetypes.extensions[extension];
        }

        let mimeParts: string[];

        // search for name match
        for (let i = 0, len = mimetypes.extensions[extension].length; i < len; i++) {
            mimeParts = mimetypes.extensions[extension][i].split('/');
            if (mimeParts[1] === extension) {
                return mimetypes.extensions[extension][i];
            }
        }

        // use the first one
        return mimetypes.extensions[extension][0];
    }

    /**
     * Folds long lines, useful for folding header lines (afterSpace=false) and
     * flowed text (afterSpace=true)
     *
     * @param {String} str String to be folded
     * @param {Number} [lineLength=76] Maximum length of a line
     * @param {Boolean} afterSpace If true, leave a space in the end of a line
     * @return {String} String with folded lines
     */
    foldLines(input: unknown, lineLength?: number, afterSpace?: boolean): string {
        let str = (input || '').toString();
        lineLength = lineLength || 76;

        let pos = 0,
            len = str.length,
            result = '',
            line: string,
            match: RegExpMatchArray | null;

        while (pos < len) {
            line = str.substring(pos, pos + Math.max(lineLength, 0));
            if (line.length < lineLength) {
                result += line;
                break;
            }
            if ((match = line.match(/^[^\n\r]*(\r?\n|\r)/))) {
                line = match[0];
                result += line;
                pos += line.length;
                continue;
            } else if ((match = line.match(/(\s+)[^\s]*$/)) && match[0].length - (afterSpace ? (match[1] || '').length : 0) < line.length) {
                line = line.substring(0, line.length - (match[0].length - (afterSpace ? (match[1] || '').length : 0)));
            } else if ((match = str.slice(pos + line.length).match(/^[^\s]+(\s*)/))) {
                line = line + match[0].substring(0, match[0].length - (!afterSpace ? (match[1] || '').length : 0));
            }

            result += line;
            pos += line.length;
            if (pos < len) {
                result += '\r\n';
            }
        }

        return result;
    }

    /**
     * Splits a mime encoded string. Needed for dividing mime words into smaller chunks
     *
     * @param {String} str Mime encoded string to be split up
     * @param {Number} maxlen Maximum length of characters for one part (minimum 12)
     * @return {Array} Split string
     */
    splitMimeEncodedString(str: string, maxlen?: number): string[] {
        let curLine: string,
            fallbackLine: string,
            match: RegExpMatchArray | null,
            chr: number,
            done: boolean,
            lines: string[] = [];

        // require at least 12 symbols to fit possible 4 octet UTF-8 sequences
        maxlen = Math.max(maxlen || 0, 12);

        while (str.length) {
            curLine = str.substring(0, maxlen);

            // move incomplete escaped char back to main
            if ((match = curLine.match(/[=][0-9A-F]?$/i))) {
                curLine = curLine.substring(0, match.index);
            }

            // Malformed input (a run of stray UTF-8 continuation bytes, or a dangling "=" at the
            // end) has no split point that keeps a character sequence whole, so the loop below
            // walks back to an empty line looking for one. An empty line never consumes anything
            // and would loop forever, so keep the widest chunk that at least does not cut a "=XX"
            // escape in half, or the rest of the string when there is not even that
            fallbackLine = curLine.length ? curLine : str.substring(0, maxlen);

            done = false;
            while (!done && curLine.length) {
                done = true;
                // check if not middle of a unicode char sequence
                if ((match = str.slice(curLine.length).match(/^[=]([0-9A-F]{2})/i))) {
                    chr = parseInt(match[1], 16);
                    // invalid sequence, move one escaped char back and recheck. Only over a whole
                    // "=XX" escape, a plain char in front of a stray continuation byte ends the walk
                    if (chr < 0xc2 && chr > 0x7f && /=[0-9A-F]{2}$/i.test(curLine)) {
                        curLine = curLine.substring(0, curLine.length - 3);
                        done = false;
                    }
                }
            }

            if (!curLine.length) {
                curLine = fallbackLine;
            }

            lines.push(curLine);
            str = str.slice(curLine.length);
        }

        return lines;
    }

    encodeURICharComponent(chr: string): string {
        let res = '';
        // percent encoding is defined over bytes, so encode the char as UTF-8 first
        let buf = Buffer.from(chr, 'utf-8');

        for (let i = 0, len = buf.length; i < len; i++) {
            let ord = buf[i].toString(16).toUpperCase();
            res += '%' + (ord.length < 2 ? '0' : '') + ord;
        }

        return res;
    }

    safeEncodeURIComponent(input: unknown): string {
        let str = (input || '').toString();

        try {
            // might throw if we try to encode invalid sequences, eg. partial emoji
            str = encodeURIComponent(str);
        } catch (_err) {
            // an unpaired surrogate has no utf-8 representation, so run the value through a
            // utf-8 roundtrip to get the same U+FFFD every other encoder here produces and
            // retry. The value must never come back unencoded, it goes into a header parameter
            // where a bare quote or semicolon would break it out into a parameter of its own
            str = encodeURIComponent(Buffer.from(str, 'utf-8').toString('utf-8'));
        }

        // ensure chars that are not handled by encodeURICompent are converted as well
        return str.replace(/[\x00-\x1F *'()<>@,;:\\"[\]?=\u007F-\uFFFF]/g, chr => this.encodeURICharComponent(chr));
    }
}

/**
 * The shared instance, the default export of the package. The class is attached to it as `Libmime`,
 * so `require('libmime').Libmime` keeps working
 */
const libmime = new Libmime() as Libmime & { Libmime: typeof Libmime };
libmime.Libmime = Libmime;

type LibmimeInstance = Libmime;

// The type names of the @types/libmime declarations, reachable through the default export
// (`libmime.StructuredHeader`), and every other public type next to them. The CommonJS build
// declares the module as `export = libmime` (see scripts/build.js), so these are the only way
// a CommonJS consumer can name the types
namespace libmime {
    export type Libmime = LibmimeInstance;
    export type DecodeStream = libcharset.DecodeStream;
    export type DecodeHeadersOptions = types.DecodeHeadersOptions;
    export type HeaderLine = types.HeaderLine;
    export type HeaderObject = types.HeaderObject;
    export type HeaderParam = types.HeaderParam;
    export type LibmimeConfig = types.LibmimeConfig;
    export type MimeWordEncoding = types.MimeWordEncoding;
    export type ParsedHeaderValue = types.ParsedHeaderValue;
    export type ParseHeaderValueOptions = types.ParseHeaderValueOptions;
    export type StructuredHeader = types.StructuredHeader;
    export type StructuredHeaderValue = types.StructuredHeaderValue;
}

export default libmime;
