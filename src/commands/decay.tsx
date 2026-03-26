import React from 'react';
import { render } from 'ink';
import chalk from 'chalk';
import * as store from '../core/store.js';
import * as git from '../core/git.js';
import { computeTrend, computeCoverageScore, getCoveredBlocks } from '../engine/scoring.js';
import { countFileLines, computeFileBlockCount, getAffectedBlockIndices } from '../engine/quiz-engine.js';
import { DecayOutput } from '../ui/components/DecayOutput.js';
import type { HistoryEvent } from '../types.js';

export async function runDecay(projectRoot: string, options: { quiet?: boolean }): Promise<void> {
  if (!(await store.cogtExists(projectRoot))) {
    if (!options.quiet) {
      console.log(chalk.yellow('\n  cogdebt is not initialized. Run: cogdebt init\n'));
    }
    return;
  }

  const cursor = await store.readDecayCursor(projectRoot);
  const currentHead = await git.getHead(projectRoot);

  if (!cursor) {
    await store.writeDecayCursor(projectRoot, {
      lastCommitHash: currentHead,
      lastRunAt: new Date().toISOString(),
    });
    if (!options.quiet) {
      console.log(chalk.dim('\n  Decay cursor initialized. Will track changes from now.\n'));
    }
    return;
  }

  if (cursor.lastCommitHash === currentHead) {
    if (!options.quiet) {
      const commitSubject = await git.getCommitSubject(currentHead, projectRoot);
      console.log(chalk.dim(`\n  No new commits since last decay run. (${cursor.lastCommitHash.slice(0, 7)} ${commitSubject})\n`));
    }
    return;
  }

  // Get changed files with hunk-level line ranges
  let fileHunks: Map<string, Array<{ startLine: number; lineCount: number }>>;
  let hunkFallback = false;
  try {
    fileHunks = await git.diffHunks(cursor.lastCommitHash, currentHead, projectRoot);
  } catch {
    // Fallback to file-level diff if hunk parsing fails
    hunkFallback = true;
    const changedFiles = await git.diffStat(cursor.lastCommitHash, currentHead, projectRoot);
    fileHunks = new Map(changedFiles.map(f => [f, []])); // empty hunks = uncovering all blocks
  }

  if (fileHunks.size === 0) {
    await store.writeDecayCursor(projectRoot, {
      lastCommitHash: currentHead,
      lastRunAt: new Date().toISOString(),
    });
    if (!options.quiet) {
      console.log(chalk.dim('\n  No file changes detected.\n'));
    }
    return;
  }

  const topicsFile = await store.readTopics(projectRoot);
  const coverage = await store.readCoverage(projectRoot);

  // Build granular entries: which specific blocks were affected per topic+file
  const granularEntries: Array<{ topicId: string; filePath: string; blockIndices: number[] }> = [];
  const affectedTopicIds = new Set<string>();

  for (const [changedFile, hunks] of fileHunks) {
    // Find all topics that reference this file
    const relatedTopics = topicsFile.topics.filter(t => t.quizFiles?.includes(changedFile));
    if (relatedTopics.length === 0) continue;

    const totalLines = await countFileLines(changedFile, projectRoot);
    if (totalLines === null) continue; // File deleted — skip

    const newBlockCount = computeFileBlockCount(totalLines);

    let affectedBlocks: number[];
    if (hunks.length > 0) {
      // Granular: map hunk line ranges to specific block indices
      affectedBlocks = getAffectedBlockIndices(hunks, totalLines);
    } else {
      // Fallback: no hunk data, uncovering all blocks
      affectedBlocks = Array.from({ length: newBlockCount }, (_, i) => i);
    }

    for (const topic of relatedTopics) {
      // Sync block count if file size changed
      await store.syncFileBlocks(projectRoot, topic.id, changedFile, newBlockCount);

      granularEntries.push({ topicId: topic.id, filePath: changedFile, blockIndices: affectedBlocks });
      affectedTopicIds.add(topic.id);
    }
  }

  if (granularEntries.length === 0) {
    await store.writeDecayCursor(projectRoot, {
      lastCommitHash: currentHead,
      lastRunAt: new Date().toISOString(),
    });
    if (!options.quiet) {
      console.log(chalk.dim('\n  Changes don\'t affect any tracked quiz files.\n'));
    }
    return;
  }

  // Count previously covered blocks before uncovering (for display)
  const previouslyCoveredCount = new Map<string, number>();
  for (const e of granularEntries) {
    const coveredBlocks = getCoveredBlocks(e.topicId, coverage)
      .filter(b => b.filePath === e.filePath && e.blockIndices.includes(b.blockIndex));
    if (coveredBlocks.length > 0) {
      const key = `${e.topicId}::${e.filePath}`;
      previouslyCoveredCount.set(key, coveredBlocks.length);
    }
  }

  // Mark only the affected blocks as uncovered
  await store.markSpecificBlocksUncovered(projectRoot, granularEntries);

  // Clear quiz history for affected topics
  if (affectedTopicIds.size > 0) {
    await store.clearTopicQuizHistory(projectRoot, Array.from(affectedTopicIds));
  }

  // Compute score changes per topic
  const now = new Date().toISOString();
  const updatedCoverage = await store.readCoverage(projectRoot);
  const scoresFile = await store.readScores(projectRoot);
  const historyEvents: HistoryEvent[] = [];
  const decayItems: Array<{ topicName: string; scoreBefore: number; scoreAfter: number; reason: string }> = [];

  for (const topicId of affectedTopicIds) {
    const topic = topicsFile.topics.find(t => t.id === topicId);
    if (!topic) continue;

    const oldScore = scoresFile.scores[topicId]?.score ?? 0;
    const newScore = computeCoverageScore(topicId, topicsFile.topics, updatedCoverage);

    if (oldScore !== newScore) {
      if (!scoresFile.scores[topicId]) {
        scoresFile.scores[topicId] = { score: 0, trend: 'stable', lastQuizAt: null, lastDecayAt: null };
      }
      scoresFile.scores[topicId].score = newScore;
      scoresFile.scores[topicId].lastDecayAt = now;

      const blocksLost = granularEntries
        .filter(e => e.topicId === topicId)
        .reduce((sum, e) => sum + (previouslyCoveredCount.get(`${e.topicId}::${e.filePath}`) || 0), 0);
      const filesChanged = granularEntries.filter(e => e.topicId === topicId).length;
      decayItems.push({
        topicName: topic.name,
        scoreBefore: oldScore,
        scoreAfter: newScore,
        reason: `${filesChanged} file(s) changed → ${blocksLost} block(s) uncovered`,
      });

      historyEvents.push({
        type: 'decay',
        timestamp: now,
        topicId,
        scoreBefore: oldScore,
        scoreAfter: newScore,
        reason: `${filesChanged} file(s) changed, ${blocksLost} block(s) uncovered`,
        commitRange: `${cursor.lastCommitHash.slice(0, 7)}..${currentHead.slice(0, 7)}`,
      });
    }
  }

  // Update trends
  const history = await store.readHistory(projectRoot);
  for (const topicId of Object.keys(scoresFile.scores)) {
    const topicHistory = [...history.events, ...historyEvents]
      .filter((e): e is Extract<HistoryEvent, { topicId: string }> =>
        'topicId' in e && e.topicId === topicId,
      )
      .map(e => ({ scoreBefore: e.scoreBefore, scoreAfter: e.scoreAfter }));
    scoresFile.scores[topicId].trend = computeTrend(topicHistory);
  }

  // Save
  await store.writeScores(projectRoot, scoresFile);
  for (const event of historyEvents) {
    await store.appendHistory(projectRoot, event);
  }
  await store.writeDecayCursor(projectRoot, {
    lastCommitHash: currentHead,
    lastRunAt: now,
  });

  const config = await store.readConfig(projectRoot);
  config.lastDecayAt = now;
  await store.writeConfig(projectRoot, config);

  if (!options.quiet) {
    if (decayItems.length > 0) {
      const { unmount } = render(<DecayOutput items={decayItems} />);
      await new Promise(resolve => setTimeout(resolve, 50));
      unmount();
    } else {
      console.log(chalk.dim('\n  Files changed but no coverage impact.\n'));
    }
    if (hunkFallback) {
      console.log(chalk.yellow('  ⚠ Hunk parsing failed — all blocks in changed files were uncovered. This is more aggressive than normal.'));
    }
  }
}
