# windows-registry-monitor
[![Apache 2.0 License](https://img.shields.io/badge/License-Apache%202.0-yellow)](https://raw.githubusercontent.com/blu3mania/windows-registry-monitor/main/LICENSE)
[![node.js 17+](https://img.shields.io/badge/node.js-17.0.0-blue?logo=node.js)](https://nodejs.org/en/)
[![Latest Release](https://img.shields.io/github/v/release/blu3mania/windows-registry-monitor)](https://github.com/blu3mania/windows-registry-monitor/releases/latest)

This library provides the ability to monitor Windows registry for key/value changes.

## Installation

It is recommended to use npm to install windows-registry-monitor:

`npm install windows-registry-monitor`

Notes:
1. The required package "ffi-napi" uses native modules and relies on "node-gyp" to build the project. As a
   result, there are some prerequisites that need to be installed/configured. Please refer to [node-gyp's
   instructions](https://github.com/nodejs/node-gyp#installation).
2. It seems node.js 16.x doesn't always work due to V8 change that enforced one-to-one mapping of Buffers
   and backing stores (see https://monorail-prod.appspot.com/p/v8/issues/detail?id=9908). It might crash
   like this:
   ```
    #
    # Fatal error in , line 0
    # Check failed: result.second.
    #
    #
    #
    #FailureMessage Object: 000000A5C1FFE530
    1: 00007FF6B7E1B1EF v8::internal::CodeObjectRegistry::~CodeObjectRegistry+123599
    2: 00007FF6B7D37E7F std::basic_ostream<char,std::char_traits<char> >::operator<<+65407
    3: 00007FF6B8A14482 V8_Fatal+162
    4: 00007FF6B847EC6D v8::internal::BackingStore::Reallocate+637
    5: 00007FF6B86C81D9 v8::ArrayBuffer::GetBackingStore+137
    6: 00007FF6B7DEAD29 napi_get_typedarray_info+393
    7: 00007FF9D7298828
    8: 00007FF9D7299F88
    9: 00007FF9D72997CF
    10: 00007FF9D729F786
    11: 00007FF9D7298063
    12: 00007FF9D729EFB3
    13: 00007FF6B7DE54EB node::Stop+32747
    14: 00007FF6B86FE5EF v8::internal::SetupIsolateDelegate::SetupHeap+53823
    15: 000001BD57A7603B
   ```

   There have been several issues reported against node.js (e.g. https://github.com/nodejs/node/issues/32463)
   and ffi-napi (e.g. https://github.com/node-ffi-napi/node-ffi-napi/issues/188). Even though one of the
   reported issues claimed that it was fixed in node.js 16.17.0, the aforementioned crash could still be
   encountered. It seems node.js 18.9.0 is quite stable. For now this package is marked as requiring node.js
   17+, but the recommendation is to use the newest 18.x.

## Usage
The main class, Registry, uses Singleton pattern. To initialize it:
```
const Registry = require('windows-registry-monitor');
const registry = Registry.instance;
```
or
```
const registry = require('windows-registry-monitor').instance;
```

### Monitor a registry key
This method can be used to monitor any changes under a registry key:
```
const key = "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
const recursive = true;
const createIfNotExisting = false;
const monitorToken = registry.monitorKey(key, recursive, createIfNotExisting, (monitoredKey) => {
    print(`Changes happened in key ${key}`);
    print(`System is ${monitoredKey.getValue("SystemUsesLightTheme") === 0 ? "in" : "not in"} dark mode`);
});

// Wait for events

// When monitor is no longer needed
monitorToken.stop();
```

The second parameter determines whether it will also monitor changes in sub-keys recursively.

The third parameter can be used to create the key if it doesn't exist. Current user account needs to have
sufficient permission.

The last parameter specifies the callback. A single parameter of type RegistryKey will be passed to this
callback. RegistryKey class supports basic key operations, such as:
```
open();
close();
getValue(name);
setValue(name, value, type);
getValueType(name);
checkValueExistence(name);
```

Value type definition can be obtained by calling Registry.ValueType. E.g.
```
const Registry = require('windows-registry-monitor');
const DWORD_Type = Registry.ValueType.DWORD;
```

Required JavaScript value type for each registry value types are as below:

- REG_DWORD - Number, up to maximum number allowed in 32-bit unsigned integer
- REG_QWORD - Number, up to maximum number allowed in 64-bit unsigned integer
- REG_SZ - String
- REG_EXPAND_SZ - String
- REG_MULTI_SZ - String[]
- REG_BINARY - Buffer

For string types, Unicode strings are supported.

When the monitor is no longer needed, **make sure to call stop()** to properly release the underlying
handle obtained from Windows native API.

### Monitor a registry value
This method can be used to monitor a registry value and be notified only when the value is not the
defined value anymore. This includes value change or value/key deletion.
```
const key = "HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize";
const name = "SystemUsesLightTheme";
const value = 0;
const createKeyIfNeeded = false;
const monitorToken = registry.monitorValue(key, name, value, createKeyIfNeeded, (monitoredKey, currentValue, compareValue) => {
    print(`System is not in dark mode. Expected value of ${name}: ${value}. Current value: ${currentValue}`);
});

// Wait for events

// When monitor is no longer needed
monitorToken.stop();
```

The first 3 parameters specify the key/name to monitor and the value to compare to. If comparison value
is provided, this method will always compare to the provided value and only notifies when current value
is different than it. However, if comparison value is not provided (i.e. null is passed in), this method
will always keep track of the current value and notifies when it changes.

Similar to monitorKey(), the 4th parameter can be used to create the key if it doesn't exist (note, this
doesn't apply to the value itself). Current user account needs to have sufficient permission.

The last parameter specifies teh callback. 3 parameters will be passed to this callback. The first one
is the key with type of RegistryKey. The next 2 parameters are the current value and the comparison value
provided. The latter is useful in the case when the method always tracks current value, in which case it
provides the previous value.

When the monitor is no longer needed, *make sure to call stop()* to properly release the underlying
handle obtained from Windows native API.

### Other operations
Registry class also provides the normal registry operations:

- openKey(path, createIfNeeded, readonly)

  Returns a RegistryKey. The 3rd parameter signals whether this key will be used for write operation, i.e.
  setValue(). Current user account needs to have sufficient permission for that.
  When no longer needed, the returned key should be closed by calling close() on it, or use the next operation:

- closeKey(key)

  key is of type RegistryKey. Note, only call this method on keys opened from openKey(). Do not call it with
  monitor keys received in monitor callbacks. For them, call stop() on the obtained token instead (see above).

- getValue(path, name)

  As name suggests.

- getValueType(path, name)

  Returns one of the defined types in Registry.ValueType.

- checkValueExistence(path, name)

  Returns true or false.

- setValue(path, name, value, type)

  See [Monitor a registry key](#monitor-a-registry-key) section for description of registry value types and
  corresponding JavaScript value types.

- disableLogging()

  By default, methods in this package may log warnings and errors to console. If it's not desired, call this
  method to turn off logging. Note, it does not turn off the warnings logged in finalizers when opened keys
  and monitor tokens are not properly closed/stopped, because they indicate wrong usage of this package.