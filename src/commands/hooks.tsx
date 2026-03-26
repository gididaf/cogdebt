import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';
import { readFile, writeFile, chmod, mkdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { Confirm } from '../ui/components/Confirm.js';

const HOOK_MARKER = '# cogdebt auto-decay';

async function askConfirmInk(message: string, defaultValue = true): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const { unmount } = render(
      <Confirm message={message} defaultValue={defaultValue} onConfirm={(v) => {
        setTimeout(() => { unmount(); resolve(v); }, 50);
      }} />,
    );
  });
}

export async function runHooks(projectRoot: string): Promise<void> {
  console.log(chalk.bold('\n  ⚙️  Hook Setup\n'));

  await setupClaudeCodeStatusLine();
  await setupGitHook(projectRoot);

  console.log(chalk.green.bold('\n  ✓ Hook setup complete!\n'));
}

async function setupClaudeCodeStatusLine(): Promise<void> {
  const settingsPath = join(homedir(), '.claude', 'settings.json');

  let settings: any = {};
  try {
    const content = await readFile(settingsPath, 'utf-8');
    settings = JSON.parse(content);
  } catch {}

  const hasStatusLine = settings.statusLine;
  if (hasStatusLine) {
    console.log(chalk.dim(`  Claude Code status line is already configured:`));
    console.log(chalk.dim(`    ${JSON.stringify(settings.statusLine)}`));
    const overwrite = await askConfirmInk('Overwrite with cogdebt status line?', false);
    if (!overwrite) {
      console.log(chalk.dim('  Skipped Claude Code status line.'));
      return;
    }
  } else {
    const install = await askConfirmInk('Add cogdebt status line to Claude Code?', true);
    if (!install) {
      console.log(chalk.dim('  Skipped Claude Code status line.'));
      return;
    }
  }

  settings.statusLine = {
    type: 'command',
    command: 'cogdebt status --brief 2>/dev/null || echo "cogdebt: not initialized"',
    padding: 0,
  };

  await mkdir(dirname(settingsPath), { recursive: true });
  await writeFile(settingsPath, JSON.stringify(settings, null, 2) + '\n', 'utf-8');
  console.log(chalk.green('  ✓ Claude Code status line configured'));
}

async function setupGitHook(projectRoot: string): Promise<void> {
  const hookPath = join(projectRoot, '.git', 'hooks', 'post-commit');

  const hookScript = `
${HOOK_MARKER}
if command -v cogdebt >/dev/null 2>&1; then
  cogdebt decay --quiet &
fi
${HOOK_MARKER}-end`;

  let existingContent = '';
  try {
    existingContent = await readFile(hookPath, 'utf-8');
  } catch {}

  if (existingContent.includes(HOOK_MARKER)) {
    console.log(chalk.dim('  Git post-commit hook already has cogdebt decay.'));
    return;
  }

  const install = await askConfirmInk('Add auto-decay git post-commit hook?', true);
  if (!install) {
    console.log(chalk.dim('  Skipped git hook.'));
    return;
  }

  await mkdir(dirname(hookPath), { recursive: true });
  if (existingContent) {
    const newContent = existingContent.trimEnd() + '\n\n' + hookScript + '\n';
    await writeFile(hookPath, newContent, 'utf-8');
  } else {
    const newContent = '#!/bin/sh\n\n' + hookScript + '\n';
    await writeFile(hookPath, newContent, 'utf-8');
  }

  await chmod(hookPath, 0o755);
  console.log(chalk.green('  ✓ Git post-commit hook configured'));
}
