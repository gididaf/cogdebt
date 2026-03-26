import React from 'react';
import { render } from 'ink';
import * as store from '../core/store.js';
import { HistoryView } from '../ui/components/HistoryView.js';

export async function runHistory(projectRoot: string, options: { limit?: number }): Promise<void> {
  if (!(await store.cogtExists(projectRoot))) {
    console.log('\n  cogdebt is not initialized. Run: cogdebt init\n');
    return;
  }

  const history = await store.readHistory(projectRoot);
  const topicsFile = await store.readTopics(projectRoot);
  const limit = options.limit || 20;
  const events = history.events.slice(-limit).reverse();

  const { unmount } = render(
    <HistoryView
      events={events}
      topics={topicsFile.topics}
      limit={limit}
      totalEvents={history.events.length}
    />,
  );

  await new Promise(resolve => setTimeout(resolve, 50));
  unmount();
}
