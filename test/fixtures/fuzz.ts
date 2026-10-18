// Seeded generators for the property and fuzz suites.
//
// The runs are reproducible: FUZZ_SEED picks the seed and FUZZ_ITERATIONS the number of cases,
// so a failure reported for one seed reruns as `FUZZ_SEED=<seed> FUZZ_ITERATIONS=<n>`. Raise
// FUZZ_ITERATIONS for a soak run after touching the encoders or the parsers.

export const FUZZ_SEED = Number(process.env.FUZZ_SEED) || 20261018;
export const FUZZ_ITERATIONS = Number(process.env.FUZZ_ITERATIONS) || 300;

/**
 * mulberry32, a small seeded PRNG. Not for anything but reproducible test input.
 */
export class Rng {
    state: number;

    constructor(seed: number) {
        this.state = seed >>> 0; // eslint-disable-line no-bitwise
    }

    next(): number {
        /* eslint-disable no-bitwise */
        let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        /* eslint-enable no-bitwise */
    }

    /** Integer in [min, max], both inclusive */
    int(min: number, max: number): number {
        return min + Math.floor(this.next() * (max - min + 1));
    }

    chance(p: number): boolean {
        return this.next() < p;
    }

    pick<T>(list: readonly T[]): T {
        return list[this.int(0, list.length - 1)];
    }

    bytes(length: number): Buffer {
        let buf = Buffer.alloc(length);
        for (let i = 0; i < length; i++) {
            buf[i] = this.int(0, 255);
        }
        return buf;
    }

    /** A string of `length` characters drawn from `alphabet`, by code point */
    string(alphabet: string, length: number): string {
        let chars = codePoints(alphabet);
        let out = '';
        for (let i = 0; i < length; i++) {
            out += this.pick(chars);
        }
        return out;
    }
}

// Character classes the generators mix. Each one exercises a different path: plain ASCII goes
// out as is, MIME specials need quoting or escaping, non-ASCII needs encoding, astral chars are
// surrogate pairs that must never be split, and the control chars must never reach a header raw
// the generators draw from a handful of alphabets thousands of times, split each one once
const splitAlphabets = new Map<string, string[]>();
function codePoints(alphabet: string): string[] {
    let chars = splitAlphabets.get(alphabet);
    if (!chars) {
        chars = Array.from(alphabet);
        splitAlphabets.set(alphabet, chars);
    }
    return chars;
}

/** Runs `fn` FUZZ_ITERATIONS times with its own seeded generator, `context` names the seed and case */
export function forEachCase(offset: number, fn: (rng: Rng, context: string) => void): void {
    let rng = new Rng(FUZZ_SEED + offset);
    for (let n = 0; n < FUZZ_ITERATIONS; n++) {
        fn(rng, `seed ${FUZZ_SEED + offset} case ${n}`);
    }
}

export const ALPHABETS = {
    ascii: 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
    specials: ' \t()<>@,;:\\"/[]?=.\'-_*%+!#$&~^`{}|',
    latin: 'õäöüÕÄÖÜéèàçñßøåæ',
    cyrillic: 'абвгдежзийклмнопрстуфхцчшщъыьэюя',
    cjk: '中文字符日本語한국어漢字',
    astral: '\u{1F600}\u{1F4E7}\u{20000}\u{1D11E}\u{10437}',
    controls: '\x00\x01\x07\x08\x0b\x0c\x0e\x1b\x1f\x7f',
    breaks: '\r\n'
};

export type AlphabetName = keyof typeof ALPHABETS;

/** Well-formed text (no lone surrogates) mixed from the named character classes */
export function text(rng: Rng, maxLength: number, classes: AlphabetName[] = ['ascii', 'specials', 'latin', 'cyrillic', 'cjk', 'astral']): string {
    let length = rng.int(0, maxLength);
    let out = '';
    for (let count = 0; count < length;) {
        // runs of one class, the way real text clusters words of one script
        let run = rng.int(1, 8);
        out += rng.string(ALPHABETS[rng.pick(classes)], run);
        count += run;
    }
    return out;
}

/** Text with words separated by single spaces, no leading, trailing or repeated whitespace */
export function words(rng: Rng, maxWords: number, classes?: AlphabetName[]): string {
    let list: string[] = [];
    for (let i = rng.int(1, maxWords); i > 0; i--) {
        let word = text(rng, 12, classes).replace(/\s+/g, '');
        if (word) {
            list.push(word);
        }
    }
    return list.join(' ');
}

/** A parameter name: a token that starts with a letter */
export function paramName(rng: Rng, maxLength: number): string {
    return rng.string('abcdefghijklmnop', 1) + rng.string('abcdefghijklmnop0123456789-_', rng.int(0, maxLength - 1));
}

/** A lone surrogate, which has no UTF-8 representation */
export function loneSurrogate(rng: Rng): string {
    return String.fromCharCode(rng.chance(0.5) ? rng.int(0xd800, 0xdbff) : rng.int(0xdc00, 0xdfff));
}

/** The same string with every lone surrogate replaced by U+FFFD, what a UTF-8 roundtrip gives */
export function wellFormed(str: string): string {
    return Buffer.from(str, 'utf-8').toString('utf-8');
}

// Fragments of MIME syntax for the hostile input generators, combined with random text and
// mutated, so that the parsers see inputs that are almost but not quite valid
const FRAGMENTS = [
    '=?',
    '?=',
    '?Q?',
    '?B?',
    '?q?',
    '?b?',
    '=?utf-8?Q?',
    '=?UTF-8?B?',
    '=?iso-8859-1?q?',
    '=?utf-7?Q?+ADw-',
    '=?unicode-1-1-utf-7?B?',
    '=?x-unknown*en?Q?',
    '=C3=B5',
    '=C3',
    '=',
    '_',
    'w7U=',
    '====',
    ';',
    '"',
    '\\',
    "'",
    "''",
    '*',
    '*0*',
    '*1',
    '*99999999999999999999*',
    '%',
    '%C3%B5',
    '%2',
    '__proto__',
    'constructor',
    'prototype',
    'toString',
    'hasOwnProperty',
    ':',
    ' ',
    '\t',
    '\r\n',
    '\r\n ',
    '\n',
    '\r',
    '-- ',
    '>',
    'From '
];

/** A string that looks like MIME syntax but is assembled at random */
export function hostile(rng: Rng, maxParts: number): string {
    let out = '';
    for (let i = rng.int(0, maxParts); i > 0; i--) {
        if (rng.chance(0.6)) {
            out += rng.pick(FRAGMENTS);
        } else if (rng.chance(0.1)) {
            out += loneSurrogate(rng);
        } else {
            out += text(rng, 6, ['ascii', 'specials', 'latin', 'astral', 'controls', 'breaks']);
        }
    }
    return out;
}

/** Applies a few random byte-level edits: deletions, duplications, swaps and insertions */
export function mutate(rng: Rng, input: string): string {
    let chars = input.split('');
    for (let n = rng.int(1, 4); n > 0 && chars.length; n--) {
        let pos = rng.int(0, chars.length - 1);
        switch (rng.int(0, 3)) {
            case 0:
                chars.splice(pos, rng.int(1, 3));
                break;
            case 1:
                chars.splice(pos, 0, ...chars.slice(pos, pos + rng.int(1, 6)));
                break;
            case 2: {
                let other = rng.int(0, chars.length - 1);
                [chars[pos], chars[other]] = [chars[other], chars[pos]];
                break;
            }
            default:
                chars.splice(pos, 0, rng.pick(FRAGMENTS));
        }
    }
    return chars.join('');
}

/** A short printable rendering of a test input for failure messages */
export function show(value: unknown): string {
    let json = JSON.stringify(value) ?? String(value);
    return json.length > 300 ? json.slice(0, 300) + '...(' + json.length + ' chars)' : json;
}
