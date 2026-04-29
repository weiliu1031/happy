import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
    findLatestCodexSession,
    readCodexSessionEvents,
} from './codexSessionScanner';

describe('codexSessionScanner', () => {
    let root: string;
    let codexHome: string;

    beforeEach(async () => {
        root = join(tmpdir(), `happy-codex-scanner-${Date.now()}-${Math.random().toString(16).slice(2)}`);
        codexHome = join(root, '.codex');
        await mkdir(join(codexHome, 'sessions', '2026', '04', '29'), { recursive: true });
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('finds the newest Codex TUI session for the current working directory', async () => {
        const older = join(codexHome, 'sessions', '2026', '04', '29', 'rollout-old.jsonl');
        const newer = join(codexHome, 'sessions', '2026', '04', '29', 'rollout-new.jsonl');

        await writeFile(older, JSON.stringify({
            type: 'session_meta',
            payload: {
                id: 'old-thread',
                cwd: '/work/project',
                originator: 'codex-tui',
                timestamp: '2026-04-29T01:00:00.000Z',
            },
        }) + '\n');
        await writeFile(newer, JSON.stringify({
            type: 'session_meta',
            payload: {
                id: 'new-thread',
                cwd: '/work/project',
                originator: 'codex-tui',
                timestamp: '2026-04-29T02:00:00.000Z',
            },
        }) + '\n');

        const found = await findLatestCodexSession({
            codexHome,
            cwd: '/work/project',
        });

        expect(found).toEqual({
            id: 'new-thread',
            file: newer,
            cwd: '/work/project',
        });
    });

    it('reads only event_msg payloads after the supplied line offset', async () => {
        const file = join(codexHome, 'sessions', '2026', '04', '29', 'rollout.jsonl');
        await writeFile(file, [
            JSON.stringify({
                type: 'session_meta',
                payload: {
                    id: 'thread-1',
                    cwd: '/work/project',
                    originator: 'codex-tui',
                },
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: { type: 'task_started', turn_id: 'turn-1' },
            }),
            JSON.stringify({
                type: 'response_item',
                payload: { type: 'message', role: 'assistant' },
            }),
            JSON.stringify({
                type: 'event_msg',
                payload: { type: 'agent_message', message: 'done' },
            }),
            '',
        ].join('\n'));

        const result = await readCodexSessionEvents(file, 2);

        expect(result.nextLineOffset).toBe(4);
        expect(result.events).toEqual([
            { type: 'agent_message', message: 'done' },
        ]);
    });

    it('can ignore sessions that started before the local launcher began', async () => {
        const file = join(codexHome, 'sessions', '2026', '04', '29', 'rollout-old.jsonl');
        await writeFile(file, JSON.stringify({
            type: 'session_meta',
            payload: {
                id: 'old-thread',
                cwd: '/work/project',
                originator: 'codex-tui',
                timestamp: '2026-04-29T01:00:00.000Z',
            },
        }) + '\n');

        const found = await findLatestCodexSession({
            codexHome,
            cwd: '/work/project',
            startedAfter: Date.parse('2026-04-29T01:00:01.000Z'),
        });

        expect(found).toBeNull();
    });
});
