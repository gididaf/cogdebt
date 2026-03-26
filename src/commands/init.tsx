import React, { useState } from 'react';
import { render, Text, Box, useInput, useApp } from 'ink';
import chalk from 'chalk';
import * as store from '../core/store.js';
import * as git from '../core/git.js';
import { addToGitignore } from '../core/config.js';
import { isClaudeInstalled } from '../core/claude.js';
import { initializeScores } from '../engine/scoring.js';
import { getLeafTopicIds } from '../engine/topics.js';
import { runScan } from './scan.js';
import { runCalibrationQuiz } from './quiz.js';
import { Confirm } from '../ui/components/Confirm.js';
import type { Config } from '../types.js';

function ConfirmApp({ message, defaultValue, onResult }: {
  message: string;
  defaultValue: boolean;
  onResult: (value: boolean) => void;
}) {
  return (
    <Confirm message={message} defaultValue={defaultValue} onConfirm={onResult} />
  );
}

async function askConfirmInk(message: string, defaultValue = true): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const { unmount } = render(
      <ConfirmApp message={message} defaultValue={defaultValue} onResult={(v) => {
        setTimeout(() => { unmount(); resolve(v); }, 50);
      }} />,
    );
  });
}

export async function runInit(projectRoot: string): Promise<void> {
  console.log(chalk.bold('\n  ⚡ Initializing Cognitive Debt Tracker\n'));

  // Check if already initialized
  if (await store.cogtExists(projectRoot)) {
    const overwrite = await askConfirmInk('cogdebt is already initialized here. Re-initialize?', false);
    if (!overwrite) {
      console.log(chalk.dim('  Cancelled.'));
      return;
    }
  }

  // Check it's a git repo
  if (!(await git.isGitRepo(projectRoot))) {
    console.log(chalk.red('  ✗ Not a git repository. cogdebt requires git.'));
    process.exit(1);
  }

  // Check Claude CLI is installed
  if (!(await isClaudeInstalled())) {
    console.log(chalk.red('  ✗ Claude Code CLI is required but not found.'));
    console.log(chalk.dim('    Install it from https://claude.ai/code'));
    process.exit(1);
  }

  // Create .cogt directory
  await store.ensureCogtDir(projectRoot);

  // Get project name
  const projectName = await git.getProjectName(projectRoot);

  // Create config
  const config: Config = {
    version: 1,
    projectName,
    createdAt: new Date().toISOString(),
    lastScanAt: null,
    lastDecayAt: null,
    lastQuizAt: null,
    settings: {
      decayRate: 1.0,
      quizQuestionCount: 5,
      urgentThresholdDays: 7,
    },
  };
  await store.writeConfig(projectRoot, config);

  // Add to .gitignore
  const added = await addToGitignore(projectRoot);
  if (added) {
    console.log(chalk.dim('  Added .cogt/ to .gitignore'));
  }

  // Run scan
  const topics = await runScan(projectRoot);

  if (topics.length === 0) {
    console.log(chalk.yellow('\n  No topics discovered. Try running cogdebt scan again.'));
    return;
  }

  // Initialize scores
  const leafIds = getLeafTopicIds(topics);
  const scores = initializeScores(leafIds, 0);
  await store.writeScores(projectRoot, scores);

  // Set decay cursor to current HEAD
  const head = await git.getHead(projectRoot);
  await store.writeDecayCursor(projectRoot, {
    lastCommitHash: head,
    lastRunAt: new Date().toISOString(),
  });

  // Initialize history
  await store.writeHistory(projectRoot, { version: 1, events: [] });

  // Ask about calibration quiz
  console.log('');
  const runCalibration = await askConfirmInk('Run a calibration quiz to set your initial scores? (recommended)', true);

  if (runCalibration) {
    await runCalibrationQuiz(projectRoot);
  }

  console.log(chalk.green.bold('\n  ✓ cogdebt initialized!\n'));
  console.log(chalk.dim('  Next steps:'));
  console.log(chalk.dim('    cogdebt status    — view your dashboard'));
  console.log(chalk.dim('    cogdebt quiz      — test your understanding'));
  console.log(chalk.dim('    cogdebt hooks     — set up auto-tracking'));
  console.log('');
}
