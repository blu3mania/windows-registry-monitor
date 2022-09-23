'use strict';

/** Windows wide chat encoding is UTF-16. */
const WindowsWideCharEncoding = 'utf16le';

/**
 * Converts a JavaScript string to WString (wide char encoding).
 * @param {string} str - The string containing two comma-separated numbers.
 * @return {Buffer} Converted WString in a buffer. When used in ffi, define the parameter type as 'pointer' instead of 'string'.
 */
function toWString(str) {
    return Buffer.from(str, WindowsWideCharEncoding);
}

/**
 * Converts a JavaScript string to a NULL-terminated WString (wide char encoding) that can be used for Win32 APIs (xxxxW).
 * @param {string} str - The string containing two comma-separated numbers.
 * @return {Buffer} Converted WString in a buffer. When used in ffi, define the parameter type as 'pointer' instead of 'string'.
 */
function toNullTerminatedWString(str) {
    // Make sure NULL terminator is added.
    return Buffer.from(str + '\0', WindowsWideCharEncoding);
}

/**
 * Converts a buffer that contains a WString (wide char encoding) to JavaScript string.
 * @param {Buffer} buffer - The buffer that contains the WString to be converted.
 * @param {integer} start - (Optional) The byte offset to start converting at.
 *                          Useful if there are data other than a single WString in the buffer, e.g. REG_MULTI_SZ where NULL terminator is used to separate strings.
 *                          If not provided, default value 0 is used (Buffer.toString() behavior).
 * @param {integer} end - (Optional) The byte offset to stop converting at (not inclusive).
 *                        Useful if there are data other than a single WString in the buffer, e.g. REG_MULTI_SZ where NULL terminator is used to separate strings.
 *                        If not provided, default value is end of buffer (Buffer.toString() behavior).
 * @return {string} Converted JavaScript string.
 */
function fromWString(buffer, start, end) {
    return buffer.toString(WindowsWideCharEncoding, start, end);
}

/**
 * Converts a buffer that contains a NULL-terminated WString (wide char encoding) to JavaScript string.
 * @param {Buffer} buffer - The buffer that contains the WString to be converted.
 * @param {integer} start - (Optional) The byte offset to start converting at.
 *                          Useful if there are data other than a single WString in the buffer, e.g. REG_MULTI_SZ where NULL terminator is used to separate strings.
 *                          If not provided, default value 0 is used.
 * @return {string} Converted JavaScript string.
 */
function fromNullTerminatedWString(buffer, start) {
    if (start === undefined) {
        start = 0;
    }

    let foundNullTerminator = false;
    let end = start;
    while (end < buffer.length - 2) {
        // In UTF-16 encoding, a NULL terminator is 2 bytes of zeros
        if (buffer[end] === 0 && buffer[end + 1] === 0) {
            foundNullTerminator = true;
            break;
        }
        end += 2;
    }
    if (!foundNullTerminator) {
        end = buffer.length;
    }

    return fromWString(buffer, start, end);
}

module.exports = {
    toWString,
    toNullTerminatedWString,
    fromWString,
    fromNullTerminatedWString,
};
