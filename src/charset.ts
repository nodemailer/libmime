import { Buffer } from 'node:buffer';
import { Transform } from 'node:stream';
import type { TransformCallback } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
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

// Charsets iconv-lite does not support, decoded with encoding-japanese instead
const JAPANESE_CHARSET = /^jis|^iso-?2022-?jp|^EUCJP/i;

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
        if (JAPANESE_CHARSET.test(fromCharset)) {
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

// Incremental text decoder, the shape iconv-lite's getDecoder() returns
interface ChunkDecoder {
    write(buf: Buffer): string;
    end(): string | undefined;
}

// The decoder all of iconv-lite's double byte codecs share
const DBCS_DECODER = iconv.getCodec('gbk').decoder;

// The UTF-16 and UTF-32 decoders without a byte order in the name read it from a BOM or guess it
// from the first 100 characters, but a stream guesses as soon as it has 16 or 32 bytes. Holding
// back this many bytes makes the stream guess from the same characters as decode()
const BYTE_ORDER_GUESSING = new Map([
    [iconv.getCodec('utf-16'), 200],
    [iconv.getCodec('utf-32'), 400]
]);

// iconv-lite 0.7 sizes what a DBCS decoder's write() returns by the length of the chunk, so when
// the chunk finishes or rejects a character the previous one started, the output can outgrow
// that size and its end is cut off: an astral GB18030 character split in two loses its low
// surrogate, a GB18030 lead byte followed by a space loses everything after it. The input is
// therefore cut where no character can be unfinished, right after a byte below 0x30. No lead,
// trail or GB18030 digit byte is that low, so such a byte always decodes as itself and the
// parse starts afresh after it. Every cut is decoded as a whole, with nothing carried over, and
// the bytes after the last such byte wait for the next chunk
class LowByteCutDecoder implements ChunkDecoder {
    private charset: string;
    private pending: Buffer[] = [];

    constructor(charset: string) {
        this.charset = charset;
    }

    write(chunk: Buffer): string {
        let cut = chunk.length;
        while (cut > 0 && chunk[cut - 1] >= 0x30) {
            cut--;
        }
        if (!cut) {
            // copied, the caller may reuse the chunk it wrote
            this.pending.push(Buffer.from(chunk));
            return '';
        }
        let text = iconv.decode(Buffer.concat([...this.pending, chunk.subarray(0, cut)]), this.charset);
        this.pending = [Buffer.from(chunk.subarray(cut))];
        return text;
    }

    end(): string | undefined {
        let rest = Buffer.concat(this.pending);
        this.pending = [];
        return rest.length ? iconv.decode(rest, this.charset) : undefined;
    }
}

// Passes the input on once its first `size` bytes are in, see BYTE_ORDER_GUESSING
class HeadBufferedDecoder implements ChunkDecoder {
    private decoder: ChunkDecoder;
    private size: number;
    private head: Buffer[] | null = [];
    private headLength = 0;

    constructor(decoder: ChunkDecoder, size: number) {
        this.decoder = decoder;
        this.size = size;
    }

    write(chunk: Buffer): string {
        if (!this.head) {
            return this.decoder.write(chunk);
        }
        // copied, the caller may reuse the chunk it wrote
        this.head.push(Buffer.from(chunk));
        this.headLength += chunk.length;
        return this.headLength < this.size ? '' : this.releaseHead();
    }

    end(): string | undefined {
        return (this.head ? this.releaseHead() : '') + (this.decoder.end() || '');
    }

    private releaseHead(): string {
        let head = Buffer.concat(this.head || []);
        this.head = null;
        return this.decoder.write(head);
    }
}

// Picks the decoder for a charset iconv-lite knows
function createChunkDecoder(charset: string): ChunkDecoder {
    let codec = iconv.getCodec(charset);
    if (codec.decoder === DBCS_DECODER) {
        return new LowByteCutDecoder(charset);
    }
    let headSize = BYTE_ORDER_GUESSING.get(codec);
    return headSize ? new HeadBufferedDecoder(iconv.getDecoder(charset), headSize) : iconv.getDecoder(charset);
}

/**
 * Transform stream that decodes bytes in a charset into UTF-8 Buffers, see createDecodeStream()
 */
export class DecodeStream extends Transform {
    /** Canonical name of the charset the input was declared in, what normalizeCharset() gives */
    readonly charset: string;
    /**
     * false when the declared charset is unknown, or one that is refused (UTF-7, base64, hex). The
     * input is then decoded as UTF-8, the same fallback decode() applies, so a caller that must
     * not relabel such bytes as UTF-8 checks this before piping anything through
     */
    readonly supported: boolean;

    // null for the Japanese charsets, which are collected and decoded when the input ends
    private decoder: ChunkDecoder | null = null;
    private chunks: Buffer[] = [];
    private highSurrogate = '';

    constructor(charset?: unknown) {
        super();
        this.charset = normalizeCharset(charset || 'UTF-8');

        if (UTF8_COMPATIBLE.test(this.charset)) {
            this.supported = true;
            this.decoder = new StringDecoder('utf-8');
        } else if (isUnsupportedCodec(this.charset) || !(JAPANESE_CHARSET.test(this.charset) || iconv.encodingExists(this.charset))) {
            this.supported = false;
            this.decoder = new StringDecoder('utf-8');
        } else {
            this.supported = true;
            // encoding-japanese has no incremental decoder and ISO-2022-JP is stateful, so the
            // Japanese charsets are left without one
            this.decoder = JAPANESE_CHARSET.test(this.charset) ? null : createChunkDecoder(this.charset);
        }
    }

    override _transform(chunk: Buffer, _encoding: BufferEncoding, done: TransformCallback): void {
        if (!this.decoder) {
            this.chunks.push(chunk);
            return done();
        }
        try {
            this.pushText(this.decoder.write(chunk), false);
        } catch (err) {
            return done(err as Error);
        }
        done();
    }

    override _flush(done: TransformCallback): void {
        try {
            this.pushText(this.decoder ? this.decoder.end() : decode(Buffer.concat(this.chunks), this.charset), true);
        } catch (err) {
            return done(err as Error);
        }
        this.chunks = [];
        done();
    }

    // A decoder may return the two halves of a surrogate pair from separate writes, and a lone
    // half would turn into U+FFFD on its way to UTF-8, so a trailing high surrogate waits for
    // the rest of its character
    private pushText(text: string | undefined, final: boolean): void {
        text = this.highSurrogate + (text || '');
        this.highSurrogate = '';
        let last = text.charCodeAt(text.length - 1);
        if (!final && last >= 0xd800 && last <= 0xdbff) {
            this.highSurrogate = text.slice(-1);
            text = text.slice(0, -1);
        }
        if (text) {
            this.push(Buffer.from(text, 'utf-8'));
        }
    }
}

/**
 * Creates a Transform stream that decodes bytes in the given charset into UTF-8 Buffers. The
 * charset name is resolved with normalizeCharset(), and the output is what decode() gives for
 * the whole input, however it is split into chunks: the Japanese charsets iconv-lite does not
 * support are decoded with encoding-japanese (collected until the input ends, as that decoder
 * is not incremental), and an unknown or refused charset (UTF-7, base64, hex) is decoded as
 * UTF-8 with `supported` set to false on the stream.
 *
 * @param [charset='UTF-8'] Charset the input is encoded in
 * @return Transform stream with `charset` and `supported` properties
 */
export function createDecodeStream(charset?: unknown): DecodeStream {
    return new DecodeStream(charset);
}

export default { encode, decode, convert, normalizeCharset, createDecodeStream, DecodeStream };
