# Happy Codex Fork Installation

This fork includes Codex local interactive mode and switching between local and
remote control.

## One-command install

```bash
curl -fsSL https://raw.githubusercontent.com/weiliu1031/happy/main/scripts/install-happy-codex.sh | bash
```

The installer clones or updates the fork at `~/.happy-codex/happy`, installs
workspace dependencies, builds the CLI, links `happy` globally, restarts the
Happy daemon, and verifies the installed CLI.

## Requirements

- Git
- Node.js 20 or newer
- Corepack, or an existing `pnpm` installation
- Codex CLI installed and logged in for `happy codex`

Install Codex CLI if needed:

```bash
npm install -g @openai/codex
codex login
```

## Use

```bash
happy codex
```

Start directly in remote mode:

```bash
happy codex --happy-starting-mode remote
```

## Update

Run the same installer again:

```bash
curl -fsSL https://raw.githubusercontent.com/weiliu1031/happy/main/scripts/install-happy-codex.sh | bash
```

## Customize

```bash
curl -fsSL https://raw.githubusercontent.com/weiliu1031/happy/main/scripts/install-happy-codex.sh \
  | HAPPY_CODEX_INSTALL_DIR="$HOME/src/happy" HAPPY_CODEX_BRANCH="main" bash
```

## Uninstall

```bash
npm unlink -g happy
npm install -g happy@latest
```

Remove the source checkout if you no longer need it:

```bash
rm -rf ~/.happy-codex/happy
```
