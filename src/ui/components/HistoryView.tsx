import React from 'react';
import { Text, Box } from 'ink';
import { ScoreText } from './ProgressBar.js';
import type { HistoryEvent, Topic } from '../../types.js';

interface HistoryViewProps {
  events: HistoryEvent[];
  topics: Topic[];
  limit: number;
  totalEvents: number;
}

function formatDate(timestamp: string): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistoryView({ events, topics, limit, totalEvents }: HistoryViewProps) {
  if (events.length === 0) {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text dimColor>  No history yet.</Text>
        <Box><Text> </Text></Box>
      </Box>
    );
  }

  const findTopic = (id: string) => topics.find(t => t.id === id)?.name || id;

  return (
    <Box flexDirection="column" paddingTop={1}>
      <Text bold>  📜 History</Text>
      <Box marginTop={1} flexDirection="column">
        {events.map((event, i) => {
          const date = formatDate(event.timestamp);

          switch (event.type) {
            case 'scan':
              return (
                <Box key={i}>
                  <Text dimColor>  {date}  </Text>
                  <Text color="blue">SCAN  </Text>
                  <Text>   {event.details}</Text>
                </Box>
              );
            case 'decay': {
              const name = findTopic(event.topicId);
              const change = event.scoreAfter - event.scoreBefore;
              return (
                <Box key={i}>
                  <Text dimColor>  {date}  </Text>
                  <Text color="red">DECAY </Text>
                  <Text>   {name.padEnd(25)} {event.scoreBefore}% → {event.scoreAfter}% ({change}%)  </Text>
                  <Text dimColor>{event.reason}</Text>
                </Box>
              );
            }
            case 'quiz': {
              const name = findTopic(event.topicId);
              const change = event.scoreAfter - event.scoreBefore;
              const sign = change >= 0 ? '+' : '';
              return (
                <Box key={i}>
                  <Text dimColor>  {date}  </Text>
                  <Text color="green">QUIZ  </Text>
                  <Text>   {name.padEnd(25)} {event.scoreBefore}% → {event.scoreAfter}% ({sign}{change}%)  </Text>
                  <Text dimColor>{event.correctAnswers.toFixed(1)}/{event.questionsAsked} correct</Text>
                </Box>
              );
            }
            case 'calibration': {
              const name = findTopic(event.topicId);
              return (
                <Box key={i}>
                  <Text dimColor>  {date}  </Text>
                  <Text color="cyan">CALIBR</Text>
                  <Text>   {name.padEnd(25)} → </Text>
                  <ScoreText score={event.scoreAfter} />
                </Box>
              );
            }
          }
        })}
      </Box>
      {totalEvents > limit && (
        <Box marginTop={1}>
          <Text dimColor>  Showing {limit} of {totalEvents} events. Use --limit to see more.</Text>
        </Box>
      )}
      <Box><Text> </Text></Box>
    </Box>
  );
}
