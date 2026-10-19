'use strict';

// Loads the CommonJS build the way EmailEngine's @yao-pkg/pkg binary does. Run with
// --no-experimental-require-module (`npm run test:cjs`) so an ES module anywhere in the
// require() graph, including transitive dependencies, fails here instead of being loaded
// through require(esm).

const assert = require('node:assert/strict');
const pkg = require('../package.json');

const libmime = require('../' + pkg.exports['.'].require);

assert.strictEqual(typeof libmime.Libmime, 'function');
assert.strictEqual(libmime.encodeWord('jõgeva', 'Q'), '=?UTF-8?Q?j=C3=B5geva?=');
assert.strictEqual(libmime.encodeWord('jõgeva', 'B'), '=?UTF-8?B?asO1Z2V2YQ==?=');
assert.strictEqual(libmime.decodeWords('=?UTF-8?Q?j=C3=B5geva?= =?UTF-8?B?asO1Z2V2YQ==?='), 'jõgevajõgeva');
assert.strictEqual(libmime.decodeWords('=?ISO-2022-JP?B?GyRCJCIbKEI=?='), 'あ');
assert.strictEqual(libmime.decodeWords('=?windows-1257?Q?=F5?='), 'õ');
assert.deepStrictEqual(libmime.parseHeaderValue('text/plain; charset=utf-8'), { value: 'text/plain', params: { charset: 'utf-8' } });
assert.strictEqual(libmime.detectMimeType('file.pdf'), 'application/pdf');
assert.strictEqual(libmime.detectExtension('image/png'), 'png');

const charset = require('../dist/cjs/charset.js');
assert.strictEqual(charset.decode(Buffer.from([0xf5]), 'iso-8859-15'), 'õ');

console.log('CommonJS build loads and works without require(esm)');
