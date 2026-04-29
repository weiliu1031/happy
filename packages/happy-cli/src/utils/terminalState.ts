import { execFileSync } from 'node:child_process';

export type TerminalStateSnapshot = {
    restore: () => void;
};

const KITTY_KEYBOARD_PROTOCOL_POP_COUNT = 8;

export function resetTerminalModes(): void {
    if (!process.stdout.isTTY) {
        return;
    }

    // Some TUIs enable terminal-emulator modes that are not part of termios.
    // If they leak, shells receive keys as CSI sequences such as "9;5u".
    const resetSequences = [
        '\x1b[?1l', // normal cursor key mode
        '\x1b[?66l', // normal keypad mode
        '\x1b[?1000l',
        '\x1b[?1002l',
        '\x1b[?1003l',
        '\x1b[?1004l', // focus reporting
        '\x1b[?1006l',
        '\x1b[?1015l',
        '\x1b[?2004l', // bracketed paste
        '\x1b[?2026l', // synchronized output
        '\x1b[?25h', // show cursor
        '\x1b[>4;0m', // xterm modifyOtherKeys
        '\x1b[<u'.repeat(KITTY_KEYBOARD_PROTOCOL_POP_COUNT),
    ].join('');

    try {
        process.stdout.write(resetSequences);
    } catch {
        // Best-effort cleanup only.
    }
}

export function captureTerminalState(): TerminalStateSnapshot {
    const sttyState = readSttyState();
    let restored = false;

    return {
        restore: () => {
            if (restored) {
                return;
            }
            restored = true;
            resetTerminalModes();
            restoreSttyState(sttyState);
        },
    };
}

function readSttyState(): string | null {
    if (!process.stdin.isTTY) {
        return null;
    }

    try {
        const output = execFileSync('stty', ['-g'], {
            encoding: 'utf8',
            stdio: ['inherit', 'pipe', 'ignore'],
        }).trim();
        return output.length > 0 ? output : null;
    } catch {
        return null;
    }
}

function restoreSttyState(sttyState: string | null): void {
    if (!process.stdin.isTTY) {
        return;
    }

    try {
        if (sttyState) {
            execFileSync('stty', [sttyState], {
                stdio: ['inherit', 'ignore', 'ignore'],
            });
        } else if (typeof process.stdin.setRawMode === 'function') {
            process.stdin.setRawMode(false);
        }
    } catch {
        try {
            if (typeof process.stdin.setRawMode === 'function') {
                process.stdin.setRawMode(false);
            }
        } catch {
            // Best-effort cleanup only.
        }
    }
}
