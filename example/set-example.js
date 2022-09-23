'use strict';

// Requires node.js 17+
const readline = require('readline/promises');

const Registry = require('..');
const registry = Registry.instance;

const key = process.argv.length > 4 ? process.argv[2] : 'HKCU\\SOFTWARE\\windows-registry-monitor'; // You can change root key to HKLM to observe permission related issues, and run as Administrator to overcome them
const name = process.argv.length > 4 ? process.argv[3] : 'Test';
const value = process.argv.length > 4 ? process.argv[4] : Math.random() * 100;

main();

async function main() {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    let regKey = registry.openKey(key);
    const keyExists = (regKey !== null);
    if (keyExists) {
        regKey.close();
    } else {
        const answer = await rl.question(`Key "${key}" does not exist. Create [y|n]?`);
        if (answer.toLowerCase() === "n") {
            process.exit();
        }
    }

    regKey = registry.openKey(key, true, false);
    if (regKey === null) {
        print(keyExists ? `Cannot open obtain write permission on key "${key}"` : `Cannot create key "${key}", likely due to lack of permission`);
        process.exit();
    }

    let type = regKey.getValueType(name);
    if (type === Registry.ValueType.REG_NONE) {
        const answer = await rl.question(`"${name}" does not exist in "${key}". Create [y|n]?`);
        if (answer.toLowerCase() === "n") {
            process.exit();
        }

        // Type is unknown, just use string.
        // You can pre-create this value as DWORD to observe the behavior of using existing type to set value
        type = Registry.ValueType.REG_SZ;
    }

    regKey.setValue(name, value, type);

    print(`Set value of "${key}\\${name}" to ${regKey.getValue(name)}`);
    regKey.close();
    rl.close();
}

function print(msg) {
    console.log(`[${new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date())}] ${typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)}`);
}
