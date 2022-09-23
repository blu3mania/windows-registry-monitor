'use strict';

const registry = require('..').instance;

const key = process.argv.length > 3 ? process.argv[2] : 'HKEY_CURRENT_USER\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize';
const name = process.argv.length > 3 ? process.argv[3] : 'AppsUseLightTheme';

main();

function main() {
    print(`Value of "${key}\\${name}" is ${registry.getValue(key, name)}`);
}

function print(msg) {
    console.log(`[${new Intl.DateTimeFormat('en-US', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date())}] ${typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)}`);
}
