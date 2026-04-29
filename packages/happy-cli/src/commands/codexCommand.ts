import { authAndSetupMachineIfNeeded } from '@/ui/auth'
import { runCodex } from '@/codex/runCodex'
import { extractCodexResumeFlag } from '@/codex/cliArgs'
import { extractNoSandboxFlag } from '@/utils/sandboxFlags'
import { ensureDaemonRunning } from '@/daemon/ensureDaemonRunning'

export async function handleCodexCommand(args: string[]): Promise<void> {
  let startedBy: 'daemon' | 'terminal' | undefined = undefined
  let startingMode: 'local' | 'remote' | undefined = undefined
  const sandboxArgs = extractNoSandboxFlag(args)
  const codexArgs = extractCodexResumeFlag(sandboxArgs.args)
  const passthroughCodexArgs: string[] = []

  for (let i = 0; i < codexArgs.args.length; i++) {
    if (codexArgs.args[i] === '--started-by') {
      startedBy = codexArgs.args[++i] as 'daemon' | 'terminal'
    } else if (codexArgs.args[i] === '--happy-starting-mode') {
      startingMode = codexArgs.args[++i] as 'local' | 'remote'
    } else {
      passthroughCodexArgs.push(codexArgs.args[i])
    }
  }

  const { credentials } = await authAndSetupMachineIfNeeded()
  await ensureDaemonRunning()

  await runCodex({
    credentials,
    startedBy,
    noSandbox: sandboxArgs.noSandbox,
    resumeThreadId: codexArgs.resumeThreadId ?? undefined,
    startingMode,
    codexArgs: passthroughCodexArgs,
  })
}
