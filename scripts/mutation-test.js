/* eslint no-console: 0 */

// Mutation testing for the library sources.
//
// Each mutant is one source file with one small change (a flipped comparison, an off by
// one constant, a swapped boolean operator, a changed line break, a dropped negation). The mutant
// is written into a private copy of the repository and the unit, property and fuzz suites run
// against it. A mutant that no test catches ("survives") marks behavior the suites do not pin:
// either a missing assertion, or an equivalent mutant that can not change any output (an extra
// empty iteration, a return value nobody reads), which has to be checked by hand.
//
// Usage: npm run test:mutation -- [--workers 6] [--max 400] [--file src/charset.ts]
//        [--survivors <json>]  re-run only the mutants listed in a survivors file of an earlier run
// Survivors are written to libmime-mutation-survivors.json in the system temp directory. The
// repository itself is never modified. Not part of CI, it takes a few minutes.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { values: opts } = parseArgs({
    options: { workers: { type: 'string' }, max: { type: 'string' }, file: { type: 'string' }, survivors: { type: 'string' } }
});

const FILES = opts.file ? [opts.file] : ['src/libmime.ts', 'src/charset.ts', 'src/get-charset-name.ts'];
const WORKERS = Number(opts.workers || Math.max(2, Math.min(6, os.cpus().length - 2)));
const MAX = Number(opts.max || 0);

// Every suite that runs against src/ directly. The package suites load dist/, which a mutant
// of src/ does not change. The unit suite kills most mutants and runs first, the slower fuzz
// and property suites only run for a mutant it does not kill
const UNIT_TESTS = [path.join('test', 'libmime-test.ts')];
const OTHER_TESTS = fs
    .readdirSync(path.join(ROOT, 'test'), { recursive: true })
    .filter(name => name.endsWith('-test.ts') && !name.startsWith('package'))
    .map(name => path.join('test', name))
    .filter(name => !UNIT_TESTS.includes(name));
const ALL_TESTS = [...UNIT_TESTS, ...OTHER_TESTS];

// operator replacements, applied to code (comments are skipped)
const OPERATORS = [
    // [=] and not a plain =, a regex that starts with = reads like the /= operator (no-div-regex)
    [/[=]==/g, '!=='],
    [/!==/g, '==='],
    [/ <= /g, ' < '],
    [/ < /g, ' <= '],
    [/ >= /g, ' > '],
    [/ > /g, ' >= '],
    [/ && /g, ' || '],
    [/ \|\| /g, ' && '],
    [/ \+ 1\b/g, ' + 2'],
    [/ - 1\b/g, ' - 2'],
    [/ \+ 2\b/g, ' + 1'],
    [/\btrue\b/g, 'false'],
    [/\bfalse\b/g, 'true'],
    [/\\r\\n/g, '\\n'],
    [/\(!(?!=)/g, '(']
];

// Lines that carry no runtime behavior: comments, imports, type declarations, and class fields or
// interface members declared with a type only ("name?: string | undefined;")
const SKIP_LINE = /^\s*(\*|\/\*|\/\/|import\b|export\s+(type|interface)\b|type\b|interface\b|declare\b|(readonly\s+)?[\w$]+\??:\s[^=]*;\s*$)/;

// A match in a type position: a return type ("): false {") or a member of a type union
// ("string | false"). Object literal values ("raw: true") and ternary branches stay mutated
const IN_TYPE = /(\):\s*|[^|]\|\s*)$/;

function mutantsOf(file) {
    let source = fs.readFileSync(path.join(ROOT, file), 'utf8');
    let lines = source.split('\n');
    let mutants = [];
    let inBlockComment = false;
    lines.forEach((line, index) => {
        // lines inside a /* ... */ block are comments too, whatever they start with
        if (inBlockComment) {
            inBlockComment = !line.includes('*/');
            return;
        }
        if (/^\s*\/\*/.test(line) && !line.includes('*/')) {
            inBlockComment = true;
            return;
        }
        let code = line.replace(/\/\/.*$/, '');
        if (SKIP_LINE.test(line) || !code.trim()) {
            return;
        }
        for (let [pattern, replacement] of OPERATORS) {
            pattern.lastIndex = 0;
            let match;
            while ((match = pattern.exec(code))) {
                if (/^(true|false)$/.test(match[0]) && IN_TYPE.test(code.slice(0, match.index))) {
                    continue;
                }
                let mutatedLine = line.slice(0, match.index) + replacement + line.slice(match.index + match[0].length);
                // only the changed line is kept, the source is rebuilt when the mutant runs
                mutants.push({ file, line: index + 1, from: line.trim(), to: mutatedLine.trim() });
            }
        }
    });
    return mutants;
}

function makeWorkspace(n) {
    let dir = fs.mkdtempSync(path.join(os.tmpdir(), `libmime-mutant-${n}-`));
    for (let entry of ['src', 'test', 'package.json', 'tsconfig.json', 'tsconfig.base.json']) {
        fs.cpSync(path.join(ROOT, entry), path.join(dir, entry), { recursive: true });
    }
    fs.symlinkSync(path.join(ROOT, 'node_modules'), path.join(dir, 'node_modules'));
    return dir;
}

function killGroup(pid) {
    try {
        process.kill(-pid, 'SIGKILL');
    } catch {
        // the group is already gone
    }
}

// detached test runs do not get the terminal's Ctrl-C, so the runner forwards it
const running = new Set();
for (let signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
        running.forEach(killGroup);
        process.exit(130);
    });
}

function runTests(dir, tests) {
    return new Promise(resolve => {
        // a mutant that makes a test hang fails that test at the per-test timeout, and one
        // that blocks the event loop (an endless loop in an encoder) is stopped by the process
        // timeout; both count as killed. The unmutated suites finish in a few seconds.
        // The runner forks a process per test file, so the run gets its own process group and the
        // whole group is killed: killing only the runner would leave a looping test process behind.
        // The heap cap (NODE_OPTIONS reaches the forked processes too) stops a mutant that
        // allocates in an endless loop long before it exhausts the machine's memory
        let child = spawn(process.execPath, ['--import', 'tsx', '--test', '--test-force-exit', '--test-concurrency=1', '--test-timeout=10000', ...tests], {
            cwd: dir,
            detached: true,
            stdio: 'ignore',
            env: Object.assign({}, process.env, {
                FUZZ_ITERATIONS: '60',
                NODE_OPTIONS: [process.env.NODE_OPTIONS, '--max-old-space-size=512'].filter(Boolean).join(' ')
            })
        });
        running.add(child.pid);
        let timer = setTimeout(() => killGroup(child.pid), 60 * 1000);
        child.on('exit', code => {
            clearTimeout(timer);
            // a test process may outlive the runner (--test-force-exit does not wait for it)
            killGroup(child.pid);
            running.delete(child.pid);
            resolve(code === 0);
        });
    });
}

/**
 * Rebuilds the mutants of an earlier run from their recorded lines, so they can be re-run after
 * the tests or the code changed. A mutant whose line no longer exists is reported and skipped
 */
function mutantsFromSurvivors(file) {
    let mutants = [];
    let sources = new Map();
    for (let survivor of JSON.parse(fs.readFileSync(file, 'utf8'))) {
        if (!sources.has(survivor.file)) {
            sources.set(survivor.file, fs.readFileSync(path.join(ROOT, survivor.file), 'utf8').split('\n'));
        }
        let lines = sources.get(survivor.file);
        // the same text can appear on several lines, the one nearest the recorded line number is the one
        let index = -1;
        lines.forEach((line, i) => {
            if (line.trim() === survivor.from && (index < 0 || Math.abs(i + 1 - survivor.line) < Math.abs(index + 1 - survivor.line))) {
                index = i;
            }
        });
        if (index < 0) {
            console.log(`GONE ${survivor.file}:${survivor.line} ${survivor.from}`);
            continue;
        }
        mutants.push({ ...survivor, line: index + 1 });
    }
    return mutants;
}

let mutants = opts.survivors ? mutantsFromSurvivors(opts.survivors) : FILES.flatMap(mutantsOf);
if (MAX && mutants.length > MAX) {
    // an even sample over all files
    let step = mutants.length / MAX;
    mutants = Array.from({ length: MAX }, (_, i) => mutants[Math.floor(i * step)]);
}
console.log(`${mutants.length} mutants, ${WORKERS} workers, tests: ${ALL_TESTS.length} files`);

let workspaces = Array.from({ length: WORKERS }, (_, i) => makeWorkspace(i));
try {
    // the unmutated code must pass first, otherwise every mutant would look killed
    if (!(await runTests(workspaces[0], ALL_TESTS))) {
        console.error('the suites fail on the unmutated code');
        process.exitCode = 1;
    } else {
        let next = 0;
        let killed = 0;
        let survivors = [];
        let started = Date.now();
        await Promise.all(
            workspaces.map(async dir => {
                while (next < mutants.length) {
                    let mutant = mutants[next++];
                    let target = path.join(dir, mutant.file);
                    let original = fs.readFileSync(target, 'utf8');
                    let lines = original.split('\n');
                    lines[mutant.line - 1] = lines[mutant.line - 1].match(/^\s*/)[0] + mutant.to;
                    fs.writeFileSync(target, lines.join('\n'));
                    let passed = (await runTests(dir, UNIT_TESTS)) && (await runTests(dir, OTHER_TESTS));
                    fs.writeFileSync(target, original);
                    if (passed) {
                        survivors.push(mutant);
                        console.log(`SURVIVED ${mutant.file}:${mutant.line}\n    - ${mutant.from}\n    + ${mutant.to}`);
                    } else {
                        killed++;
                    }
                    let done = killed + survivors.length;
                    if (done % 20 === 0) {
                        console.log(`  ${done}/${mutants.length} done, ${survivors.length} survived, ${Math.round((Date.now() - started) / 1000)}s`);
                    }
                }
            })
        );

        console.log(`\nkilled ${killed}, survived ${survivors.length}, mutation score ${((100 * killed) / mutants.length).toFixed(1)}%`);
        let report = path.join(os.tmpdir(), 'libmime-mutation-survivors.json');
        survivors.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
        fs.writeFileSync(report, JSON.stringify(survivors, null, 2));
        console.log(`survivors written to ${report}`);
    }
} finally {
    for (let dir of workspaces) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
