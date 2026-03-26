import React from 'react';
import { render } from 'ink';
import * as store from '../core/store.js';
import { renderBriefStatus } from '../ui/display.js';
import { StatusDashboard } from '../ui/components/StatusDashboard.js';

export async function runStatus(projectRoot: string, options: { brief?: boolean }): Promise<void> {
  if (!(await store.cogtExists(projectRoot))) {
    if (options.brief) {
      console.log('cogdebt: not initialized');
      return;
    }
    console.log('\n  cogdebt is not initialized in this project.');
    console.log('  Run: cogdebt init\n');
    return;
  }

  // Auto-run decay so scores are up-to-date
  const { runDecay } = await import('./decay.js');
  await runDecay(projectRoot, { quiet: true });

  const config = await store.readConfig(projectRoot);
  const topicsFile = await store.readTopics(projectRoot);
  const scoresFile = await store.readScores(projectRoot);

  if (topicsFile.topics.length === 0) {
    if (options.brief) {
      console.log('cogdebt: no topics found');
      return;
    }
    console.log('\n  No topics found. Run: cogdebt scan\n');
    return;
  }

  if (options.brief) {
    console.log(renderBriefStatus(topicsFile, scoresFile));
    return;
  }

  const { unmount, waitUntilExit } = render(
    <StatusDashboard
      topicsFile={topicsFile}
      scoresFile={scoresFile}
      projectName={config.projectName}
    />,
  );

  // One-shot render: unmount after rendering
  await new Promise(resolve => setTimeout(resolve, 50));
  unmount();
}
