'use strict';

/**
 * Base64 encoding and decoding functions
 */
module.exports = {

    /**
     * Encodes input into base64
     *
     * @param {String|Uint8Array} data Data to be encoded into base64
     * @return {String} Base64 encoded string
     */
    encode: function(data) {
        if (!data) {
            return '';
        }

        if (typeof data === 'string') {
            return new Buffer(data, 'utf-8').toString('base64');
        }

        return data.toString('base64');
    },

    /**
     * Decodes base64 encoded string into an unicode string or Uint8Array
     *
     * @param {String} data Base64 encoded data
     * @param {String} [outputEncoding='buffer'] Output encoding, either 'string' or 'buffer' (Uint8Array)
     * @return {String|Uint8Array} Decoded string
     */
    decode: function(data, outputEncoding) {
        outputEncoding = (outputEncoding || 'buffer').toLowerCase().trim();

        var buf = new Buffer(data, 'base64');

        if (outputEncoding === 'string') {
            return buf.toString('utf-8');
        } else {
            return buf;
        }
    }
};