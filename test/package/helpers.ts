import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const hasDist = fs.existsSync(path.join(root, 'dist', 'cjs', 'libmime.d.ts')) && fs.existsSync(path.join(root, 'dist', 'esm', 'libmime.d.ts'));

export interface ConsumerProject {
    /** Files to write into the project, keyed by their name */
    files: Record<string, string>;
    /** The "type" of the consumer package.json */
    type?: string | undefined;
    /** Arguments for node, given the project directory. The first file is run by default */
    args?: ((dir: string) => string[]) | undefined;
}

// Runs a command in a temporary consumer project that has the package installed as a
// dependency: the package is linked into its node_modules, so that the specifiers resolve
// through the package.json exports map the way they do for an application. Resolves with
// the output of the command, which has to exit cleanly
export async function runInConsumer(project: ConsumerProject): Promise<string> {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'libmime-consumer-'));
    try {
        fs.mkdirSync(path.join(dir, 'node_modules', '@types'), { recursive: true });
        fs.symlinkSync(root, path.join(dir, 'node_modules', 'libmime'), 'dir');
        fs.symlinkSync(path.join(root, 'node_modules', '@types', 'node'), path.join(dir, 'node_modules', '@types', 'node'), 'dir');
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'consumer', private: true, ...(project.type ? { type: project.type } : {}) }));
        for (const [name, source] of Object.entries(project.files)) {
            fs.writeFileSync(path.join(dir, name), source);
        }

        const args = project.args ? project.args(dir) : [path.join(dir, Object.keys(project.files)[0])];
        return await new Promise((resolve, reject) => {
            execFile(process.execPath, args, { cwd: dir, encoding: 'utf8' }, (err, stdout, stderr) => {
                if (err) {
                    reject(new assert.AssertionError({ message: 'consumer failed\n' + stdout + stderr }));
                    return;
                }
                resolve(stdout);
            });
        });
    } finally {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
