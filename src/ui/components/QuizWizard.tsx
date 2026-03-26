import React, { useState, useCallback } from 'react';
import { Text, Box, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { Spinner } from './Spinner.js';

export interface QuizQuestionData {
  topicName: string;
  type: string;
  question: string;
  relevantFiles: string[];
  lineRange?: string;
}

export interface QuizResult {
  questionIndex: number;
  score: number;
  feedback: string;
}

type WizardMode = 'browsing' | 'answering' | 'submitting' | 'results' | 'quit';

interface QuizWizardProps {
  questions: QuizQuestionData[];
  onSubmit: (answers: string[]) => Promise<QuizResult[]>;
  onDone: (answers: string[], results: QuizResult[] | null) => void;
}

function QuestionTabs({ current, total, answers }: { current: number; total: number; answers: string[] }) {
  const tabs = [];
  for (let i = 0; i < total; i++) {
    const hasAnswer = !!answers[i];
    const isCurrent = i === current;

    if (isCurrent) {
      tabs.push(<Text key={i} bold color="cyan">[Q{i + 1}]</Text>);
    } else if (hasAnswer) {
      tabs.push(<Text key={i} color="green"> Q{i + 1} </Text>);
    } else {
      tabs.push(<Text key={i} dimColor> Q{i + 1} </Text>);
    }
  }

  return (
    <Box>
      <Text>  </Text>
      {tabs}
    </Box>
  );
}

function StatusDots({ current, total, answers }: { current: number; total: number; answers: string[] }) {
  const dots = [];
  for (let i = 0; i < total; i++) {
    const hasAnswer = !!answers[i];
    const isCurrent = i === current;

    if (isCurrent) {
      dots.push(<Text key={i} color="cyan">●</Text>);
    } else if (hasAnswer) {
      dots.push(<Text key={i} color="green">✓</Text>);
    } else {
      dots.push(<Text key={i} dimColor>○</Text>);
    }
    if (i < total - 1) dots.push(<Text key={`s${i}`}> </Text>);
  }

  return (
    <Box>
      <Text>  </Text>
      {dots}
    </Box>
  );
}

function QuestionView({ question, index, total }: {
  question: QuizQuestionData;
  index: number;
  total: number;
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text>  </Text>
        <Text bold color="cyan">[{index + 1}/{total}] {question.type.replace(/_/g, ' ').toUpperCase()}</Text>
      </Box>
      <Box>
        <Text dimColor>  Topic: {question.topicName}</Text>
      </Box>
      <Box marginTop={1}>
        <Text>  {question.question}</Text>
      </Box>
      {question.relevantFiles.length > 0 && (
        <Box marginTop={1}>
          <Text dimColor>  Files: {question.relevantFiles.join(', ')}{question.lineRange ? ` (${question.lineRange})` : ''}</Text>
        </Box>
      )}
    </Box>
  );
}

function ResultsView({ questions, results }: {
  questions: QuizQuestionData[];
  results: QuizResult[];
}) {
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Text bold>  📊 Results</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {results.map((r, i) => {
          const label = r.score >= 0.7 ? '✓ Got it ' : r.score >= 0.4 ? '~ Partial' : '✗ Missed';
          const color = r.score >= 0.7 ? 'green' : r.score >= 0.4 ? 'yellow' : 'red';
          return (
            <Box key={i} marginBottom={1} flexDirection="column">
              <Box>
                <Text>  Q{i + 1}: </Text>
                <Text color={color}>{label}</Text>
              </Box>
              {r.feedback && (
                <Box>
                  <Text dimColor>       {r.feedback.length > 100 ? r.feedback.slice(0, 100) + '...' : r.feedback}</Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

// Pad output to a minimum number of lines to prevent Ink ghost lines
function PaddedContainer({ children, minLines = 15 }: { children: React.ReactNode; minLines?: number }) {
  return (
    <Box flexDirection="column">
      {children}
      {/* Padding lines to keep consistent height */}
      {Array.from({ length: minLines }).map((_, i) => (
        <Text key={`pad-${i}`}> </Text>
      ))}
    </Box>
  );
}

export function QuizWizard({ questions, onSubmit, onDone }: QuizWizardProps) {
  const { exit } = useApp();
  const total = questions.length;
  const [mode, setMode] = useState<WizardMode>('browsing');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [answers, setAnswers] = useState<string[]>(new Array(total).fill(''));
  const [inputValue, setInputValue] = useState('');
  const [results, setResults] = useState<QuizResult[] | null>(null);

  const goTo = useCallback((index: number) => {
    if (index >= 0 && index < total) {
      setCurrentIndex(index);
      setInputValue(answers[index] || '');
    }
  }, [total, answers]);

  const goNext = useCallback(() => {
    goTo((currentIndex + 1) % total);
  }, [currentIndex, total, goTo]);

  const goPrev = useCallback(() => {
    goTo((currentIndex - 1 + total) % total);
  }, [currentIndex, total, goTo]);

  const saveAnswer = useCallback((value: string) => {
    const newAnswers = [...answers];
    newAnswers[currentIndex] = value;
    setAnswers(newAnswers);
  }, [answers, currentIndex]);

  const handleSubmit = useCallback(async () => {
    setMode('submitting');
    try {
      const evalResults = await onSubmit(answers);
      setResults(evalResults);
      setMode('results');
    } catch (err) {
      setMode('browsing');
    }
  }, [answers, onSubmit]);

  useInput((input, key) => {
    if (mode === 'submitting') return;

    if (mode === 'results') {
      if (key.return || input === 'q') {
        onDone(answers, results);
      }
      return;
    }

    if (mode === 'quit') return;

    if (mode === 'answering') {
      if (key.escape) {
        saveAnswer(inputValue);
        setMode('browsing');
      }
      return;
    }

    // BROWSING mode
    if (key.return) {
      setInputValue(answers[currentIndex] || '');
      setMode('answering');
      return;
    }

    if (key.tab) {
      if (key.shift) {
        goPrev();
      } else {
        goNext();
      }
      return;
    }

    if (key.leftArrow) { goPrev(); return; }
    if (key.rightArrow) { goNext(); return; }

    if (input === 's') {
      if (answers.some(a => !!a)) {
        handleSubmit();
      }
      return;
    }

    if (input === 'q') {
      onDone(answers, null);
      return;
    }

    const num = parseInt(input, 10);
    if (num >= 1 && num <= total) {
      goTo(num - 1);
    }
  }, { isActive: mode !== 'answering' });

  if (mode === 'submitting') {
    return (
      <PaddedContainer>
        <Box marginTop={1}>
          <Spinner label="Evaluating your answers..." />
        </Box>
      </PaddedContainer>
    );
  }

  if (mode === 'results' && results) {
    return (
      <PaddedContainer minLines={5}>
        <ResultsView questions={questions} results={results} />
        <Box marginTop={1}>
          <Text dimColor>  Press Enter to continue</Text>
        </Box>
      </PaddedContainer>
    );
  }

  const question = questions[currentIndex];

  return (
    <PaddedContainer>
      <QuestionTabs current={currentIndex} total={total} answers={answers} />
      <StatusDots current={currentIndex} total={total} answers={answers} />

      <QuestionView question={question} index={currentIndex} total={total} />

      <Box marginTop={1}>
        <Text>  </Text>
        {mode === 'answering' ? (
          <Box>
            <Text color="cyan">&gt; </Text>
            <TextInput
              value={inputValue}
              onChange={setInputValue}
              onSubmit={(value) => {
                saveAnswer(value);
                setMode('browsing');
                if (currentIndex < total - 1) {
                  goTo(currentIndex + 1);
                }
              }}
              placeholder="Type your answer..."
            />
          </Box>
        ) : answers[currentIndex] ? (
          <Text dimColor>Your answer: {answers[currentIndex].length > 60 ? answers[currentIndex].slice(0, 60) + '...' : answers[currentIndex]}</Text>
        ) : (
          <Text dimColor>Press Enter to answer</Text>
        )}
      </Box>

      {mode === 'browsing' && (
        <Box marginTop={1}>
          <Text dimColor>  [Tab] next  [Shift+Tab] prev  [1-{total}] jump  {answers.some(a => !!a) ? '[s] submit  ' : ''}[Enter] answer</Text>
        </Box>
      )}
      {mode === 'answering' && (
        <Box marginTop={1}>
          <Text dimColor>  [Enter] save & next  [Esc] cancel</Text>
        </Box>
      )}
    </PaddedContainer>
  );
}
