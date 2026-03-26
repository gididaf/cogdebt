import React, { useState } from 'react';
import { Text, Box, useInput } from 'ink';

interface QuestionCountPickerProps {
  defaultCount: number;
  min?: number;
  max?: number;
  totalLoc?: number;
  blockCount?: number;
  fileCount?: number; // deprecated, use blockCount
  onSubmit: (count: number) => void;
}

export function QuestionCountPicker({ defaultCount, min = 1, max = 10, totalLoc, blockCount, fileCount, onSubmit }: QuestionCountPickerProps) {
  const [count, setCount] = useState(Math.min(defaultCount, max));

  useInput((input, key) => {
    if (key.leftArrow || key.downArrow) {
      setCount(c => Math.max(min, c - 1));
    }
    if (key.rightArrow || key.upArrow) {
      setCount(c => Math.min(max, c + 1));
    }
    if (key.return) {
      onSubmit(count);
    }
    const num = parseInt(input, 10);
    if (num >= min && num <= max) {
      setCount(num);
    }
  });

  const dots = [];
  for (let i = min; i <= max; i++) {
    if (i === count) {
      dots.push(<Text key={i} bold color="cyan"> {i} </Text>);
    } else {
      dots.push(<Text key={i} dimColor> {i} </Text>);
    }
  }

  return (
    <Box flexDirection="column">
      <Box marginTop={1}>
        <Text bold>  How many questions?</Text>
        {totalLoc != null && (blockCount != null || fileCount != null) && (
          <Text dimColor>  ({blockCount ?? fileCount} uncovered blocks, ~{totalLoc.toLocaleString()} lines)</Text>
        )}
      </Box>
      <Box marginTop={1}>
        <Text>  </Text>
        {dots}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>  [←→] adjust  [Enter] confirm</Text>
      </Box>
    </Box>
  );
}
