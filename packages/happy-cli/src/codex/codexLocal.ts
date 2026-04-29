import { spawn as crossSpawn } from 'cross-spawn';

import { logger } from '@/ui/logger';
import { captureTerminalState } from '@/utils/terminalState';

export class CodexLocalExitCodeError extends Error {
    readonly exitCode: number;

    constructor(exitCode: number) {
        super(`Codex exited with code ${exitCode}`);
        this.name = 'CodexLocalExitCodeError';
        this.exitCode = exitCode;
    }
}

export async function codexLocal(opts: {
    path: string;
    abort: AbortSignal;
    threadId?: string | null;
    codexArgs?: string[];
    env?: NodeJS.ProcessEnv;
}): Promise<void> {
    const args = [
        ...(opts.threadId ? ['resume', opts.threadId] : []),
        ...(opts.codexArgs ?? []),
    ];

    logger.debug(`[CodexLocal] Spawning native Codex TUI: codex ${args.join(' ')}`);
    const terminalState = captureTerminalState();

    try {
        await new Promise<void>((resolve, reject) => {
            const child = crossSpawn('codex', args, {
                stdio: ['inherit', 'inherit', 'inherit'],
                cwd: opts.path,
                env: opts.env ?? process.env,
                signal: opts.abort,
                windowsHide: true,
            });

            child.on('error', reject);
            child.on('exit', (code, signal) => {
                if (signal && opts.abort.aborted) {
                    resolve();
                    return;
                }
                if (signal) {
                    reject(new Error(`Codex terminated with signal ${signal}`));
                    return;
                }
                if (code !== null && code !== 0) {
                    reject(new CodexLocalExitCodeError(code));
                    return;
                }
                resolve();
            });
        });
    } finally {
        terminalState.restore();
    }
}
