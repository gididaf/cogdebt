import React, { useState } from 'react';
import { Text, Box, useInput } from 'ink';

interface ConfirmProps {
  message: string;
  defaultValue?: boolean;
  onConfirm: (value: boolean) => void;
}

export function Confirm({ message, defaultValue = true, onConfirm }: ConfirmProps) {
  const [answered, setAnswered] = useState(false);
  const [value, setValue] = useState(defaultValue);

  useInput((input, key) => {
    if (answered) return;

    if (input === 'y' || input === 'Y') {
      setAnswered(true);
      setValue(true);
      onConfirm(true);
    } else if (input === 'n' || input === 'N') {
      setAnswered(true);
      setValue(false);
      onConfirm(false);
    } else if (key.return) {
      setAnswered(true);
      onConfirm(defaultValue);
    }
  });

  if (answered) {
    return (
      <Box>
        <Text color="green">✓</Text>
        <Text> {message} </Text>
        <Text color="cyan">{value ? 'Yes' : 'No'}</Text>
      </Box>
    );
  }

  return (
    <Box>
      <Text color="cyan">?</Text>
      <Text> {message} </Text>
      <Text dimColor>({defaultValue ? 'Y/n' : 'y/N'})</Text>
    </Box>
  );
}
