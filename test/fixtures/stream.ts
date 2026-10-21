import { Buffer } from 'node:buffer';
import { once } from 'node:events';
import type { Transform } from 'node:stream';
import type { Rng } from './fuzz.js';

/** Writes the chunks to a transform stream one by one and resolves with everything it output */
export async function runStream(stream: Transform, chunks: Buffer[]): Promise<Buffer> {
    let output: Buffer[] = [];
    stream.on('data', (chunk: Buffer) => output.push(chunk));
    let ended = once(stream, 'end');
    for (let chunk of chunks) {
        stream.write(chunk);
    }
    stream.end();
    await ended;
    return Buffer.concat(output);
}

/** The bytes cut into single byte chunks */
export function byteByByte(buf: Buffer): Buffer[] {
    return Array.from(buf, byte => Buffer.from([byte]));
}

/** The bytes cut at random positions, empty chunks included */
export function randomSplit(rng: Rng, buf: Buffer): Buffer[] {
    let chunks: Buffer[] = [];
    let pos = 0;
    while (pos < buf.length) {
        let size = rng.chance(0.1) ? 0 : rng.int(1, Math.min(8, buf.length - pos));
        chunks.push(buf.subarray(pos, pos + size));
        pos += size;
    }
    return chunks;
}
