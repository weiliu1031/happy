import type { SessionEnvelope } from '@slopus/happy-wire';
import type { PermissionMode } from '@/api/types';
import { MessageQueue2 } from '@/utils/MessageQueue2';
import { logger } from '@/ui/logger';

import { CodexLocalExitCodeError, codexLocal } from './codexLocal';
import {
    findLatestCodexSession,
    readCodexSessionEvents,
    type CodexSessionInfo,
} from './codexSessionScanner';
import {
    mapCodexMcpMessageToSessionEnvelopes,
    type CodexTurnState,
} from './utils/sessionProtocolMapper';

export type CodexEnhancedMode = {
    permissionMode: PermissionMode;
    model?: string;
};

export type CodexLocalLauncherResult =
    | { type: 'switch'; threadId: string | null }
    | { type: 'exit'; code: number };

export type CodexSessionLogCursor = {
    currentSession: CodexSessionInfo | null;
    lineOffset: number;
};

type CodexLocalLauncherSession = {
    updateMetadata: (handler: (metadata: any) => any) => void;
    sendSessionProtocolMessage: (envelope: SessionEnvelope) => void;
};

type RpcHandlerRegistrar = {
    registerHandler: (method: string, handler: (...args: any[]) => any) => void;
};

export async function codexLocalLauncher(opts: {
    path: string;
    session: CodexLocalLauncherSession;
    queue: MessageQueue2<CodexEnhancedMode>;
    rpcHandlerManager?: RpcHandlerRegistrar;
    sessionLogCursor?: CodexSessionLogCursor;
    initialThreadId?: string | null;
    codexArgs?: string[];
    codexHome?: string;
    scanIntervalMs?: number;
    skipExistingEvents?: boolean;
}): Promise<CodexLocalLauncherResult> {
    let switchRequested = false;
    let currentSession: CodexSessionInfo | null = opts.sessionLogCursor?.currentSession ?? null;
    let lineOffset = opts.sessionLogCursor?.lineOffset ?? 0;
    const launcherStartedAt = Date.now();
    const turnState: CodexTurnState = {
        currentTurnId: null,
        startedSubagents: new Set(),
        activeSubagents: new Set(),
        providerSubagentToSessionSubagent: new Map(),
    };

    const abortController = new AbortController();

    const syncFromCodexLog = async (emitEvents = true) => {
        const latest = await findLatestCodexSession({
            codexHome: opts.codexHome,
            cwd: opts.path,
            startedAfter: opts.initialThreadId ? undefined : launcherStartedAt - 5000,
        });
        if (!latest) {
            return;
        }

        if (!currentSession || currentSession.file !== latest.file) {
            currentSession = latest;
            lineOffset = 0;
            if (opts.sessionLogCursor) {
                opts.sessionLogCursor.currentSession = currentSession;
                opts.sessionLogCursor.lineOffset = lineOffset;
            }
            opts.session.updateMetadata((metadata) => ({
                ...metadata,
                codexThreadId: latest.id,
            }));
        }

        const read = await readCodexSessionEvents(latest.file, lineOffset);
        lineOffset = read.nextLineOffset;
        if (opts.sessionLogCursor) {
            opts.sessionLogCursor.currentSession = currentSession;
            opts.sessionLogCursor.lineOffset = lineOffset;
        }

        if (!emitEvents) {
            return;
        }

        for (const event of read.events) {
            const mapped = mapCodexMcpMessageToSessionEnvelopes(event, turnState);
            turnState.currentTurnId = mapped.currentTurnId;
            turnState.startedSubagents = mapped.startedSubagents;
            turnState.activeSubagents = mapped.activeSubagents;
            turnState.providerSubagentToSessionSubagent = mapped.providerSubagentToSessionSubagent;
            for (const envelope of mapped.envelopes) {
                opts.session.sendSessionProtocolMessage(envelope);
            }
        }
    };

    const currentSwitchResult = (): CodexLocalLauncherResult => ({
        type: 'switch',
        threadId: currentSession?.id ?? opts.initialThreadId ?? null,
    });

    const requestSwitch = () => {
        switchRequested = true;
        if (!abortController.signal.aborted) {
            abortController.abort();
        }
    };

    opts.queue.setOnMessage(() => {
        requestSwitch();
    });
    opts.rpcHandlerManager?.registerHandler('switch', () => {
        requestSwitch();
    });
    opts.rpcHandlerManager?.registerHandler('abort', () => {
        opts.queue.reset();
        requestSwitch();
    });

    if (opts.queue.size() > 0) {
        opts.queue.setOnMessage(null);
        opts.rpcHandlerManager?.registerHandler('switch', async () => {});
        opts.rpcHandlerManager?.registerHandler('abort', async () => {});
        return {
            type: 'switch',
            threadId: opts.initialThreadId ?? null,
        };
    }

    const interval = setInterval(() => {
        syncFromCodexLog().catch((error) => {
            logger.debug('[CodexLocalLauncher] Failed to sync Codex session log', error);
        });
    }, opts.scanIntervalMs ?? 1000);

    try {
        await syncFromCodexLog(!opts.skipExistingEvents);
        await codexLocal({
            path: opts.path,
            abort: abortController.signal,
            threadId: opts.initialThreadId,
            codexArgs: opts.codexArgs,
        });
        await syncFromCodexLog();
        if (switchRequested) {
            return currentSwitchResult();
        }
        return { type: 'exit', code: 0 };
    } catch (error) {
        await syncFromCodexLog();
        if (switchRequested) {
            return currentSwitchResult();
        }
        if (error instanceof CodexLocalExitCodeError) {
            return { type: 'exit', code: error.exitCode };
        }
        logger.warn('[CodexLocalLauncher] Codex local mode exited unexpectedly', error);
        return { type: 'exit', code: 1 };
    } finally {
        clearInterval(interval);
        opts.queue.setOnMessage(null);
        opts.rpcHandlerManager?.registerHandler('switch', async () => {});
        opts.rpcHandlerManager?.registerHandler('abort', async () => {});
    }
}
