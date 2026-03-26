import React from 'react';
import { Text } from 'ink';

interface ProgressBarProps {
  score: number;
  width?: number;
}

export function scoreColor(score: number): string {
  if (score >= 70) return 'green';
  if (score >= 40) return 'yellow';
  return 'red';
}

export function ProgressBar({ score, width = 10 }: ProgressBarProps) {
  const filled = Math.round((score / 100) * width);
  const empty = width - filled;
  const color = scoreColor(score);

  return (
    <Text>
      <Text color={color}>{'█'.repeat(filled)}</Text>
      <Text dimColor>{'░'.repeat(empty)}</Text>
    </Text>
  );
}

export function ScoreText({ score }: { score: number }) {
  return <Text color={scoreColor(score)}>{score}%</Text>;
}

export function TrendIcon({ trend }: { trend: string }) {
  switch (trend) {
    case 'up': return <Text color="green">↑</Text>;
    case 'down': return <Text color="red">↓</Text>;
    default: return <Text dimColor>→</Text>;
  }
}

export function DaysAgo({ dateStr }: { dateStr: string | null }) {
  if (!dateStr) return <Text dimColor>never</Text>;
  const days = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
  if (days === 0) return <Text color="green">today</Text>;
  if (days === 1) return <Text color="green">yesterday</Text>;
  if (days <= 3) return <Text color="green">{days}d ago</Text>;
  if (days <= 7) return <Text color="yellow">{days}d ago</Text>;
  return <Text color="red">{days}d ago</Text>;
}
