'use strict';

const ref = require('ref-napi');
const ffi = require('ffi-napi');

const { fromNullTerminatedWString } = require('./wstring.js');

/** Flags used by FormatMessage API. */
const Flags = {
    FORMAT_MESSAGE_ALLOCATE_BUFFER: 0x00000100,
    FORMAT_MESSAGE_ARGUMENT_ARRAY: 0x00002000,
    FORMAT_MESSAGE_FROM_HMODULE: 0x00000800,
    FORMAT_MESSAGE_FROM_STRING: 0x00000400,
    FORMAT_MESSAGE_FROM_SYSTEM: 0x00001000,
    FORMAT_MESSAGE_IGNORE_INSERTS: 0x00000200,
    FORMAT_MESSAGE_MAX_WIDTH_MASK: 0x000000FF,
};

/**
 Define Windows APIs.
 */
const win32Api = ffi.Library('kernel32', {
    /*
    DWORD FormatMessageA(
      [in]           DWORD   dwFlags,
      [in, optional] LPCVOID lpSource,
      [in]           DWORD   dwMessageId,
      [in]           DWORD   dwLanguageId,
      [out]          LPSTR   lpBuffer,
      [in]           DWORD   nSize,
      [in, optional] va_list *Arguments
    );
    */
    'FormatMessageA': [ 'uint', [ 'uint', 'pointer', 'uint', 'uint', 'pointer', 'uint', 'pointer' ] ],

    /*
    DWORD FormatMessageW(
      [in]           DWORD   dwFlags,
      [in, optional] LPCVOID lpSource,
      [in]           DWORD   dwMessageId,
      [in]           DWORD   dwLanguageId,
      [out]          LPWSTR  lpBuffer,
      [in]           DWORD   nSize,
      [in, optional] va_list *Arguments
    );
    */
    'FormatMessageW': [ 'uint', [ 'uint', 'pointer', 'uint', 'uint', 'pointer', 'uint', 'pointer' ] ],

    /*
    HLOCAL LocalFree(
      [in] _Frees_ptr_opt_ HLOCAL hMem
    );
    */
    'LocalFree': [ 'uint', [ 'pointer' ] ],
});

function getWindowsSystemErrorText(errorCode) {
    if (errorCode > 0) {
        const temp = ref.alloc('pointer');

        // Use ANSI version since FormatMessageW returns number of TCHARs, and we cannot calculate the exactly required number of bytes if wide char is used because UTF-16 is variable length character encoding.
        // The wide char version allocates more memory to workaround it, but it's kind of waste of memory. Plus, the language used here is LANG_NEUTRAL anyway.
        let size = win32Api.FormatMessageA(
            Flags.FORMAT_MESSAGE_FROM_SYSTEM |     // Use system message tables to retrieve error text
            Flags.FORMAT_MESSAGE_ALLOCATE_BUFFER | // Allocate buffer on local heap for error text
            Flags.FORMAT_MESSAGE_IGNORE_INSERTS,   // Important! will fail otherwise, since we're not (and CANNOT) pass insertion parameters
            ref.NULL,
            errorCode,
            0,
            temp,
            0,
            ref.NULL
        );
        if (size > 0) {
            // Since we cannot recognize the received message as a string, we need to allocate a buffer and use the right size to receive it again.
            // Thus we need to release the buffer allocated by FormatMessage().
            // Note, when FORMAT_MESSAGE_ALLOCATE_BUFFER is used, lpBuffer effectively becomes pointer to pointer of string, i.e. char **
            win32Api.LocalFree(temp.deref());

            ++size; // Add NULL terminator
            const errorText = Buffer.alloc(size);
            size = win32Api.FormatMessageA(
                Flags.FORMAT_MESSAGE_FROM_SYSTEM |     // Use system message tables to retrieve error text
                Flags.FORMAT_MESSAGE_IGNORE_INSERTS,   // Important! will fail otherwise, since we're not (and CANNOT) pass insertion parameters
                ref.NULL,
                errorCode,
                0,
                errorText,
                size,
                ref.NULL
            );

            if (size > 0) {
                // Remove NULL terminator when converting to JS string.
                return errorText.toString('latin1', 0, size - 1);
            }
        }
/*
        let size = win32Api.FormatMessageW(
            Flags.FORMAT_MESSAGE_FROM_SYSTEM |     // Use system message tables to retrieve error text
            Flags.FORMAT_MESSAGE_ALLOCATE_BUFFER | // Allocate buffer on local heap for error text
            Flags.FORMAT_MESSAGE_IGNORE_INSERTS,   // Important! will fail otherwise, since we're not (and CANNOT) pass insertion parameters
            ref.NULL,
            errorCode,
            0,
            temp,
            0,
            ref.NULL
        );
        if (size > 0) {
            // Since we cannot recognize the received message as a string, we need to allocate a buffer and use the right size to receive it again.
            // Thus we need to release the buffer allocated by FormatMessage().
            // Note, when FORMAT_MESSAGE_ALLOCATE_BUFFER is used, lpBuffer effectively becomes pointer to pointer of string, i.e. char **
            win32Api.LocalFree(temp.deref());

            // UTF-16 is variable length character encoding, and since we only know number of TCHARs, it is not possible to know the exact number of bytes required.
            // However, a char in UTF-16 either takes 2 bytes or 4 bytes, so we can calculate the maximally possible number of bytes required.
            // Also add NULL terminator at the end, which is 2 bytes of zeros in UTF-16 encoding.
            size = size * 4 + 2;
            const errorText = Buffer.alloc(size);
            size = win32Api.FormatMessageW(
                Flags.FORMAT_MESSAGE_FROM_SYSTEM |     // Use system message tables to retrieve error text
                Flags.FORMAT_MESSAGE_IGNORE_INSERTS,   // Important! will fail otherwise, since we're not (and CANNOT) pass insertion parameters
                ref.NULL,
                errorCode,
                0,
                errorText,
                size,
                ref.NULL
            );

            if (size > 0) {
                return fromNullTerminatedWString(errorText);
            }
        }
 */
    }

    return '';
}

module.exports = getWindowsSystemErrorText;