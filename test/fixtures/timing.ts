import assert from 'node:assert/strict';

// Best of a few runs in milliseconds, so a single GC pause does not decide a timing assertion
function timeIt(fn: () => void): number {
    let best = Infinity;
    for (let i = 0; i < 3; i++) {
        let start = process.hrtime.bigint();
        fn();
        best = Math.min(best, Number(process.hrtime.bigint() - start) / 1e6);
    }
    return best;
}

// Doubling the input of a linear algorithm roughly doubles the time, a quadratic one quadruples it.
// The constant slack keeps tiny timings from failing on scheduler noise.
export function expectLinear<T>(build: (n: number) => T, run: (input: T) => unknown, n: number): void {
    let small = build(n);
    let large = build(n * 2);
    let tSmall = timeIt(() => run(small));
    let tLarge = timeIt(() => run(large));
    assert.ok(tLarge < tSmall * 3 + 50, `n=${n}: ${tSmall.toFixed(1)}ms, n=${n * 2}: ${tLarge.toFixed(1)}ms`);
}
