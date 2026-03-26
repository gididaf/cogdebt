import type { TopicScore, ScoresFile, Topic, CoverageFile } from '../types.js';
import { parseCoverageKey } from '../core/store.js';
import type { BlockInfo } from './quiz-engine.js';

// ─── Coverage-based scoring (block-level) ─────────────

export function computeCoverageScore(topicId: string, _topics: Topic[], coverage: CoverageFile): number {
  // Count blocks from coverage keys matching this topic
  const prefix = `${topicId}::`;
  let total = 0;
  let covered = 0;
  for (const key of Object.keys(coverage.files)) {
    if (key.startsWith(prefix)) {
      total++;
      if (coverage.files[key].covered) covered++;
    }
  }
  if (total === 0) return 0;
  return Math.round((covered / total) * 100);
}

export function getUncoveredBlocks(topicId: string, coverage: CoverageFile): Array<{ filePath: string; blockIndex: number }> {
  const prefix = `${topicId}::`;
  const result: Array<{ filePath: string; blockIndex: number }> = [];
  for (const key of Object.keys(coverage.files)) {
    if (key.startsWith(prefix) && !coverage.files[key].covered) {
      const parsed = parseCoverageKey(key);
      result.push({ filePath: parsed.filePath, blockIndex: parsed.blockIndex });
    }
  }
  return result;
}

export function getCoveredBlocks(topicId: string, coverage: CoverageFile): Array<{ filePath: string; blockIndex: number }> {
  const prefix = `${topicId}::`;
  const result: Array<{ filePath: string; blockIndex: number }> = [];
  for (const key of Object.keys(coverage.files)) {
    if (key.startsWith(prefix) && coverage.files[key].covered) {
      const parsed = parseCoverageKey(key);
      result.push({ filePath: parsed.filePath, blockIndex: parsed.blockIndex });
    }
  }
  return result;
}

// Backward compat: get uncovered files (unique file paths from uncovered blocks)
export function getUncoveredFiles(topicId: string, topics: Topic[], coverage: CoverageFile): string[] {
  const blocks = getUncoveredBlocks(topicId, coverage);
  return [...new Set(blocks.map(b => b.filePath))];
}

// ─── Quiz score update (still needed for answer evaluation) ──

export function updateScoreFromQuiz(currentScore: number, quizPerformance: number): number {
  const targetScore = 5 + (quizPerformance * 90);
  const gap = targetScore - currentScore;
  const moveRate = gap > 0 ? 0.6 : 0.4;
  const newScore = Math.round(currentScore + (gap * moveRate));
  return Math.max(0, Math.min(100, newScore));
}

// ─── Trend computation ─────────────────────────────────

export function computeTrend(history: Array<{ scoreBefore: number; scoreAfter: number }>): 'up' | 'down' | 'stable' {
  if (history.length === 0) return 'stable';
  const recent = history.slice(-3);
  const totalChange = recent.reduce((sum, h) => sum + (h.scoreAfter - h.scoreBefore), 0);
  if (totalChange > 3) return 'up';
  if (totalChange < -3) return 'down';
  return 'stable';
}

// ─── Score initialization (for backward compat) ────────

export function initializeScores(topicIds: string[], defaultScore = 0): ScoresFile {
  const scores: Record<string, TopicScore> = {};
  for (const id of topicIds) {
    scores[id] = {
      score: defaultScore,
      trend: 'stable',
      lastQuizAt: null,
      lastDecayAt: null,
    };
  }
  return { version: 1, scores };
}

export function ensureTopicScore(scores: ScoresFile, topicId: string, defaultScore = 0): void {
  if (!scores.scores[topicId]) {
    scores.scores[topicId] = {
      score: defaultScore,
      trend: 'stable',
      lastQuizAt: null,
      lastDecayAt: null,
    };
  }
}
