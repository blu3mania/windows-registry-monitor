'use strict';

const chalk = require('chalk');

const dateTimeFormatOprions = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
};

/** Internal method: format a message so it shows with timestamp. */
function formatMessage(msg) {
    return `[${new Intl.DateTimeFormat('en-US', dateTimeFormatOprions).format(new Date())}] ${typeof msg === 'string' ? msg : JSON.stringify(msg, null, 2)}`;
}

/**
 * Prints a message in console.
 * @param {string|Object} msg - The message to be printed. It can be a non-string type, in which case it will be serialized before printing.
 * @param {Chalk} color - (Optional) The color of the message to be printed.
 *                        If not provided, default color white is used.
 */
function print(msg, color = chalk.white) {
    console.log(color(formatMessage(msg)));
}

/**
 * Prints an error message in console.
 * @param {string|Object} msg - The error message to be printed. It can be a non-string type, in which case it will be serialized before printing.
 */
function error(msg) {
    console.log(chalk.red(formatMessage(msg)));
}

/**
 * Prints a warning message in console.
 * @param {string|Object} msg - The warning message to be printed. It can be a non-string type, in which case it will be serialized before printing.
 */
function warning(msg) {
    console.log(chalk.yellow(formatMessage(msg)));
}

/**
 * Prints an infomation message in console.
 * @param {string|Object} msg - The information message to be printed. It can be a non-string type, in which case it will be serialized before printing.
 */
function info(msg) {
    console.log(chalk.cyan(formatMessage(msg)));
}

/**
 * Prints a verbose message in console.
 * @param {string|Object} msg - The verbose message to be printed. It can be a non-string type, in which case it will be serialized before printing.
 */
function verbose(msg) {
    console.log(chalk.green(formatMessage(msg)));
}

module.exports = {
    print,
    error,
    warning,
    info,
    verbose,
};