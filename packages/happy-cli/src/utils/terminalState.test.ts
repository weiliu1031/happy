import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    execFileSync: vi.fn(),
}));

vi.mock('node:child_process', () => ({
    execFileSync: mocks.execFileSync,
}));

import { captureTerminalState, resetTerminalModes } from './terminalState';

describe('terminalState', () => {
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    const originalStdoutWrite = process.stdout.write;
    const originalSetRawMode = process.stdin.setRawMode;

    beforeEach(() => {
        vi.clearAllMocks();
        Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
        Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
        process.stdout.write = vi.fn() as any;
        process.stdin.setRawMode = vi.fn() as any;
        mocks.execFileSync.mockReturnValue('saved-stty-state\n');
    });

    afterEach(() => {
        Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
        Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
        process.stdout.write = originalStdoutWrite;
        process.stdin.setRawMode = originalSetRawMode;
    });

    it('writes escape sequences that disable enhanced keyboard modes', () => {
        resetTerminalModes();

        expect(process.stdout.write).toHaveBeenCalledTimes(1);
        const written = vi.mocked(process.stdout.write).mock.calls[0][0] as string;
        expect(written).toContain('\x1b[?2004l');
        expect(written).toContain('\x1b[>4;0m');
        expect(written).toContain('\x1b[<u');
    });

    it('restores the captured stty state once', () => {
        const snapshot = captureTerminalState();

        snapshot.restore();
        snapshot.restore();

        expect(mocks.execFileSync).toHaveBeenNthCalledWith(1, 'stty', ['-g'], {
            encoding: 'utf8',
            stdio: ['inherit', 'pipe', 'ignore'],
        });
        expect(mocks.execFileSync).toHaveBeenNthCalledWith(2, 'stty', ['saved-stty-state'], {
            stdio: ['inherit', 'ignore', 'ignore'],
        });
        expect(mocks.execFileSync).toHaveBeenCalledTimes(2);
    });
});
