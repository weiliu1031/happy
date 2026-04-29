import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import type { CodexEnhancedMode } from './codexLocalLauncher';

const mocks = vi.hoisted(() => ({
    codexLocal: vi.fn(),
    findLatestCodexSession: vi.fn(),
    readCodexSessionEvents: vi.fn(),
}));

vi.mock('./codexLocal', () => ({
    codexLocal: mocks.codexLocal,
    CodexLocalExitCodeError: class CodexLocalExitCodeError extends Error {
        readonly exitCode: number;
        constructor(exitCode: number) {
            super(`Codex exited with code ${exitCode}`);
            this.exitCode = exitCode;
        }
    },
}));

vi.mock('./codexSessionScanner', () => ({
    findLatestCodexSession: mocks.findLatestCodexSession,
    readCodexSessionEvents: mocks.readCodexSessionEvents,
}));

vi.mock('@/ui/logger', () => ({
    logger: {
        debug: vi.fn(),
        warn: vi.fn(),
    },
}));

import { codexLocalLauncher } from './codexLocalLauncher';

describe('codexLocalLauncher', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.findLatestCodexSession.mockResolvedValue({
            id: 'thread-1',
            file: '/tmp/rollout.jsonl',
            cwd: '/work/project',
        });
        mocks.readCodexSessionEvents.mockResolvedValue({
            events: [],
            nextLineOffset: 1,
        });
    });

    it('switches to remote mode when a remote user message arrives', async () => {
        let signal!: AbortSignal;
        mocks.codexLocal.mockImplementation(async (opts: { abort: AbortSignal }) => {
            signal = opts.abort;
            await new Promise<void>((resolve) => {
                opts.abort.addEventListener('abort', () => resolve(), { once: true });
            });
        });

        const queue = new MessageQueue2<CodexEnhancedMode>((mode) => mode.permissionMode);
        const session = {
            updateMetadata: vi.fn(),
            sendSessionProtocolMessage: vi.fn(),
        };

        const run = codexLocalLauncher({
            path: '/work/project',
            session,
            queue,
            initialThreadId: null,
            scanIntervalMs: 10,
        });

        await vi.waitFor(() => expect(mocks.codexLocal).toHaveBeenCalled());
        queue.push('remote prompt', { permissionMode: 'default' });

        await expect(run).resolves.toEqual({
            type: 'switch',
            threadId: 'thread-1',
        });
        expect(signal.aborted).toBe(true);
        expect(queue.size()).toBe(1);
    });

    it('forwards scanned Codex events as session protocol envelopes', async () => {
        mocks.codexLocal.mockResolvedValue(undefined);
        mocks.readCodexSessionEvents.mockResolvedValue({
            events: [
                { type: 'task_started' },
                { type: 'agent_message', message: 'hello from codex' },
            ],
            nextLineOffset: 3,
        });

        const queue = new MessageQueue2<CodexEnhancedMode>((mode) => mode.permissionMode);
        const session = {
            updateMetadata: vi.fn(),
            sendSessionProtocolMessage: vi.fn(),
        };

        await codexLocalLauncher({
            path: '/work/project',
            session,
            queue,
            initialThreadId: null,
            scanIntervalMs: 10,
        });

        expect(session.updateMetadata).toHaveBeenCalledTimes(1);
        expect(session.sendSessionProtocolMessage).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'agent', ev: expect.objectContaining({ t: 'turn-start' }) }),
        );
        expect(session.sendSessionProtocolMessage).toHaveBeenCalledWith(
            expect.objectContaining({ role: 'agent', ev: expect.objectContaining({ t: 'text', text: 'hello from codex' }) }),
        );
    });

    it('switches to remote mode when the switch RPC is requested', async () => {
        let switchHandler!: () => Promise<void> | void;
        let signal!: AbortSignal;
        mocks.codexLocal.mockImplementation(async (opts: { abort: AbortSignal }) => {
            signal = opts.abort;
            await new Promise<void>((resolve) => {
                opts.abort.addEventListener('abort', () => resolve(), { once: true });
            });
        });

        const queue = new MessageQueue2<CodexEnhancedMode>((mode) => mode.permissionMode);
        const session = {
            updateMetadata: vi.fn(),
            sendSessionProtocolMessage: vi.fn(),
        };
        const rpcHandlerManager = {
            registerHandler: vi.fn((method: string, handler: () => Promise<void> | void) => {
                if (method === 'switch') {
                    switchHandler = handler;
                }
            }),
        };

        const run = codexLocalLauncher({
            path: '/work/project',
            session,
            queue,
            rpcHandlerManager,
            initialThreadId: null,
            scanIntervalMs: 10,
        });

        await vi.waitFor(() => expect(mocks.codexLocal).toHaveBeenCalled());
        await switchHandler();

        await expect(run).resolves.toEqual({
            type: 'switch',
            threadId: 'thread-1',
        });
        expect(signal.aborted).toBe(true);
    });

    it('clears queued messages when the abort RPC is requested in local mode', async () => {
        let abortHandler!: () => Promise<void> | void;
        mocks.codexLocal.mockImplementation(async (opts: { abort: AbortSignal }) => {
            await new Promise<void>((resolve) => {
                opts.abort.addEventListener('abort', () => resolve(), { once: true });
            });
        });

        const queue = new MessageQueue2<CodexEnhancedMode>((mode) => mode.permissionMode);
        const session = {
            updateMetadata: vi.fn(),
            sendSessionProtocolMessage: vi.fn(),
        };
        const rpcHandlerManager = {
            registerHandler: vi.fn((method: string, handler: () => Promise<void> | void) => {
                if (method === 'abort') {
                    abortHandler = handler;
                }
            }),
        };

        const run = codexLocalLauncher({
            path: '/work/project',
            session,
            queue,
            rpcHandlerManager,
            initialThreadId: null,
            scanIntervalMs: 10,
        });

        await vi.waitFor(() => expect(mocks.codexLocal).toHaveBeenCalled());
        queue.push('queued prompt', { permissionMode: 'default' });
        await abortHandler();

        await expect(run).resolves.toEqual({
            type: 'switch',
            threadId: 'thread-1',
        });
        expect(queue.size()).toBe(0);
    });

    it('keeps the Codex log cursor across local launches', async () => {
        mocks.codexLocal.mockResolvedValue(undefined);
        mocks.readCodexSessionEvents
            .mockResolvedValueOnce({
                events: [{ type: 'agent_message', message: 'first run' }],
                nextLineOffset: 7,
            })
            .mockResolvedValueOnce({
                events: [],
                nextLineOffset: 9,
            })
            .mockResolvedValueOnce({
                events: [{ type: 'agent_message', message: 'second run' }],
                nextLineOffset: 11,
            })
            .mockResolvedValueOnce({
                events: [],
                nextLineOffset: 11,
            });

        const cursor = {
            currentSession: null,
            lineOffset: 0,
        };
        const session = {
            updateMetadata: vi.fn(),
            sendSessionProtocolMessage: vi.fn(),
        };

        await codexLocalLauncher({
            path: '/work/project',
            session,
            queue: new MessageQueue2<CodexEnhancedMode>((mode) => mode.permissionMode),
            sessionLogCursor: cursor,
            initialThreadId: null,
            scanIntervalMs: 10,
        });
        await codexLocalLauncher({
            path: '/work/project',
            session,
            queue: new MessageQueue2<CodexEnhancedMode>((mode) => mode.permissionMode),
            sessionLogCursor: cursor,
            initialThreadId: 'thread-1',
            scanIntervalMs: 10,
        });

        expect(mocks.readCodexSessionEvents).toHaveBeenNthCalledWith(1, '/tmp/rollout.jsonl', 0);
        expect(mocks.readCodexSessionEvents).toHaveBeenNthCalledWith(2, '/tmp/rollout.jsonl', 7);
        expect(mocks.readCodexSessionEvents).toHaveBeenNthCalledWith(3, '/tmp/rollout.jsonl', 9);
        expect(cursor.lineOffset).toBe(11);
    });
});
