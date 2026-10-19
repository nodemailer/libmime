'use strict';

module.exports = {
    upgrade: true,
    target: name => {
        // @types/node stays on the 20.x line so the compiler rejects APIs that do
        // not exist on Node 20, the oldest version the test suite runs on
        if (name === '@types/node') {
            return 'minor';
        }
        // typescript-eslint declares a peer range that excludes TypeScript 7
        if (name === 'typescript') {
            return 'minor';
        }
        // iconv-lite 1.0 (in alpha since 2026-10) requires Node 22 and moves to ES modules, relying on
        // require(esm). That breaks the Node 20 floor and the CommonJS-only rule EmailEngine's pkg
        // binary depends on, so stay on 0.x: 'minor' still takes new 0.x releases.
        if (name === 'iconv-lite') {
            return 'minor';
        }
        return 'latest';
    }
};
