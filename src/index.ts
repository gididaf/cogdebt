import { Command } from 'commander';
import { findProjectRoot } from './core/config.js';
import { CogtError, ClaudeCliError } from './types.js';

const program = new Command();

program
  .name('cogdebt')
  .description('Cognitive Debt Tracker — quantify and close your understanding gap')
  .version('1.0.1');

program
  .command('init')
  .description('Initialize cogdebt for the current project')
  .action(async () => {
    const { runInit } = await import('./commands/init.js');
    await runInit(findProjectRoot());
  });

program
  .command('scan')
  .description('Discover or update topics from the codebase')
  .action(async () => {
    const { runScan } = await import('./commands/scan.js');
    await runScan(findProjectRoot());
  });

program
  .command('status')
  .description('Show your cognitive debt dashboard')
  .option('--brief', 'One-line output for hooks/status bars')
  .action(async (options) => {
    const { runStatus } = await import('./commands/status.js');
    await runStatus(findProjectRoot(), options);
  });

program
  .command('decay')
  .description('Analyze recent changes and adjust understanding scores')
  .option('--quiet', 'Suppress output (for git hooks)')
  .action(async (options) => {
    const { runDecay } = await import('./commands/decay.js');
    await runDecay(findProjectRoot(), options);
  });

program
  .command('quiz')
  .description('Test your understanding with an interactive quiz')
  .action(async () => {
    const { runQuiz } = await import('./commands/quiz.js');
    await runQuiz(findProjectRoot());
  });

program
  .command('history')
  .description('Show score change history')
  .option('--limit <n>', 'Number of events to show', '20')
  .action(async (options) => {
    const { runHistory } = await import('./commands/history.js');
    await runHistory(findProjectRoot(), { limit: parseInt(options.limit, 10) });
  });

program
  .command('hooks')
  .description('Set up Claude Code status line and git hooks')
  .action(async () => {
    const { runHooks } = await import('./commands/hooks.js');
    await runHooks(findProjectRoot());
  });

// Error handling
program.hook('postAction', () => {});

async function main() {
  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    if (error instanceof ClaudeCliError) {
      console.error(`\n  ✗ Claude CLI Error: ${error.message}`);
      if (error.stderr) {
        console.error(`    ${error.stderr.slice(0, 200)}`);
      }
      process.exit(1);
    }
    if (error instanceof CogtError) {
      console.error(`\n  ✗ ${error.message}`);
      process.exit(1);
    }
    if (error instanceof Error) {
      console.error(`\n  ✗ Unexpected error: ${error.message}`);
      process.exit(1);
    }
    throw error;
  }
}

main();
