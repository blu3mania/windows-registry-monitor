'use strict';

const ref = require('ref-napi');
const ffi = require('ffi-napi');

const {
    error,
    warning,
    info } = require('./print.js');
const {
    toNullTerminatedWString,
    fromWString } = require('./wstring.js');
const getWindowsSystemErrorText = require('./windows-system-error-text.js');

/** Root keys in Windows registry. */
const RootKey = {
    HKEY_CLASSES_ROOT: 0x80000000,
    HKCR: 0x80000000,
    HKEY_CURRENT_USER: 0x80000001,
    HKCU: 0x80000001,
    HKEY_LOCAL_MACHINE: 0x80000002,
    HKLM: 0x80000002,
    HKEY_USERS: 0x80000003,
    HKU: 0x80000003,
    HKEY_PERFORMANCE_DATA: 0x80000004,
    HKEY_PERFORMANCE_TEXT: 0x80000050,
    HKEY_PERFORMANCE_NLSTEXT: 0x80000060,
    HKEY_CURRENT_CONFIG: 0x80000005,
    HKCC: 0x80000005,
    HKEY_DYN_DATA: 0x80000006,
};

/** Windows registry value types. */
const RegistryValueType = {
    REG_NONE: 0,
    REG_SZ: 1,
    REG_EXPAND_SZ: 2,
    REG_BINARY: 3,
    REG_DWORD_LITTLE_ENDIAN: 4,
    REG_DWORD: 4,
    REG_DWORD_BIG_ENDIAN: 5,
    REG_LINK: 6,
    REG_MULTI_SZ: 7,
    REG_RESOURCE_LIST: 8,
    REG_FULL_RESOURCE_DESCRIPTOR: 9,
    REG_RESOURCE_REQUIREMENTS_LIST: 10,
    REG_QWORD_LITTLE_ENDIAN: 11,
    REG_QWORD: 11,
};

/** Windows registry access rights used by RegOpenKeyEx and RegCreateKeyEx APIs. */
const RegistryKeyAccessRight = {
    STANDARD_RIGHTS_READ: 0x20000,
    STANDARD_RIGHTS_WRITE: 0x20000,
    STANDARD_RIGHTS_EXECUTE: 0x20000,

    KEY_QUERY_VALUE: 0x1,
    KEY_SET_VALUE: 0x2,
    KEY_CREATE_SUB_KEY: 0x4,
    KEY_ENUMERATE_SUB_KEYS: 0x8,
    KEY_NOTIFY: 0x10,
    KEY_CREATE_LINK: 0x20,

    KEY_READ: 0x20019, // Combines the STANDARD_RIGHTS_READ, KEY_QUERY_VALUE, KEY_ENUMERATE_SUB_KEYS, and KEY_NOTIFY values.
    KEY_WRITE: 0x20006, // Combines the STANDARD_RIGHTS_WRITE, KEY_SET_VALUE, and KEY_CREATE_SUB_KEY access rights.
    KEY_EXECUTE: 0x20019, // Equivalent to KEY_READ.
    KEY_ALL_ACCESS: 0xF003F, // Combines the STANDARD_RIGHTS_REQUIRED, KEY_QUERY_VALUE, KEY_SET_VALUE, KEY_CREATE_SUB_KEY, KEY_ENUMERATE_SUB_KEYS, KEY_NOTIFY, and KEY_CREATE_LINK access rights.

    KEY_WOW64_32KEY: 0x0200,
    KEY_WOW64_64KEY: 0x0100,
};

/** Windows registry key creation options used by RegCreateKeyEx API. */
const RegistryKeyCreateOption = {
    REG_OPTION_BACKUP_RESTORE: 0x4,
    REG_OPTION_CREATE_LINK: 0x2,
    REG_OPTION_NON_VOLATILE: 0x0,
    REG_OPTION_VOLATILE: 0x1,
};

/** Windows registry notification filters used by RegNotifyChangeKeyValue API. */
const RegistryKeyNotifyFilter = {
    REG_NOTIFY_CHANGE_NAME: 0x1,
    REG_NOTIFY_CHANGE_ATTRIBUTES: 0x2,
    REG_NOTIFY_CHANGE_LAST_SET: 0x4,
    REG_NOTIFY_CHANGE_SECURITY: 0x8,
    REG_NOTIFY_THREAD_AGNOSTIC: 0x10000000,
};

/** Results returned from WaitForMultipleObjects API. */
const WaitForMultipleObjectsResult = {
    WAIT_OBJECT_0: 0x0,
    WAIT_ABANDONED_0: 0x80,
    WAIT_TIMEOUT: 0x102,
    WAIT_FAILED: 0xFFFFFFFF,
};

/** Various error codes returned by APIs that we care about. */
const ErrorCode = {
    KeyNotFound: 2,
    KeyMarkedForDeletion: 1018,
}

// Default interval for the timer used to check for monitor notification.
const DefaultMonitorCheckInterval = 100;

/**
 Define registry and event Windows APIs.
 Note, for Unicode version APIs, string parameters defined in ANSI version are replaced with pointer so buffers representing WString can be used since ref.types.CString doesn't handle wide char.
 */
const RegistryApi = ffi.Library('advapi32', {
    /*
    LSTATUS RegOpenKeyExA(
      [in]           HKEY   hKey,
      [in, optional] LPCSTR lpSubKey,
      [in]           DWORD  ulOptions,
      [in]           REGSAM samDesired,
      [out]          PHKEY  phkResult
    );

    Windows Data Type:
      typedef HANDLE HKEY;
      typedef PVOID HANDLE;
      typedef __nullterminated CONST CHAR *LPCSTR;
      typedef char CHAR;
      typedef unsigned long DWORD;
    */
    'RegOpenKeyExA': [ 'int', [ 'uint', 'string', 'uint', 'uint', 'pointer' ] ], // Use uint instead of pointer for HKEY hKey as we directly define root key handles' values

    /*
    LSTATUS RegOpenKeyExW(
      [in]           HKEY    hKey,
      [in, optional] LPCWSTR lpSubKey,
      [in]           DWORD   ulOptions,
      [in]           REGSAM  samDesired,
      [out]          PHKEY   phkResult
    );

    Windows Data Type:
      typedef CONST WCHAR *LPCWSTR;
      typedef wchar_t WCHAR;
    */
    'RegOpenKeyExW': [ 'int', [ 'uint', 'pointer', 'uint', 'uint', 'pointer' ] ],  // Use uint instead of pointer for HKEY hKey as we directly define root key handles' values, also use pointer instead of string for LPCWSTR lpSubKey

    /*
    LSTATUS RegCreateKeyExA(
      [in]            HKEY                        hKey,
      [in]            LPCSTR                      lpSubKey,
                      DWORD                       Reserved,
      [in, optional]  LPSTR                       lpClass,
      [in]            DWORD                       dwOptions,
      [in]            REGSAM                      samDesired,
      [in, optional]  const LPSECURITY_ATTRIBUTES lpSecurityAttributes,
      [out]           PHKEY                       phkResult,
      [out, optional] LPDWORD                     lpdwDisposition
    );

    Windows Data Type:
      typedef CHAR *LPSTR;
    */
    'RegCreateKeyExA': [ 'int', [ 'uint', 'string', 'uint', 'string', 'uint', 'uint', 'pointer', 'pointer', 'pointer' ] ], // Use uint instead of pointer for HKEY hKey as we directly define root key handles' values

    /*
    LSTATUS RegCreateKeyExW(
      [in]            HKEY                        hKey,
      [in]            LPCWSTR                     lpSubKey,
                      DWORD                       Reserved,
      [in, optional]  LPWSTR                      lpClass,
      [in]            DWORD                       dwOptions,
      [in]            REGSAM                      samDesired,
      [in, optional]  const LPSECURITY_ATTRIBUTES lpSecurityAttributes,
      [out]           PHKEY                       phkResult,
      [out, optional] LPDWORD                     lpdwDisposition
    );
    */
    'RegCreateKeyExW': [ 'int', [ 'uint', 'pointer', 'uint', 'pointer', 'uint', 'uint', 'pointer', 'pointer', 'pointer' ] ], // Use uint instead of pointer for HKEY hKey as we directly define root key handles' values, also use pointer instead of string for LPCWSTR lpSubKey and LPWSTR lpClass

    /*
    LSTATUS RegQueryValueExA(
      [in]                HKEY    hKey,
      [in, optional]      LPCSTR  lpValueName,
                          LPDWORD lpReserved,
      [out, optional]     LPDWORD lpType,
      [out, optional]     LPBYTE  lpData,
      [in, out, optional] LPDWORD lpcbData
    );

    Windows Data Type:
      typedef unsigned char BYTE;
    */
    'RegQueryValueExA': [ 'int', [ 'pointer', 'string', 'pointer', 'pointer', 'pointer', 'pointer' ] ],

    /*
    LSTATUS RegQueryValueExW(
      [in]                HKEY    hKey,
      [in, optional]      LPCWSTR lpValueName,
                          LPDWORD lpReserved,
      [out, optional]     LPDWORD lpType,
      [out, optional]     LPBYTE  lpData,
      [in, out, optional] LPDWORD lpcbData
    );
    */
    'RegQueryValueExW': [ 'int', [ 'pointer', 'pointer', 'pointer', 'pointer', 'pointer', 'pointer' ] ], // Use pointer instead of string for LPCWSTR lpValueName

    /*
    LSTATUS RegSetValueExA(
      [in]           HKEY       hKey,
      [in, optional] LPCSTR     lpValueName,
                     DWORD      Reserved,
      [in]           DWORD      dwType,
      [in]           const BYTE *lpData,
      [in]           DWORD      cbData
    );
    */
    'RegSetValueExA': [ 'int', [ 'pointer', 'string', 'uint', 'uint', 'pointer', 'uint' ] ],

    /*
    LSTATUS RegSetValueExW(
      [in]           HKEY       hKey,
      [in, optional] LPCWSTR    lpValueName,
                     DWORD      Reserved,
      [in]           DWORD      dwType,
      [in]           const BYTE *lpData,
      [in]           DWORD      cbData
    );
    */
    'RegSetValueExW': [ 'int', [ 'pointer', 'pointer', 'uint', 'uint', 'pointer', 'uint' ] ], // Use pointer instead of string for LPCWSTR lpValueName

    /*
    LSTATUS RegNotifyChangeKeyValue(
      [in]           HKEY   hKey,
      [in]           BOOL   bWatchSubtree,
      [in]           DWORD  dwNotifyFilter,
      [in, optional] HANDLE hEvent,
      [in]           BOOL   fAsynchronous
    );

    Windows Data Type:
      typedef int BOOL;
    */
    'RegNotifyChangeKeyValue': [ 'int', [ 'pointer', 'int', 'uint', 'pointer', 'int' ] ],

    /*
    LSTATUS RegCloseKey(
      [in] HKEY hKey
    );
    */
    'RegCloseKey': [ 'int', [ 'pointer' ] ],
});

const EventApi = ffi.Library('kernel32', {
    /*
    HANDLE CreateEventA(
      [in, optional] LPSECURITY_ATTRIBUTES lpEventAttributes,
      [in]           BOOL                  bManualReset,
      [in]           BOOL                  bInitialState,
      [in, optional] LPCSTR                lpName
    );
    */
    'CreateEventA': [ 'pointer', [ 'pointer', 'int', 'int', 'string' ] ],

    /*
    HANDLE CreateEventW(
      [in, optional] LPSECURITY_ATTRIBUTES lpEventAttributes,
      [in]           BOOL                  bManualReset,
      [in]           BOOL                  bInitialState,
      [in, optional] LPCWSTR               lpName
    );
    */
    'CreateEventW': [ 'pointer', [ 'pointer', 'int', 'int', 'pointer' ] ], // Use pointer instead of string for LPCWSTR lpName

    /*
    DWORD WaitForSingleObject(
      [in] HANDLE hHandle,
      [in] DWORD  dwMilliseconds
    );
    */
    'WaitForSingleObject': [ 'uint', [ 'pointer', 'uint' ] ],

    /*
    DWORD WaitForMultipleObjects(
      [in] DWORD        nCount,
      [in] const HANDLE *lpHandles,
      [in] BOOL         bWaitAll,
      [in] DWORD        dwMilliseconds
    );
    */
    'WaitForMultipleObjects': [ 'uint', [ 'uint', 'pointer', 'int', 'uint' ] ],

    /*
    BOOL CloseHandle(
      [in] HANDLE hObject
    );
    */
    'CloseHandle': [ 'int', [ 'pointer' ] ],
});

/** Finalizer for RegistryKey to ensure the underlying registry key handle is closed. */
const RegistryKeyFinalizer = new FinalizationRegistry(registryKeyData => {
    if (registryKeyData.handle !== null) {
        warning(`RegistryKey ${registryKeyData.path} is not properly closed! You should call RegistryKey.close() or Registry.closeKey() to close a key when it is no longer needed!`);
        Registry.instance.closeKeyInternal(registryKeyData);
    }
});

/** Finalizer for MonitoredRegistryKey to ensure the underlying event handle is closed. */
const MonitoredRegistryKeyFinalizer = new FinalizationRegistry(monitorData => {
    if (monitorData.waitHandle !== null) {
        warning(`MonitoredRegistryKey ${registryKeyData.path} is not properly stopped! You should call Registry.stopMonitor() to stop monitoring a key when it is no longer needed!`);
        Registry.instance.stopMonitoredKeyInternal(monitorData);
    }
});

/** Finalizer for MonitorToken to ensure the callback is unregistered. */
const MonitorTokenFinalizer = new FinalizationRegistry(tokenData => {
    if (!tokenData.calback !== null) {
        warning(`MonitorToken on key ${tokenData.path} is not properly removed! You should call MonitorToken.stop() or Registry.stopMonitor() to stop monitoring a key when it is no longer needed!`);
        Registry.instance.stopMonitorInternal(tokenData);
    }
});

/**
 * Prints a Windows error message in console.
 * @param {string} errorMsg - The message to be printed.
 * @param {integer} errorCode - Windows system error code as defined at https://docs.microsoft.com/en-us/windows/win32/debug/system-error-codes.
 */
function printWindowsError(errorMsg, errorCode) {
    if (Registry.instance.loggingEnabled) {
        error(`${errorMsg}\r\nError code ${errorCode}: ${getWindowsSystemErrorText(errorCode)}`);
    }
}

/** Representing a registry key in Windows Registry. */
class RegistryKey {
    /**
     * Constructor. Should not be used directly, but use Registry.openKey() to create one.
     * @param {string} path - The registry key path.
     * @param {boolean} createIfNeeded - (Optional) Whether to create the key if it doesn't exist. Note that it requires appropriate privileges to be able to create key(s).
     *                                   If not provided, default value false is used.
     * @param {boolean} readonly - (Optional) Whether the handle is used for readonly operation(s) which requires less privilege, or read-write operation(s), which requires more privileges.
     *                             The value is ignored and hardcoded to be false if createIfNeeded is true.
     *                             If not provided and createIfNeeded is false, default value false is used.
     */
    constructor(path, createIfNeeded = false, readonly = true) {
        this.keyData = {
            path: path,
            handle: null,
        };

        this.createIfNeeded = createIfNeeded;
        if (createIfNeeded && readonly) {
            readonly = false;
        }
        this.readonly = readonly;

        this.open();

        // Register this key in finalizer so we can be alerted if it's not properly closed
        RegistryKeyFinalizer.register(this, this.keyData);
    }

    /**
     * @return {object} Predefined registry root keys.
     */
    static get Root() {
        return RootKey;
    }

    /**
     * @return {boolean} Whether this key is valid.
     */
    get isValid() {
        return this.keyData.handle !== null;
    }

    /**
     * Opens (i.e. obtains) handle to the key.
     * Note: make sure to call close() when this key is no longer needed. Otherwise the finalizer will complain (though, the finalizer will still properly close the key handle).
     * @return {boolean} Whether the handle is opened. Note: the handle may have already been opened previously, in which case this method still returns true.
     */
    open() {
        if (this.keyData.handle !== null) {
            // Already opened
            return true;
        }

        const { rootKey, subKey } = this.parsePath();
        if (rootKey !== null) {
            const accessRight = this.readonly ? RegistryKeyAccessRight.KEY_READ : RegistryKeyAccessRight.KEY_READ | RegistryKeyAccessRight.KEY_WRITE;
            const hkeyHandle = ref.alloc('pointer');
            const result = RegistryApi.RegOpenKeyExW(RootKey[rootKey], subKey, 0, accessRight, hkeyHandle);
            if (result === 0) {
                this.keyData.handle = hkeyHandle.deref();
            } else if (result === ErrorCode.KeyNotFound) {
                return this.create();
            } else {
                printWindowsError(`Cannot open key "${this.keyData.path}" for ${this.readonly ? 'reading' : 'read-writing'}!`, result);
                return false;
            }
        } else {
            if (Registry.instance.loggingEnabled) {
                error(`Invalid key "${this.keyData.path}". "${rootKey}" is not a predefined Windows registry root key!`);
            }
            return false;
        }

        return true;
    }

    /**
     * Reopens the key.
     * @return {boolean} Whether the handle is opened.
     */
    reopen() {
        if (this.close()) {
            return this.open();
        } else if (Registry.instance.loggingEnabled) {
            error(`Cannot reopen key "${this.keyData.path}" as previous handle cannot be closed!`);
        }

        return false;
    }

    /**
     * Creates the key. Note, it requires appropriate privileges to be able to create key.
     * @return {boolean} Whether the handle is opened.
     */
    create() {
        if (!this.createIfNeeded) {
            // Not allowed to create key
            if (Registry.instance.loggingEnabled) {
                warning(`Cannot create key: "${this.keyData.path}" as createIfNeeded is not set`);
            }
            return false;
        }

        if (this.keyData.handle !== null) {
            // Already opened. Close so we can try creating teh key
            if (!this.close()) {
                return false;
            }
        }

        const { rootKey, subKey } = this.parsePath();
        if (rootKey !== null) {
            const accessRight = RegistryKeyAccessRight.KEY_READ | RegistryKeyAccessRight.KEY_WRITE;
            const hkeyHandle = ref.alloc('pointer');
            const result = RegistryApi.RegCreateKeyExW(RootKey[rootKey], subKey, 0, ref.NULL, RegistryKeyCreateOption.REG_OPTION_NON_VOLATILE, accessRight, ref.NULL, hkeyHandle, ref.NULL);
            if (result === 0) {
                info(`Key "${this.keyData.path}" didn't exist. Created.`);
                this.keyData.handle = hkeyHandle.deref();
            } else {
                printWindowsError(`Cannot create key "${this.keyData.path}"!`, result);
                return false;
            }
        }

        return true;
    }

    /**
     * Closes the key's handle.
     * @return {boolean} Whether the handle is closed or not. Note: the handle may have already been closed previously, in which case this method still returns true.
     */
    close() {
        if (this.keyData.handle !== null) {
            Registry.instance.closeKeyInternal(this.keyData);
        }
        return this.keyData.handle === null;
    }

    /**
     * Retrieves the data for the specified value name.
     * @param {string} name - The name of the value to be retrieved.
     * @return {any} Retrieved value, which is in a type that depends on the Value Type stored in the registry:
     *               REG_DWORD/REG_QWORD:  unsigned integer
     *               REG_SZ/REG_EXPAND_SZ: string
     *               REG_MULTI_SZ:         string[]
     *               REG_BINARY:           Buffer
     */
    getValue(name) {
        let value = null;
        if (this.keyData.handle !== null) {
            const wstrName = toNullTerminatedWString(name);
            const size = ref.alloc('int');
            let result = this.invokeApiWithRetry(() => RegistryApi.RegQueryValueExW(this.keyData.handle, wstrName, ref.NULL, ref.NULL, ref.NULL, size));
            if (result === 0) {
                const buffer = Buffer.alloc(size.deref());
                const valueType = ref.alloc('int');
                result = this.invokeApiWithRetry(() => RegistryApi.RegQueryValueExW(this.keyData.handle, wstrName, ref.NULL, valueType, buffer, size));
                if (result === 0) {
                    switch (valueType.deref()) {
                        case RegistryValueType.REG_DWORD:
                            // Value is expected as unsigned integer
                            value = buffer.readUInt32LE();
                            break;

                        case RegistryValueType.REG_QWORD:
                            // Value is expected as unsigned integer
                            value = buffer.readUInt64LE();
                            break;

                        case RegistryValueType.REG_SZ:
                        case RegistryValueType.REG_EXPAND_SZ:
                            // Value is expected as string
                            value = fromWString(buffer);
                            break;

                        case RegistryValueType.REG_MULTI_SZ:
                            // Value is expected as string[]
                            value = [];
                            let currentStringStart = 0;
                            let i = 2;
                            while (i < buffer.length - 2) { // Ignore the final/extra NULL terminator that ends the whole sequence
                                // In UTF-16 encoding, a NULL terminator is 2 bytes of zeros
                                if (buffer[i] === 0 && buffer[i + 1] === 0) {
                                    value.push(fromWString(buffer, currentStringStart, i));
                                    currentStringStart = i + 2;
                                    i = currentStringStart;
                                }
                                i += 2;
                            }
                            break;

                        case RegistryValueType.REG_BINARY:
                            // Value is expected as Buffer
                            value = buffer;
                            break;

                        default:
                            if (Registry.instance.loggingEnabled) {
                                error(`Value "${name}" of key "${this.keyData.path}" has a type ${valueType.deref()}, which is not supported!`);
                            }
                            return null;
                    }
                } else {
                    printWindowsError(`Cannot read value "${name}" of key "${this.keyData.path}"!`, result);
                }
            } else {
                printWindowsError(`Cannot read value "${name}" of key "${this.keyData.path}" to find out its size!`, result);
            }
        } else if (Registry.instance.loggingEnabled) {
            error(`Trying to read value "${name}" of key "${this.keyData.path}" without obtaining a valid handle!`);
        }

        return value;
    }

    /**
     * Sets the data (and optionally type) for the specified value name.
     * @param {string} name - The name of the value to be set.
     * @param {any} value - The data of the value to be set, which needs to be in a type that corresponds to the type param (if provided), or the Value Type stored in the registry:
     *                      REG_DWORD/REG_QWORD:  unsigned integer
     *                      REG_SZ/REG_EXPAND_SZ: string
     *                      REG_MULTI_SZ:         string[]
     *                      REG_BINARY:           Buffer
     * @param {RegistryValueType} type - (Optional) The type of the value to be set.
     *                                   If provided, it determines the type to be stored in the registry, and also dictates the type of the value param.
     *                                   If not provided, the the Value Type stored in the registry is used. In this case the value has to already exist in the registry.
     * @return {boolean} Whether the operation succeeded.
     */
    setValue(name, value, type) {
        let success = false;
        if (this.keyData.handle !== null) {
            const wstrName = toNullTerminatedWString(name);
            if (!type) {
                type = this.getValueType(name);
                if (type === RegistryValueType.REG_NONE) {
                    return false;
                }
            }

            let size = 0;
            let data = null;
            switch (type) {
                case RegistryValueType.REG_DWORD:
                    // Value is expected as unsigned integer
                    size = 4;
                    data = Buffer.alloc(size);
                    data.writeUInt32LE(value);
                    break;

                case RegistryValueType.REG_QWORD:
                    // Value is expected as unsigned integer
                    size = 8;
                    data = Buffer.alloc(size);
                    data.writeUInt64LE(value);
                    break;

                case RegistryValueType.REG_SZ:
                case RegistryValueType.REG_EXPAND_SZ:
                    // Value is expected as string
                    data = toNullTerminatedWString(value);
                    size = data.length;
                    break;

                case RegistryValueType.REG_MULTI_SZ:
                    // Value is expected as string[]
                    const wstrings = value.map(str => toNullTerminatedWString(str));
                    size = wstrings.reduce((sum, wstring) => sum + wstring.length, 0) + 2; // Add the final/extra NULL terminator that ends the sequence
                    data = Buffer.alloc(size);
                    let pos = 0;
                    wstrings.forEach(wstring => {
                        wstring.copy(data, pos);
                        pos += wstring.length;
                    });
                    break;

                case RegistryValueType.REG_BINARY:
                    // Value is expected as Buffer
                    data = value;
                    size = data.length;
                    break;

                default:
                    if (Registry.instance.loggingEnabled) {
                        error(`Value "${name}" of key "${this.keyData.path}" with type ${valueType.deref()} is not supported!`);
                    }
                    return false;
            }

            const result = this.invokeApiWithRetry(() => RegistryApi.RegSetValueExW(this.keyData.handle, wstrName, 0, type, data, size));
            if (result === 0) {
                success = true;
            } else {
                printWindowsError(`Cannot set value "${name}" of key "${this.keyData.path}"!`, result);
            }
        } else if (Registry.instance.loggingEnabled) {
            error(`Trying to set value "${name}" of key "${this.keyData.path}" without obtaining a valid handle!`);
        }

        return success;
    }

    /**
     * Retrieves the type of the data for the specified value name.
     * @param {string} name - The name of the value.
     * @return {RegistryValueType} Retrieved value data type.
     */
    getValueType(name) {
        if (this.keyData.handle !== null) {
            const wstrName = toNullTerminatedWString(name);
            const valueType = ref.alloc('int');
            const result = this.invokeApiWithRetry(() => RegistryApi.RegQueryValueExW(this.keyData.handle, wstrName, ref.NULL, valueType, ref.NULL, ref.NULL));
            if (result === 0) {
                return valueType.deref();
            } else {
                printWindowsError(`Cannot read value "${name}" of key "${this.keyData.path}" to find out its type!`, result);
            }
        } else if (Registry.instance.loggingEnabled) {
            error(`Trying to get value type of "${name}" of key "${this.keyData.path}" without obtaining a valid handle!`);
        }

        return RegistryValueType.REG_NONE;
    }

    /**
     * Checks whether a value exists with the specified value name.
     * @param {string} name - The name of the value to be checked.
     * @return {boolean} Whether the specified value exists
     */
    checkValueExistence(name) {
        if (this.keyData.handle !== null) {
            const wstrName = toNullTerminatedWString(name);
            const result = this.invokeApiWithRetry(() => RegistryApi.RegQueryValueExW(this.keyData.handle, wstrName, ref.NULL, ref.NULL, ref.NULL, ref.NULL));
            if (result === 0) {
                return true;
            } else if (result === ErrorCode.KeyNotFound) {
                return false;
            } else {
                printWindowsError(`Cannot check the existence of "${name}" of key "${this.keyData.path}"!`, result);
            }
        } else if (Registry.instance.loggingEnabled) {
            error(`Trying to check the existence of "${name}" of key "${this.keyData.path}" without obtaining a valid handle!`);
        }

        return false;
    }

    /** Private method: parses key path. */
    parsePath() {
        const pathParts = this.keyData.path.split('\\');
        let rootKey = pathParts[0].toUpperCase();
        if (rootKey.endsWith(':')) {
            // Handle the case when it is in a format like HKLM:\subkey
            rootKey = rootKey.slice(0, -1);
        }

        if (RootKey.hasOwnProperty(rootKey)) {
            return { rootKey: rootKey, subKey: toNullTerminatedWString(pathParts.slice(1).join('\\')) };
        } else {
            if (Registry.instance.loggingEnabled) {
                error(`Invalid key "${this.keyData.path}". "${rootKey}" is not a predefined Windows registry root key!`);
            }
            return { rootKey: null, subKey: null };
        }
    }

    /** Private method: invokes an API with retries. */
    invokeApiWithRetry(invokeApi, numRetries = 1) {
        ++numRetries; // The first try does not count as "retry"
        let result = 0;
        while (numRetries-- > 0) {
            result = invokeApi();
            if (result === ErrorCode.KeyMarkedForDeletion) {
                // Key was deleted. Reopen the key and retry
                if (Registry.instance.loggingEnabled) {
                    warning(`Key "${this.keyData.path}" was deleted. Trying to reopen the key and execute again...`);
                }
                this.reopen();
            } else {
                // Success or error that cannot be handled
                break;
            }
        }

        return result;
    }
}

/** Private class. Representing a monitored registry key in Windows Registry. */
class MonitoredRegistryKey extends RegistryKey {
    /**
     * Constructor. Should not be used directly, but use Registry.monitorXXX() to create one.
     * @param {string} path - The registry key path.
     * @param {boolean} recursive - Whether to monitor sub-keys recursively.
     * @param {boolean} createIfNeeded - Whether to create the key if it doesn't exist. Note that it requires appropriate privileges to be able to create key(s).
     * @param {function} callback - The callback to be added.
     */
    constructor(path, recursive, createIfNeeded, callback) {
        super(path, createIfNeeded);
        this.monitorData = {
            path: path,
            recursive: recursive,
            waitHandle: null,
        };

        this.callbacks = [];
        this.addCallback(callback);
        this.start();

        // Register this key in finalizer so we can be alerted if it's not properly stopped
        MonitoredRegistryKeyFinalizer.register(this, this.monitorData);
    }

    /**
     * @return {boolean} Whether this key is valid.
     */
    get isValid() {
        return super.isValid && this.monitorData.waitHandle !== null;
    }

    /**
     * Starts monitoring.
     * Note: make sure to call stop() when this key is no longer needed to be monitored. Otherwise the finalizer will complain (though, the finalizer will still properly stop the monitor).
     * @return {boolean} Whether the monitor is started. Note: the monitor may have already been started previously, in which case this method still returns true.
     */
    start() {
        if (this.monitorData.waitHandle !== null) {
            // Already started
            return true;
        }

        if (super.isValid) {
            this.monitorData.waitHandle = EventApi.CreateEventW(
                ref.NULL, // Use default security descriptor
                0, // Use auto-reset behavior
                0, // Initial state is unset
                ref.NULL // No need to assign a name as Registry class is making sure there is only one monitor per key path
            );
            if (ref.isNull(this.monitorData.waitHandle)) {
                this.monitorData.waitHandle = null;
                if (Registry.instance.loggingEnabled) {
                    error(`Cannot create wait handle to monitor key "${this.keyData.path}"`);
                }
                return false;
            }

            return this.registerForNotification();
        }

        return false;
    }

    /**
     * Stops monitoring.
     * @return {boolean} Whether the monitor is stopped. Note: the monitor may have already been stopped previously, in which case this method still returns true.
     */
    stop() {
        if (this.monitorData.waitHandle === null) {
            // Already stopped
            this.callbacks = [];
            return true;
        }

        Registry.instance.stopMonitoredKeyInternal(this.monitorData);
        if (this.monitorData.waitHandle === null) {
            this.callbacks = [];
            return true;
        }

        return false;
    }

    /**
     * Adds a callback.
     * @param {function} callback - The callback to be added. It will receive this MonitoredRegistryKey as parameter.
     */
    addCallback(callback) {
        if (callback) {
            this.callbacks.push(callback);
        }
    }

    /**
     * Removes a callback.
     * @param {function} callback - The callback to be removed.
     * @return {boolean} Whether the operation is successful.
     */
    removeCallback(callback) {
        const index = this.callbacks.indexOf(callback);
        if (index >= 0) {
            this.callbacks.splice(index, 1);

            if (this.callbacks.length === 0) {
                // No need to monitor this key anymore
                return this.stop() && this.close();
            }

            return true;
        } else {
            return false;
        }
    }

    /**
     * Reopens the key.
     * @return {boolean} Whether the handle is opened.
     */
    reopen() {
        if (super.reopen()) {
            if (this.isValid) {
                // Re-register for notification since the underlying key handle is changed.
                // Note, the same wait handle is reused as there is no need to change it, and changing it also means Registry.updateMonitoredKeysArray() needs to be invoked
                return this.registerForNotification();
            }
        }

        return false;
    }

    /**
     * Called when monitored key triggers.
     */
    onMonitorTriggered() {
        // Register for change notification again (RegNotifyChangeKeyValue only triggers once)
        this.registerForNotification();

        // Notify all clients
        this.callbacks.forEach((callback) => callback(this));
    }

    /** Private method: registers for notification from change event on the key. */
    registerForNotification() {
        const result = RegistryApi.RegNotifyChangeKeyValue(
            this.keyData.handle,
            this.monitorData.recursive ? 1 : 0,
            this.monitorData.recursive ? (RegistryKeyNotifyFilter.REG_NOTIFY_CHANGE_LAST_SET | RegistryKeyNotifyFilter.REG_NOTIFY_CHANGE_NAME) : RegistryKeyNotifyFilter.REG_NOTIFY_CHANGE_LAST_SET,
            this.monitorData.waitHandle,
            1 // Use async behavior
        );
        if (result === ErrorCode.KeyMarkedForDeletion) {
            // Key was deleted. Reopen the key, which would call this method again
            warning(`Key "${this.monitorData.path}" was deleted. Trying to reopen the key and register for notification again...`);
            this.reopen();
        } else if (result !== 0) {
            printWindowsError(`Cannot register for notification on key "${this.monitorData.path}"!`, result);
            return false;
        } else {
            return true;
        }
    }
}

/** Representing a token that can be used to stop monitoring later on. */
class MonitorToken {
    /**
     * Constructor. Should not be used directly, but use Registry.monitorKey() to create one.
     * @param {string} path - The registry key path.
     * @param {boolean} recursive - Whether to monitor sub-keys recursively.
     * @param {function} callback - The callback function to be invoked when changes in the key happen.
     */
    constructor(path, recursive, callback) {
        this.tokenData = {
            path: path,
            recursive: recursive,
            callback: callback,
        };

        // Register this token in finalizer so we can be alerted if it's not properly stopped
        MonitorTokenFinalizer.register(this, this.tokenData);
    }

    /**
     * Stops monitoring.
     * @return {boolean} Whether the callback is stopped. Note: the callback may have already been stopped previously, in which case this method still returns true.
     */
    stop() {
        Registry.instance.stopMonitorInternal(this.tokenData);
        return this.tokenData.callback === null;
    }
}

/** Representing a Windows Registry object. */
class Registry {
    static instance;
    static instanceCreated;
    static {
        this.instance = new Registry();
        this.instanceCreated = true;
    }

    /**
     * Private constructor.
     */
    constructor() {
        if (Registry.instanceCreated) {
            throw new Error("Registry is using singleton pattern. Please use Registry.instance to access.");
        }

        this.monitoredKeys = {};
        this.monitoredRecursiveKeys = {};
        this.checkInterval = DefaultMonitorCheckInterval;
        this.checkTimer = null;
        this.logging = true;
    }

    /**
     * @return {object} Registry value types.
     */
    static get ValueType() {
        return RegistryValueType;
    }

    /**
     * Sets monitor check interval.
     * @param {integer} interval - Monitor check interval in millisecond.
     */
    set monitorCheckInterval(interval) {
        this.checkInterval = interval;
        if (this.checkTimer !== null) {
            this.stopMonitorTimer();
            this.startMonitorTimer();
        }
    }

    /**
     * Disables error/warning logging.
     */
    disabelLogging() {
        this.logging = false;
    }

    /**
     * @return {object} Registry value types.
     */
    get loggingEnabled() {
        return this.logging;
    }

    /**
     * Obtains a handle to a registry key.
     * Note: make sure the returned RegistryKey object is closed when it is no longer needed. Otherwise the finalizer will complain (though, the finalizer will still properly close the key handle).
     * @param {string} path - The registry key path.
     * @param {boolean} createIfNeeded - (Optional) Whether to create the key if it doesn't exist. Note that it requires appropriate privileges to be able to create key(s).
     *                                   If not provided, default value false is used.
     * @param {boolean} readonly - (Optional) Whether the handle is used for readonly operation(s) which requires less privilege, or read-write operation(s), which requires more privileges.
     *                             The value is ignored and hardcoded to be false if createIfNeeded is true.
     *                             If not provided and createIfNeeded is false, default value false is used.
     * @return {RegistryKey} Obtained key handle wrapped in a RegistryKey.
     */
    openKey(path, createIfNeeded = false, readonly = true) {
        const key = new RegistryKey(path, createIfNeeded, readonly);
        if (key.isValid) {
            return key;
        }

        return null;
    }

    /**
     * Closes a key handle.
     * @param {RegistryKey} key - The key handle to be closed.
     * @return {boolean} Whether the handle is closed or not. Note: the handle may have already been closed previously, in which case this method still returns true.
     */
    closeKey(key) {
        return this.closeKeyInternal(key.keyData);
    }

    /** Private method: closes a key using its internal data structure. */
    closeKeyInternal(keyData) {
        if (keyData.handle !== null) {
            const result = RegistryApi.RegCloseKey(keyData.handle);
            if (result !== 0) {
                printWindowsError(`Cannot close key "${keyData.path}}"!`, result);
                return false;
            } else {
                keyData.handle = null;
            }
        } else if (this.loggingEnabled) {
            warning(`Key "${keyData.path}}" was already closed.`);
        }

        return true;
    }

    /**
     * Retrieves the data for the specified key path and value name.
     * @param {string} path - The registry key path.
     * @param {string} name - The name of the value to be retrieved.
     * @return {any} Retrieved value, which is in a type that depends on the Value Type stored in the registry:
     *               REG_DWORD/REG_QWORD:  integer
     *               REG_SZ/REG_EXPAND_SZ: string
     *               REG_MULTI_SZ:         string[]
     *               REG_BINARY:           Buffer
     */
    getValue(path, name) {
        let value = null;
        const key = this.openKey(path);
        if (key !== null) {
            value = key.getValue(name);
            this.closeKey(key);
        }
        return value;
    }

    /**
     * Sets the data (and optionally type) for the specified key path and value name.
     * @param {string} path - The registry key path.
     * @param {string} name - The name of the value to be set.
     * @param {any} value - The data of the value to be set, which needs to be in a type that corresponds to the type param (if provided), or the Value Type stored in the registry:
     *                      REG_DWORD/REG_QWORD:  integer
     *                      REG_SZ/REG_EXPAND_SZ: string
     *                      REG_MULTI_SZ:         string[]
     *                      REG_BINARY:           Buffer
     * @param {RegistryValueType} type - (Optional) The type of the value to be set.
     *                                   If provided, it determines the type to be stored in the registry, and also dictates the type of the value param.
     *                                   If not provided, the the Value Type stored in the registry is used. In this case the value has to already exist in the registry.
     * @return {boolean} Whether the operation succeeded.
     */
    setValue(path, name, value, type) {
        let success = false;
        const key = this.openKey(path, true, false);
        if (key !== null) {
            success = key.setValue(name, value, type);
            this.closeKey(key);
        }
        return success;
    }

    /**
     * Retrieves the type of the data for the specified key path and value name.
     * @param {string} path - The registry key path.
     * @param {string} name - The name of the value.
     * @return {RegistryValueType} Retrieved value data type.
     */
    getValueType(path, name) {
        let valueType = RegistryValueType.REG_NONE;
        const key = this.openKey(path);
        if (key !== null) {
            valueType = key.getValueType(name);
            this.closeKey(key);
        }
        return valueType;
    }

    /**
     * Checks whether a value exists with the specified key path and value name.
     * @param {string} path - The registry key path.
     * @param {string} name - The name of the value to be checked.
     * @return {boolean} Whether the specified value exists
     */
    checkValueExistence(path, name) {
        let exists = false;
        const key = this.openKey(path);
        if (key !== null) {
            exists = key.checkValueExistence(name);
            this.closeKey(key);
        }
        return exists;
    }

    /**
     * Starts monitoring a key for any value changes under the key. Sub-keys/sub-tree changes are not supported.
     * Note: make sure to call stopMonitor() when this key is no longer needed to be monitored. Otherwise the finalizer will complain (though, the finalizer will still properly stop the monitor).
     * @param {string} path - The registry key path.
     * @param {boolean} recursive - Whether to monitor sub-keys recursively.
     * @param {boolean} createIfNeeded - Whether to create the key if it doesn't exist. Note that it requires appropriate privileges to be able to create key(s).
     * @param {function} callback - The callback when change happens. It will receive MonitoredRegistryKey instance as parameter.
     * @return {MonitorToken} A token that can used later on to stop monitoring. If the operation fails, null is returned.
     */
     monitorKey(path, recursive, createIfNeeded, callback) {
        // Check if the key's path is already monitored
        let key = recursive ? this.monitoredRecursiveKeys[path] : this.monitoredKeys[path];
        if (key) {
            if (key.isValid) {
                key.addCallback(callback);
            } else {
                if (this.loggingEnabled) {
                    warning(`Currently monitored key "${path}" is no longer valid. Creating a new one to replace.`);
                }
                key = null;
            }
        }

        if (!key) {
            key = new MonitoredRegistryKey(path, recursive, createIfNeeded, callback);
            if (key.isValid) {
                // Add this key's path in map
                if (recursive) {
                    this.monitoredRecursiveKeys[path] = key;
                } else {
                    this.monitoredKeys[path] = key;
                }

                // And also update the handle array used in WaitForMultipleObjects call
                this.updateMonitoredKeysArray();
            } else {
                key.stop();
                key = null;
            }
        }

        if (key) {
            this.startMonitorTimer();
            return new MonitorToken(path, recursive, callback);
        }

        return null;
     }

    /**
     * Starts monitoring a value for any value changes that make it different than compare value.
     * Note: make sure to call stopMonitor() when this key is no longer needed to be monitored. Otherwise the finalizer will complain (though, the finalizer will still properly stop the monitor).
     * @param {string} path - The registry key path.
     * @param {string} name - The name of the value to be set.
     * @param {string} compareValue - The value to be compared with. If null is passed in, any value change would trigger the callback.
     * @param {boolean} createIfNeeded - Whether to create the key if it doesn't exist. Note that it requires appropriate privileges to be able to create key(s).
     * @param {function} callback - The callback when change happens.  It will receive the monitored key itself, plus current and compare value as parameter.
     * @return {MonitorToken} A token that can used later on to stop monitoring. If the operation fails, null is returned.
     */
    monitorValue(path, name, compareValue, createIfNeeded, callback) {
        const getValueType = ((monitorToken, monitoredKey) => {
            // Get value type
            monitorToken.valueType = monitoredKey.getValueType(name);
            if (monitorToken.valueType === RegistryValueType.REG_NONE) {
                // Cannot get value type from name
                this.stopMonitor(monitorToken);
                monitorToken = null;
                return false;
            } else if (monitorToken.valueType !== RegistryValueType.REG_DWORD &&
                       monitorToken.valueType !== RegistryValueType.REG_QWORD &&
                       monitorToken.valueType !== RegistryValueType.REG_SZ &&
                       monitorToken.valueType !== RegistryValueType.REG_EXPAND_SZ &&
                       monitorToken.valueType !== RegistryValueType.REG_MULTI_SZ &&
                       monitorToken.valueType !== RegistryValueType.REG_BINARY) {
                throw new Error(`Value "${name}" of key "${path}" with type ${monitorToken.valueType} is not supported!`);
            }

            return true;
        });

        const monitorToken = this.monitorKey(path, false, createIfNeeded, (monitoredKey) => {
            let valueChanged = false;
            const currentValue = monitoredKey.getValue(name);
            if (!monitorToken.valueExists) {
                if (currentValue !== null) {
                    monitorToken.valueExists = true;
                    valueChanged = true;

                    // Value created, get the type and update compareValue if needed
                    if (getValueType(monitorToken, monitoredKey) && monitorToken.trackCurrentValue) {
                        compareValue = currentValue;
                    }
                }
            } else {
                valueChanged = !this.checkValue(currentValue, compareValue, monitorToken.valueType);
            }

            if (valueChanged) {
                callback(monitoredKey, currentValue, compareValue);
                if (monitorToken.trackCurrentValue) {
                    compareValue = currentValue;
                }
            }
        });

        if (monitorToken !== null) {
            monitorToken.trackCurrentValue = (compareValue === null);

            // Check value existence
            const monitoredKey = this.monitoredKeys[path];
            monitorToken.valueExists = monitoredKey.checkValueExistence(name);
            if (monitorToken.valueExists && getValueType(monitorToken, monitoredKey)) {
                if (monitorToken.trackCurrentValue) {
                    compareValue = monitoredKey.getValue(name);
                    if (compareValue === null) {
                        // Cannot read value from name
                        this.stopMonitor(monitorToken);
                        monitorToken = null;
                    }
                } else {
                    // Perform initial check to make sure current value is the same as compareValue
                    const currentValue = monitoredKey.getValue(name);
                    if (!this.checkValue(currentValue, compareValue, monitorToken.valueType)) {
                        callback(monitoredKey, currentValue, compareValue);
                    }
                }
            }
        }

        return monitorToken;
     }

    /**
     * Stops monitoring a key with given token.
     * @param {MonitorToken} monitorToken - The monitor token.
     * @return {boolean} Whether the handle is closed or not. Note: the handle may have already been closed previously, in which case this method still returns true.
     */
    stopMonitor(monitorToken) {
        return this.stopMonitorInternal(monitorToken.tokenData);
    }

    /** Private method: stops monitoring a key with a given token using its internal data structure. */
    stopMonitorInternal(tokenData) {
        if (tokenData.callback !== null) {
            const monitoredKey = tokenData.recursive ? this.monitoredRecursiveKeys[tokenData.path] : this.monitoredKeys[tokenData.path];
            if (monitoredKey) {
                if (!monitoredKey.removeCallback(tokenData.callback)) {
                    return false;
                }
            } else if (this.loggingEnabled) {
                warning(`It seems key "${tokenData.path}}" is not being monitored.`);
            }

            tokenData.callback = null;
        } else if (this.loggingEnabled) {
            warning(`Monitored token with key "${tokenData.path}}" was already stopped.`);
        }

        return true;
    }

    /** Private method: stops monitoring a key using its internal data structure. */
    stopMonitoredKeyInternal(monitorData) {
        if (monitorData.waitHandle !== null) {
            const result = EventApi.CloseHandle(monitorData.waitHandle);
            if (result === 0) {
                if (this.loggingEnabled) {
                    error(`Cannot close wait handle for monitored key "${this.keyData.path}"`);
                }
                return false;
            } else {
                monitorData.waitHandle = null;

                // Remove it from monitored keys map.
                if (monitorData.recursive) {
                    delete this.monitoredRecursiveKeys[monitorData.path];
                } else {
                    delete this.monitoredKeys[monitorData.path];
                }
                this.updateMonitoredKeysArray();
            }
        } else if (this.loggingEnabled) {
            warning(`MonitoredKey "${keyData.path}}" was already stopped.`);
        }

        return true;
    }

    /** Private method: starts monitor timer. */
    startMonitorTimer() {
        if (this.checkTimer === null) {
            this.checkTimer = setInterval(this.monitorCheck.bind(this), this.checkInterval);
        }
    }

    /** Private method: stops monitor timer. */
    stopMonitorTimer() {
        if (this.checkTimer !== null) {
            clearTimeout(this.checkTimer);
            this.checkTimer = null;
        }
    }

    /** Private method: checks to see if any monitored key notified. */
    monitorCheck() {
        while (true) {
             const result = EventApi.WaitForMultipleObjects(
                this.monitoredKeysArray.length,
                this.monitoredKeyHandlesBuffer,
                0, // Wait for any
                0 // Do not wait
            );

            if (result === WaitForMultipleObjectsResult.WAIT_FAILED) {
                if (this.loggingEnabled) {
                    error('monitorCheck: WaitForMultipleObjects failed!');
                }
                break;
            } else if (result === WaitForMultipleObjectsResult.WAIT_TIMEOUT) {
                break;
            } else if (result >= WaitForMultipleObjectsResult.WAIT_ABANDONED_0) {
                if (this.loggingEnabled) {
                    error('monitorCheck: WaitForMultipleObjects reported that handle(s) were abandoned, which should not happen!');
                }
                break;
            } else {
                // A monitored key has signaled. Trigger its callback and continue wait in case there are other keys that have signaled as well
                const monitoredKey = this.monitoredKeysArray[result - WaitForMultipleObjectsResult.WAIT_OBJECT_0];
                monitoredKey.onMonitorTriggered();
            }
        }
    }

    /** Private method: updates monitored keys array when there are changes to monitored keys. */
    updateMonitoredKeysArray() {
        this.monitoredKeysArray = [];
        for (const path in this.monitoredRecursiveKeys) {
            this.monitoredKeysArray.push(this.monitoredRecursiveKeys[path]);
        }
        for (const path in this.monitoredKeys) {
            this.monitoredKeysArray.push(this.monitoredKeys[path]);
        }

        // Also re-creates handle array buffer to be used as lpHandles in WaitForMultipleObjects API.
        this.monitoredKeyHandlesBuffer = Buffer.alloc(ref.sizeof.pointer * this.monitoredKeysArray.length);
        if (this.monitoredKeysArray.length === 0) {
            this.stopMonitorTimer();
        } else {
            const copyToBuffer = ref.sizeof.pointer == 4 ? this.monitoredKeyHandlesBuffer.writeUInt32LE : this.monitoredKeyHandlesBuffer.writeUInt64LE;
            for (let i = 0; i < this.monitoredKeysArray.length; ++i) {
                this.monitoredKeyHandlesBuffer.writeUInt64LE(ref.address(this.monitoredKeysArray[i].monitorData.waitHandle), i * ref.sizeof.pointer);
            }
        }
    }

    /** Private method: compares registry values based on value type. */
    checkValue(currentValue, compareValue, valueType) {
        if (currentValue === null && compareValue === null) {
            return true;
        } else if (currentValue === null || compareValue === null) {
            return false;
        }

        switch (valueType) {
            case RegistryValueType.REG_DWORD:     // Value is expected as unsigned integer
            case RegistryValueType.REG_QWORD:     // Value is expected as unsigned integer
            case RegistryValueType.REG_SZ:        // Value is expected as string
            case RegistryValueType.REG_EXPAND_SZ: // Value is expected as string
                return (currentValue === compareValue);

            case RegistryValueType.REG_MULTI_SZ:
                // Value is expected as string[]
                if (currentValue.length !== compareValue.length) {
                    return false;
                } else {
                    for (let i = 0; i < currentValue.length; ++i) {
                        if (currentValue[i] !== compareValue[i]) {
                            return false;
                        }
                    }
                }
                return true;

            case RegistryValueType.REG_BINARY:
                // Value is expected as Buffer
                return (currentValue.size === compareValue.size && currentValue.compare(compareValue) === 0);

            default:
                throw new Error(`Value "${name}" of key "${path}" with type ${monitorToken.valueType} is not supported!`);
        }
    }
}

module.exports = Registry;
