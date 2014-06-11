# libmime

`libmime` provides useful MIME related functions like encoding and decoding quoted-printable strings or detecting content-type strings for file extensions.

## Installation

### [npm](https://www.npmjs.org/):

    npm install libmime

## Usage

    var libmime = require('libmime');

## Methods

### Quoted Printable encoding

#### #quotedPrintableEncode

Encodes a string into Quoted-printable format.

    libmime.quotedPrintableEncode(str [, fromCharset]) -> String

  * **str** - String or an Buffer to mime encode
  * **fromCharset** - If the first parameter is a Buffer object, use this charset to decode the value to unicode before encoding

#### #quotedPrintableDecode

Decodes a string from Quoted-printable format.

    libmime.quotedPrintableDecode(str [, fromCharset]) -> String

  * **str** - Mime encoded string
  * **fromCharset** - Use this charset to decode mime encoded string to unicode

### Base64 Encoding

#### #base64Encode

Encodes a string into Base64 format.

    libmime.base64Encode(str [, fromCharset]) -> String

  * **str** - String or an Buffer to base64 encode
  * **fromCharset** - If the first parameter is a Buffer object, use this charset to decode the value to unicode before encoding

#### #base64Decode

Decodes a string from Base64 format to an unencoded unicode string.

    libmime.base64Decode(str [, fromCharset]) -> String

  * **str** Base64 encoded string
  * **fromCharset** Use this charset to decode base64 encoded string to unicode

### Encoded Words

#### #mimeWordEncode

Encodes a string into mime [encoded word](http://en.wikipedia.org/wiki/MIME#Encoded-Word) format.

    libmime.mimeWordEncode(str [, mimeWordEncoding[, maxLength[, fromCharset]]]) -> String

  * **str** - String or Buffer to be encoded
  * **mimeWordEncoding** - Encoding for the mime word, either Q or B (default is 'Q')
  * **maxLength** - If set, split mime words into several chunks if needed
  * **fromCharset** - If the first parameter is a Buffer object, use this encoding to decode the value to unicode

**Example**

    libmime.mimeWordEncode('See on õhin test', 'Q');

Becomes with UTF-8 and Quoted-printable encoding

    =?UTF-8?Q?See_on_=C3=B5hin_test?=

#### #mimeWordDecode

Decodes a string from mime encoded word format.

    libmime.mimeWordDecode(str) -> String

  * **str** - String to be decoded

**Example**

    libmime.mimeWordDecode('=?UTF-8?Q?See_on_=C3=B5hin_test?=');

will become

    See on õhin test

#### #mimeWordsEncode

Encodes non ascii sequences in a string to mime words.

    libmime.mimeWordsEncode(str[, mimeWordEncoding[, maxLength[, fromCharset]]]) -> String

  * **str** - String or Buffer to be encoded
  * **mimeWordEncoding** - Encoding for the mime word, either Q or B (default is 'Q')
  * **maxLength** - If set, split mime words into several chunks if needed
  * **fromCharset** - If the first parameter is a Buffer object, use this charset to decode the value to unicode before encoding

#### #mimeWordsDecode

Decodes a string that might include one or several mime words. If no mime words are found from the string, the original string is returned

    libmime.mimeWordsDecode(str) -> String

  * **str** - String to be decoded

### Folding

#### #foldLines

Folds a long line according to the [RFC 5322](http://tools.ietf.org/html/rfc5322#section-2.1.1). Mostly needed for folding header lines.

    libmime.foldLines(str [, lineLengthMax[, afterSpace]]) -> String

  * **str** - String to be folded
  * **lineLengthMax** - Maximum length of a line (defaults to 76)
  * **afterSpace** - If true, leave a space in the end of a line

**Example**

    libmime.foldLines('Content-Type: multipart/alternative; boundary="----zzzz----"')

results in

    Content-Type: multipart/alternative;
         boundary="----zzzz----"

#### #addSoftLinebreaks

Adds soft line breaks to encoded strings. Needed for folding body lines.

    libmime.addSoftLinebreaks(str, encoding, lineLengthMax) -> String

  * **str** Encoded string that requires wrapping
  * **encoding** Either Q for quoted-printable, B for base64 (the default) or F for `format=flowed`
  * **lineLengthMax** Maximum line length without line breaks(defaults to 76)

#### #flowedDecode

Unwraps a plaintext string in format=flowed wrapping.

  libmime.flowedDecode(str [, delSp]) -> String

  * **str** Plaintext string with format=flowed to decode
  * **delSp** If true, delete leading spaces (delsp=yes)

### Headers

#### #headerLineEncode

Encodes and folds a header line for a MIME message header. Shorthand for `mimeWordsEncode` + `foldLines`.

    libmime.headerLineEncode(key, value[, fromCharset])

  * **key** - Key name, will not be encoded
  * **value** - Value to be encoded
  * **fromCharset** - If the `value` parameter is a Buffer object, use this charset to decode the value to unicode before encoding

#### #headerLineDecode

Unfolds a header line and splits it to key and value pair. The return value is in the form of `{key: 'subject', value: 'test'}`. The value is not mime word decoded, you need to do your own decoding based on the rules for the specific header key.

    libmime.headerLineDecode(headerLine) -> Object

  * **headerLine** - Single header line, might include linebreaks as well if folded

#### #headerLinesDecode

Parses a block of header lines. Does not decode mime words as every header
might have its own rules (eg. formatted email addresses and such).

Return value is an object of headers, where header keys are object keys. NB! Several values with the same key make up an array of values for the same key.

    libmime.headerLinesDecode(headers) -> Object

  * **headers** - Headers string

#### #parseStructuredHeaderValue

Parses a header value with `key=value` arguments into a structured object. Useful when dealing with
`content-type` and such. Continuation encoded params are joined into mime encoded words.

    parseStructuredHeaderValue(valueString) -> Object

  * **valueString** - a header value without the key

**Example**

```javascript
parseStructuredHeaderValue('content-type: text/plain; CHARSET="UTF-8"');
```

Outputs

```json
{
    "value": "text/plain",
    "params": {
        "charset": "UTF-8"
    }
}
```

#### #buildStructuredHeaderValue

Joins structured header value together as 'value; param1=value1; param2=value2'

    buildStructuredHeaderValue(structuredHeader) -> String

  * **structuredHeader** - a header value formatted with `parseStructuredHeaderValue`

`filename` argument is encoded with continuation encoding if needed

#### #continuationEncode

Encodes and splits a header param value according to [RFC2231](https://tools.ietf.org/html/rfc2231#section-3) Parameter Value Continuations.

    libmime.continuationEncode(key, str, maxLength [, fromCharset]) -> Array

  * **key** - Parameter key (eg. `filename`)
  * **str** - String or an Buffer value to encode
  * **maxLength** - Maximum length of the encoded string part (not line length). Defaults to 50
  * **fromCharset** - If `str` is a Buffer object, use this charset to decode the value to unicode before encoding

The method returns an array of encoded parts with the following structure: `[{key:'...', value: '...'}]`

**Example**

```
libmime.continuationEncode('filename', 'filename õäöü.txt', 20);
->
[ { key: 'filename*0*', value: 'utf-8\'\'filename%20' },
  { key: 'filename*1*', value: '%C3%B5%C3%A4%C3%B6' },
  { key: 'filename*2*', value: '%C3%BC.txt' } ]
```

This can be combined into a properly formatted header:

```
Content-disposition: attachment; filename*0*="utf-8''filename%20"
  filename*1*="%C3%B5%C3%A4%C3%B6"; filename*2*="%C3%BC.txt"
```

### MIME Types

#### #detectExtension

Returns file extension for a content type string. If no suitable extensions are found, 'bin' is used as the default extension.

    libmime.detectExtension(mimeType) -> String

  * **mimeType** - Content type to be checked for

**Example**

    libmime.detectExtension('image/jpeg') // returns 'jpeg'

#### #detectMimeType

Returns content type for a file extension. If no suitable content types are found, 'application/octet-stream' is used as the default content type

    libmime.detectMimeType(extension) -> String

  * **extension** Extension (or filename) to be checked for

**Example**

    libmime.detectExtension('logo.jpg') // returns 'image/jpeg'

## License

**MIT**