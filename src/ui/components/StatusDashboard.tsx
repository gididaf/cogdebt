import React from 'react';
import { Text, Box } from 'ink';
import { ScoreText, TrendIcon, DaysAgo, ProgressBar, scoreColor } from './ProgressBar.js';
import type { TopicsFile, ScoresFile, TopicScore, Topic } from '../../types.js';
import {
  computeOverallScore, getTopLevelTopics, getChildTopics,
  computeParentScore, getLeafTopics,
} from '../display.js';

interface StatusDashboardProps {
  topicsFile: TopicsFile;
  scoresFile: ScoresFile;
  projectName: string;
}

function TopicRow({ name, score, trend, lastQuizAt, prefix, bold }: {
  name: string;
  score: number;
  trend?: string;
  lastQuizAt?: string | null;
  prefix?: string;
  bold?: boolean;
}) {
  const paddedName = (prefix || '') + name;
  const padLen = Math.max(0, 38 - paddedName.length);

  return (
    <Box>
      <Text>  </Text>
      {bold
        ? <Text bold>{paddedName}</Text>
        : <Text>{paddedName}</Text>
      }
      <Text>{' '.repeat(padLen)}</Text>
      <ScoreText score={score} />
      {trend != null && (
        <>
          <Text>  </Text>
          <TrendIcon trend={trend} />
        </>
      )}
      {lastQuizAt !== undefined && (
        <>
          <Text>   </Text>
          <DaysAgo dateStr={lastQuizAt} />
        </>
      )}
    </Box>
  );
}

export function StatusDashboard({ topicsFile, scoresFile, projectName }: StatusDashboardProps) {
  // Filter out topics with no quiz-worthy files (and parents that have no quizzable children)
  const allActive = topicsFile.topics.filter(t => !t.deprecated);
  const quizzableLeafIds = new Set(
    allActive
      .filter(t => (t.quizFiles?.length ?? 0) > 0)
      .map(t => t.id),
  );
  const activeTopics = allActive.filter(t => {
    // Keep leaf topics only if they have quiz files
    const isLeaf = !allActive.some(other => other.parentId === t.id);
    if (isLeaf) return quizzableLeafIds.has(t.id);
    // Keep parent topics if they have at least one quizzable descendant
    const hasQuizzableChild = allActive.some(
      child => child.parentId === t.id && (quizzableLeafIds.has(child.id) || allActive.some(gc => gc.parentId === child.id && quizzableLeafIds.has(gc.id))),
    );
    return hasQuizzableChild;
  });
  const { scores } = scoresFile;
  const overall = computeOverallScore(activeTopics, scores);
  const topLevel = getTopLevelTopics(activeTopics);

  const leaves = getLeafTopics(activeTopics);
  const criticalCount = leaves.filter(t => (scores[t.id]?.score ?? 0) < 40).length;
  const lastQuizDates = Object.values(scores).map(s => s.lastQuizAt).filter(Boolean) as string[];
  const mostRecentQuiz = lastQuizDates.length > 0
    ? Math.max(...lastQuizDates.map(d => new Date(d).getTime()))
    : 0;
  const daysSinceQuiz = mostRecentQuiz
    ? Math.floor((Date.now() - mostRecentQuiz) / (1000 * 60 * 60 * 24))
    : -1;

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Box>
        <Text bold>  COGNITIVE DEBT TRACKER</Text>
      </Box>
      <Box>
        <Text dimColor>  Project: {projectName}</Text>
        <Text>  │  Overall: </Text>
        <ScoreText score={overall} />
        <Text>  </Text>
        <ProgressBar score={overall} width={20} />
      </Box>

      <Box marginTop={1} flexDirection="column">
        <Box>
          <Text dimColor>  {'Topic'.padEnd(38)} Score  Trend  Last Quiz</Text>
        </Box>
        <Box>
          <Text dimColor>  {'─'.repeat(62)}</Text>
        </Box>

        {topLevel.map(parent => {
          const children = getChildTopics(activeTopics, parent.id);
          const isLeaf = children.length === 0;
          const parentScore = isLeaf
            ? (scores[parent.id]?.score ?? 0)
            : computeParentScore(parent.id, activeTopics, scores);

          if (isLeaf) {
            const leafScore = scores[parent.id];
            return (
              <TopicRow
                key={parent.id}
                name={parent.name}
                score={leafScore?.score ?? 0}
                trend={leafScore?.trend}
                lastQuizAt={leafScore?.lastQuizAt}
                bold
              />
            );
          }

          return (
            <Box key={parent.id} flexDirection="column">
              <TopicRow name={parent.name} score={parentScore} bold />
              {children.map((child, i) => {
                const grandchildren = getChildTopics(activeTopics, child.id);
                const isLast = i === children.length - 1 && grandchildren.length === 0;
                const prefix = isLast ? '└─ ' : '├─ ';

                if (grandchildren.length > 0) {
                  const childScore = computeParentScore(child.id, activeTopics, scores);
                  return (
                    <Box key={child.id} flexDirection="column">
                      <TopicRow name={child.name} score={childScore} prefix={prefix} />
                      {grandchildren.map((gc, j) => {
                        const gcScore = scores[gc.id];
                        const gcIsLast = j === grandchildren.length - 1;
                        const gcPrefix = (i === children.length - 1 ? '   ' : '│  ') + (gcIsLast ? '└─ ' : '├─ ');
                        return (
                          <TopicRow
                            key={gc.id}
                            name={gc.name}
                            score={gcScore?.score ?? 0}
                            trend={gcScore?.trend}
                            lastQuizAt={gcScore?.lastQuizAt}
                            prefix={gcPrefix}
                          />
                        );
                      })}
                    </Box>
                  );
                }

                const childScore = scores[child.id];
                return (
                  <TopicRow
                    key={child.id}
                    name={child.name}
                    score={childScore?.score ?? 0}
                    trend={childScore?.trend}
                    lastQuizAt={childScore?.lastQuizAt}
                    prefix={prefix}
                  />
                );
              })}
            </Box>
          );
        })}
      </Box>

      {(criticalCount > 0 || daysSinceQuiz > 7 || daysSinceQuiz === -1) && (
        <Box marginTop={1} flexDirection="column">
          <Box>
            <Text color="yellow">  ⚠  </Text>
            <Text bold>Time to quiz!</Text>
          </Box>
          {criticalCount > 0 && (
            <Text color="yellow">     {criticalCount} topic(s) below 40%</Text>
          )}
          {daysSinceQuiz > 7 && (
            <Text color="yellow">     Last quiz was {daysSinceQuiz} days ago</Text>
          )}
          {daysSinceQuiz === -1 && (
            <Text color="yellow">     No quizzes taken yet</Text>
          )}
          <Text dimColor>     Run: cogdebt quiz</Text>
        </Box>
      )}

      <Box marginTop={1}><Text> </Text></Box>
    </Box>
  );
}
