import chalk from 'chalk';
import type { Topic, TopicScore, ScoresFile, TopicsFile } from '../types.js';

// ─── Pure computation functions (used by Ink components) ───

export function getLeafTopics(topics: Topic[]): Topic[] {
  return topics.filter(t => !t.deprecated && !topics.some(other => other.parentId === t.id));
}

export function getTopLevelTopics(topics: Topic[]): Topic[] {
  return topics.filter(t => !t.parentId && !t.deprecated);
}

export function getChildTopics(topics: Topic[], parentId: string): Topic[] {
  return topics.filter(t => t.parentId === parentId && !t.deprecated);
}

export function computeParentScore(topicId: string, topics: Topic[], scores: Record<string, TopicScore>): number {
  const children = getChildTopics(topics, topicId);
  if (children.length === 0) {
    return scores[topicId]?.score ?? 0;
  }
  const childScores = children.map(c => {
    const directChildren = getChildTopics(topics, c.id);
    if (directChildren.length > 0) {
      return computeParentScore(c.id, topics, scores);
    }
    return scores[c.id]?.score ?? 0;
  });
  return Math.round(childScores.reduce((a, b) => a + b, 0) / childScores.length);
}

export function computeOverallScore(topics: Topic[], scores: Record<string, TopicScore>): number {
  const leaves = getLeafTopics(topics);
  if (leaves.length === 0) return 0;
  const leafScores = leaves.map(t => scores[t.id]?.score ?? 0);
  return Math.round(leafScores.reduce((a, b) => a + b, 0) / leafScores.length);
}

// ─── Brief status (plain string, no Ink — used by hooks) ───

export function renderBriefStatus(topicsFile: TopicsFile, scoresFile: ScoresFile): string {
  const activeTopics = topicsFile.topics.filter(t => !t.deprecated);
  const overall = computeOverallScore(activeTopics, scoresFile.scores);
  const criticalCount = getLeafTopics(activeTopics)
    .filter(t => (scoresFile.scores[t.id]?.score ?? 0) < 40).length;

  const lastQuizDates = Object.values(scoresFile.scores)
    .map(s => s.lastQuizAt)
    .filter(Boolean) as string[];
  const mostRecentQuiz = lastQuizDates.length > 0
    ? Math.max(...lastQuizDates.map(d => new Date(d).getTime()))
    : 0;
  const daysSinceQuiz = mostRecentQuiz
    ? Math.floor((Date.now() - mostRecentQuiz) / (1000 * 60 * 60 * 24))
    : -1;

  let status = `cogdebt: ${overall}% overall`;
  if (criticalCount > 0) status += ` | ${criticalCount} critical`;
  if (daysSinceQuiz >= 0) status += ` | quiz ${daysSinceQuiz}d ago`;
  else status += ' | no quizzes yet';
  if (criticalCount > 0 || daysSinceQuiz > 7 || daysSinceQuiz === -1) status += ' ⚠';

  return status;
}

// ─── Chalk-based formatters (for non-Ink output like --brief) ───

export function formatScore(score: number): string {
  const color = score >= 70 ? chalk.green : score >= 40 ? chalk.yellow : chalk.red;
  return color(`${score}%`);
}
