'use strict';

const Registry = require('..');
const registry = Registry.instance;

let monitorToken = null;

const key = process.argv.length > 2 ? process.argv[2] : 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
const name = process.argv.length > 4 ? process.argv[3] : null;
let value = process.argv.length > 4 ? process.argv[4] : null;

main();

function main() {
    if (name !== null) {
        // Find out value type. If it doesn't exist, assume it's REG_SZ
        let type = registry.getValueType(key, name);
        if (type == Registry.ValueType.REG_NONE) {
            type =  Registry.ValueType.REG_SZ;
        }

        switch (type) {
            case Registry.ValueType.REG_DWORD:
            case Registry.ValueType.REG_QWORD:
                // Value is expected as unsigned integer
                value = parseInt(value);
                break;

            case Registry.ValueType.REG_SZ:
            case Registry.ValueType.REG_EXPAND_SZ:
                // Value is expected as string
                break;

            case Registry.ValueType.REG_MULTI_SZ:
                // Value is expected as string[]
                value = value.split('\\');
                break;

            default:
                throw new Error(`Type ${type} is not supported.`);
        }

        monitorToken = registry.monitorValue(key, name, value, true, (monitoredKey, currentValue, compareValue) => {
            print(`Value of "${key}\\${name}" is no longer ${value}`);
        });
    } else {
        monitorToken = registry.monitorKey(key, true, false, (monitoredKey) => {
            print(`Changes happened in key ${key}`);
            if (process.argv.length === 2) {
                print(`System is ${monitoredKey.getValue("SystemUsesLightTheme") === 0 ? "in" : "not in"} dark mode`);
            }
        });
    }

    process.on('SIGINT', () => {
        print('SIGINT received, exiting...');
        if (monitorToken !== null && !monitorToken.stop()) {
            print('Failed to stop registry key monitor.');
        }
        process.exit();
    });

    // Use a no-op timer to keep the process running.
    setInterval(() => {}, 60 * 60 * 1000);
}

function print(msg) {
    console.log(`[${new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date())}] ${typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)}`);
}
