import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    spawn: vi.fn(),
}));

vi.mock('cross-spawn', () => ({
    spawn: mocks.spawn,
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
    },
}));

import { codexLocal } from './codexLocal';

describe('codexLocal', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.spawn.mockReturnValue({
            on: vi.fn((event, callback) => {
                if (event === 'exit') {
                    process.nextTick(() => callback(0, null));
                }
            }),
        });
    });

    it('starts the native Codex TUI with inherited stdio', async () => {
        await codexLocal({
            path: '/work/project',
            abort: new AbortController().signal,
        });

        expect(mocks.spawn).toHaveBeenCalledWith('codex', [], {
            stdio: ['inherit', 'inherit', 'inherit'],
            cwd: '/work/project',
            env: process.env,
            signal: expect.any(AbortSignal),
            windowsHide: true,
        });
    });

    it('resumes a Codex thread when a thread id is known', async () => {
        await codexLocal({
            path: '/work/project',
            abort: new AbortController().signal,
            threadId: 'thread-123',
        });

        expect(mocks.spawn).toHaveBeenCalledWith('codex', ['resume', 'thread-123'], expect.any(Object));
    });
});
