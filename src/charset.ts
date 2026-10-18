import { Buffer } from 'node:buffer';
import iconv from 'iconv-lite';
import encodingJapanese from 'encoding-japanese';
import type { Encoding } from 'encoding-japanese';
import charsets from './charsets.js';

/**
 * Character set encoding and decoding functions
 */

// Names that are decoded as UTF-8 without going through iconv-lite
const UTF8_COMPATIBLE = /^(?:(?:us-)?ascii|utf-8|7bit)$/i;

// iconv-lite codecs that are not character sets a message could be written in. UTF-7 is a known
// way to smuggle markup past filters (=?utf-7?Q?+ADw-script+AD4-?= decodes to "<script>"), base64
// and hex are transfer encodings. A name resolving to one of them is treated like a charset
// iconv-lite does not know. iconv-lite resolves the name itself and returns one cached codec per
// encoding, so every alias it knows (unicode-1-1-utf-7 is utf7 too) is caught by identity
const UNSUPPORTED_CODECS = new Set(['utf7', 'utf7imap', 'base64', 'hex'].map(name => iconv.getCodec(name)));
const isUnsupportedCodec = (name: string): boolean => {
    try {
        return UNSUPPORTED_CODECS.has(iconv.getCodec(name));
    } catch (_err) {
        // a charset iconv-lite does not know at all
        return false;
    }
};

// Own entries only, so that a name such as '__proto__' or 'constructor' does not resolve to an
// inherited Object.prototype member
const CHARSET_ALIASES = new Map(Object.entries(charsets));

/**
 * Encodes an unicode string into an Buffer object as UTF-8
 *
 * We force UTF-8 here, no strange encodings allowed.
 *
 * @param str String to be encoded
 * @return UTF-8 encoded typed array
 */
export function encode(str: string): Buffer {
    return Buffer.from(str, 'utf-8');
}

/**
 * Decodes a string from Buffer to an unicode string using specified encoding.
 * An unknown charset falls back to UTF-8
 *
 * @param buf Binary data to be decoded
 * @param [fromCharset='UTF-8'] Binary data is decoded into string using this charset
 * @return Decoded string
 */
export function decode(buf: Buffer | string, fromCharset?: string): string {
    fromCharset = normalizeCharset(fromCharset || 'UTF-8');

    if (UTF8_COMPATIBLE.test(fromCharset)) {
        return buf.toString('utf-8');
    }

    if (isUnsupportedCodec(fromCharset)) {
        // enforce utf-8, the same as for a charset iconv-lite does not know
        return buf.toString();
    }

    try {
        if (/^jis|^iso-?2022-?jp|^EUCJP/i.test(fromCharset)) {
            if (typeof buf === 'string') {
                buf = Buffer.from(buf);
            }
            try {
                let output = encodingJapanese.convert(buf, {
                    to: 'UNICODE',
                    from: fromCharset as Encoding,
                    type: 'string'
                });
                if (typeof output === 'string') {
                    return output;
                }
                // fall through to iconv-lite if convert returned something unexpected
            } catch (_err) {
                // ignore, defaults to iconv-lite on error
            }
        }

        // iconv-lite reads a string as binary, kept as it always was
        return iconv.decode(buf as Buffer, fromCharset);
    } catch (_err) {
        // enforce utf-8, data loss might occur
        return buf.toString();
    }
}

/**
 * Convert a string from specific encoding to UTF-8 Buffer
 *
 * @param data String or Buffer to be encoded
 * @param [fromCharset='UTF-8'] Source encoding for the string
 * @return UTF-8 encoded typed array
 */
export function convert(data: string | Buffer, fromCharset?: string): Buffer {
    fromCharset = normalizeCharset(fromCharset || 'UTF-8');

    if (typeof data !== 'string') {
        if (UTF8_COMPATIBLE.test(fromCharset)) {
            return data;
        }

        return encode(decode(data, fromCharset));
    }
    return encode(data);
}

/**
 * Converts well known invalid character set names to proper names.
 * eg. win-1257 will be converted to windows-1257. Missing or non-string
 * input defaults to UTF-8.
 *
 * @param charset Charset name to convert
 * @return Canonicalized charset name
 */
export function normalizeCharset(charset?: unknown): string {
    let name = (charset || 'UTF-8').toString().toLowerCase().trim();

    // first pass
    let canonical = CHARSET_ALIASES.get(name);
    if (canonical) {
        return canonical;
    }

    name = name
        .replace(/^utf[-_]?(\d+)/, 'utf-$1')
        .replace(/^(?:us[-_]?)ascii/, 'windows-1252')
        .replace(/^win(?:dows)?[-_]?(\d+)/, 'windows-$1')
        .replace(/^(?:latin|iso[-_]?8859)?[-_]?(\d+)/, 'iso-8859-$1')
        .replace(/^l[-_]?(\d+)/, 'iso-8859-$1');

    // updated pass
    return CHARSET_ALIASES.get(name) || name.toUpperCase();
}

export default { encode, decode, convert, normalizeCharset };
