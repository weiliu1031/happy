import { readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { EventMsg } from './codexAppServerTypes';

export type CodexSessionInfo = {
    id: string;
    file: string;
    cwd: string;
};

type CodexJsonlRecord = {
    type?: string;
    timestamp?: string;
    payload?: Record<string, unknown>;
};

export type CodexSessionEventsRead = {
    events: EventMsg[];
    nextLineOffset: number;
};

export function defaultCodexHome(): string {
    return join(homedir(), '.codex');
}

export async function findLatestCodexSession(opts: {
    codexHome?: string;
    cwd: string;
    startedAfter?: number;
}): Promise<CodexSessionInfo | null> {
    const codexHome = opts.codexHome ?? defaultCodexHome();
    const sessionsRoot = join(codexHome, 'sessions');
    const files = await listJsonlFiles(sessionsRoot);
    const candidates: Array<CodexSessionInfo & { timestamp: number }> = [];

    for (const file of files) {
        const meta = await readCodexSessionMeta(file);
        if (!meta || meta.cwd !== opts.cwd) {
            continue;
        }
        if (opts.startedAfter !== undefined && meta.timestamp < opts.startedAfter) {
            continue;
        }
        candidates.push(meta);
    }

    candidates.sort((a, b) => b.timestamp - a.timestamp);
    const latest = candidates[0];
    if (!latest) {
        return null;
    }
    return {
        id: latest.id,
        file: latest.file,
        cwd: latest.cwd,
    };
}

export async function readCodexSessionEvents(file: string, lineOffset = 0): Promise<CodexSessionEventsRead> {
    let content: string;
    try {
        content = await readFile(file, 'utf8');
    } catch {
        return { events: [], nextLineOffset: lineOffset };
    }

    const lines = content.split('\n');
    const events: EventMsg[] = [];
    let nextLineOffset = lineOffset;

    for (let index = lineOffset; index < lines.length; index++) {
        const line = lines[index].trim();
        if (!line) {
            continue;
        }
        nextLineOffset = index + 1;
        const record = parseCodexRecord(line);
        if (record?.type !== 'event_msg' || !record.payload) {
            continue;
        }
        if (typeof record.payload.type !== 'string') {
            continue;
        }
        events.push(record.payload as EventMsg);
    }

    return { events, nextLineOffset };
}

async function readCodexSessionMeta(file: string): Promise<(CodexSessionInfo & { timestamp: number }) | null> {
    let content: string;
    try {
        content = await readFile(file, 'utf8');
    } catch {
        return null;
    }

    const firstLine = content.split('\n').find(line => line.trim().length > 0);
    if (!firstLine) {
        return null;
    }

    const record = parseCodexRecord(firstLine);
    if (record?.type !== 'session_meta' || !record.payload) {
        return null;
    }

    const id = record.payload.id;
    const cwd = record.payload.cwd;
    if (typeof id !== 'string' || typeof cwd !== 'string') {
        return null;
    }

    const originator = record.payload.originator;
    if (originator !== undefined && originator !== 'codex-tui') {
        return null;
    }

    const rawTimestamp = record.payload.timestamp ?? record.timestamp;
    const timestamp = typeof rawTimestamp === 'string' ? Date.parse(rawTimestamp) : 0;

    return {
        id,
        cwd,
        file,
        timestamp: Number.isFinite(timestamp) ? timestamp : 0,
    };
}

function parseCodexRecord(line: string): CodexJsonlRecord | null {
    try {
        const parsed = JSON.parse(line);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return null;
        }
        return parsed as CodexJsonlRecord;
    } catch {
        return null;
    }
}

async function listJsonlFiles(root: string): Promise<string[]> {
    let entries: import('node:fs').Dirent[];
    try {
        entries = await readdir(root, { withFileTypes: true });
    } catch {
        return [];
    }

    const files: string[] = [];
    for (const entry of entries) {
        const fullPath = join(root, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listJsonlFiles(fullPath));
            continue;
        }
        if (!entry.isFile() || !entry.name.endsWith('.jsonl')) {
            continue;
        }
        try {
            const s = await stat(fullPath);
            if (s.size > 0) {
                files.push(fullPath);
            }
        } catch {
            // Ignore files that disappear during scanning.
        }
    }
    return files;
}
