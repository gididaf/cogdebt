import React from 'react';
import { Text, Box } from 'ink';
import { ScoreText } from './ProgressBar.js';

interface DecayItem {
  topicName: string;
  scoreBefore: number;
  scoreAfter: number;
  reason: string;
}

interface DecayOutputProps {
  items: DecayItem[];
}

export function DecayOutput({ items }: DecayOutputProps) {
  if (items.length === 0) {
    return (
      <Box flexDirection="column" paddingTop={1}>
        <Text dimColor>  No significant decay detected.</Text>
        <Box><Text> </Text></Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" paddingTop={1}>
      {items.map((item, i) => {
        const change = item.scoreAfter - item.scoreBefore;
        return (
          <Box key={i}>
            <Text>  {item.topicName.padEnd(30)} </Text>
            <ScoreText score={item.scoreBefore} />
            <Text> → </Text>
            <ScoreText score={item.scoreAfter} />
            <Text color="red"> ({change}%) </Text>
            <Text dimColor>{item.reason}</Text>
          </Box>
        );
      })}
      <Box><Text> </Text></Box>
    </Box>
  );
}
