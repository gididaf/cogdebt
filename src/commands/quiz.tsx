import React, { useState } from 'react';
import { render, Text, Box } from 'ink';
import chalk from 'chalk';
import * as store from '../core/store.js';
import { selectQuizTopics, generateQuestions, evaluateAnswers, computeRecommendedQuestionCount, countFileLines, computeFileBlockCount, getBlockLineRange, type BlockInfo } from '../engine/quiz-engine.js';
import { computeTrend, ensureTopicScore, getUncoveredBlocks } from '../engine/scoring.js';
import { Spinner } from '../ui/components/Spinner.js';
import { QuizWizard, type QuizQuestionData, type QuizResult } from '../ui/components/QuizWizard.js';
import { TopicSelector } from '../ui/components/TopicSelector.js';
import { QuestionCountPicker } from '../ui/components/QuestionCountPicker.js';
import { ScoreText } from '../ui/components/ProgressBar.js';
import type { Topic, QuizQuestion, HistoryEvent, TopicsFile, ScoresFile } from '../types.js';

function toWizardQuestions(questions: QuizQuestion[], topics: Topic[], blockMap?: Map<string, BlockInfo>): QuizQuestionData[] {
  return questions.map(q => {
    const block = blockMap?.get(`${q.topicId}::${q.relevantFiles[0]}::${q.blockIndex}`);
    return {
      topicName: topics.find(t => t.id === q.topicId)?.name || q.topicId,
      type: q.type,
      question: q.question,
      relevantFiles: q.relevantFiles,
      lineRange: block ? `lines ${block.startLine}-${block.endLine}` : undefined,
    };
  });
}

function QuizApp({ questions, wizardQuestions, topicsFile, scoresFile, projectRoot, sessionType, onExit }: {
  questions: QuizQuestion[];
  wizardQuestions: QuizQuestionData[];
  topicsFile: TopicsFile;
  scoresFile: ScoresFile;
  projectRoot: string;
  sessionType: 'quiz' | 'calibration';
  onExit: () => void;
}) {
  const [phase, setPhase] = useState<'quiz' | 'done'>('quiz');
  const [scoreChanges, setScoreChanges] = useState<Array<{ name: string; before: number; after: number }>>([]);

  const handleSubmit = async (answers: string[]): Promise<QuizResult[]> => {
    const qaPairs = questions.map((q, i) => ({
      question: q,
      answer: answers[i] || '',
    })).filter(qa => qa.answer.length > 0);

    if (qaPairs.length === 0) return [];

    const { evaluations } = await evaluateAnswers(qaPairs, projectRoot);

    const topicScoreUpdates = new Map<string, number[]>();
    for (let i = 0; i < evaluations.length; i++) {
      const evaluation = evaluations[i];
      const qa = qaPairs[evaluation.questionIndex ?? i];
      if (qa?.question) {
        const existing = topicScoreUpdates.get(qa.question.topicId) || [];
        existing.push(evaluation.score);
        topicScoreUpdates.set(qa.question.topicId, existing);

        // Mark block as covered if score >= 0.5
        if (evaluation.score >= 0.5 && qa.question.blockIndex != null) {
          await store.markBlockCovered(projectRoot, qa.question.topicId, qa.question.relevantFiles[0], qa.question.blockIndex, evaluation.score);
        } else if (evaluation.score >= 0.5 && qa.question.relevantFiles.length > 0) {
          // Fallback for questions without blockIndex
          await store.markFilesCovered(projectRoot, qa.question.relevantFiles, qa.question.topicId, evaluation.score);
        }
      }
    }

    const now = new Date().toISOString();
    const changes: typeof scoreChanges = [];
    const historyEvents: HistoryEvent[] = [];

    // Recompute coverage scores after marking files
    const updatedCoverage = await store.readCoverage(projectRoot);

    for (const [topicId, evalScores] of topicScoreUpdates) {
      ensureTopicScore(scoresFile, topicId);
      const current = scoresFile.scores[topicId];
      const scoreBefore = current.score;

      // Score is now coverage-based
      const { computeCoverageScore } = await import('../engine/scoring.js');
      const scoreAfter = computeCoverageScore(topicId, topicsFile.topics, updatedCoverage);

      current.score = scoreAfter;
      current.lastQuizAt = now;

      const topic = topicsFile.topics.find(t => t.id === topicId);
      changes.push({ name: topic?.name || topicId, before: scoreBefore, after: scoreAfter });

      historyEvents.push({
        type: sessionType,
        timestamp: now,
        topicId,
        scoreBefore,
        scoreAfter,
        questionsAsked: evalScores.length,
        correctAnswers: evalScores.reduce((a, b) => a + b, 0),
      });
    }

    const history = await store.readHistory(projectRoot);
    for (const topicId of Object.keys(scoresFile.scores)) {
      const topicHistory = [...history.events, ...historyEvents]
        .filter((e): e is Extract<HistoryEvent, { topicId: string }> =>
          'topicId' in e && e.topicId === topicId,
        )
        .map(e => ({ scoreBefore: e.scoreBefore, scoreAfter: e.scoreAfter }));
      scoresFile.scores[topicId].trend = computeTrend(topicHistory);
    }

    await store.writeScores(projectRoot, scoresFile);
    for (const event of historyEvents) {
      await store.appendHistory(projectRoot, event);
    }

    const configData = await store.readConfig(projectRoot);
    configData.lastQuizAt = now;
    await store.writeConfig(projectRoot, configData);

    setScoreChanges(changes);

    return evaluations.map(e => ({
      questionIndex: e.questionIndex,
      score: e.score,
      feedback: e.feedback,
    }));
  };

  const handleDone = () => {
    setPhase('done');
    setTimeout(onExit, 100);
  };

  if (phase === 'done') {
    return (
      <Box flexDirection="column">
        {scoreChanges.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>  📈 Score Changes</Text>
            <Box marginTop={1} flexDirection="column">
              {scoreChanges.map((c, i) => {
                const change = c.after - c.before;
                const changeColor = change >= 0 ? 'green' : 'red';
                const sign = change >= 0 ? '+' : '';
                return (
                  <Box key={i}>
                    <Text>  {c.name.padEnd(30)} </Text>
                    <ScoreText score={c.before} />
                    <Text> → </Text>
                    <ScoreText score={c.after} />
                    <Text color={changeColor}> ({sign}{change})</Text>
                  </Box>
                );
              })}
            </Box>
          </Box>
        )}
        <Box><Text> </Text></Box>
      </Box>
    );
  }

  return (
    <QuizWizard
      questions={wizardQuestions}
      onSubmit={handleSubmit}
      onDone={handleDone}
    />
  );
}

// ─── Topic selection step (Ink) ────────────────────────

async function selectTopicsInk(
  leafTopics: Topic[],
  allTopics: Topic[],
  scores: Record<string, import('../types.js').TopicScore>,
  preSelectedIds: string[],
): Promise<string[]> {
  return new Promise<string[]>((resolve) => {
    const { unmount } = render(
      <TopicSelector
        topics={leafTopics}
        allTopics={allTopics}
        scores={scores}
        preSelected={preSelectedIds}
        onSubmit={(ids) => {
          setTimeout(() => { unmount(); resolve(ids); }, 50);
        }}
      />,
    );
  });
}

// ─── Question count step (Ink) ─────────────────────────

async function pickQuestionCount(opts: {
  recommended: number;
  max: number;
  totalLoc: number;
  blockCount: number;
}): Promise<number> {
  return new Promise<number>((resolve) => {
    const { unmount } = render(
      <QuestionCountPicker
        defaultCount={opts.recommended}
        min={1}
        max={Math.max(opts.max, 1)}
        totalLoc={opts.totalLoc}
        blockCount={opts.blockCount}
        onSubmit={(count) => {
          setTimeout(() => { unmount(); resolve(count); }, 50);
        }}
      />,
    );
  });
}

// ─── Generate + run quiz ───────────────────────────────

async function runQuizCommon(
  projectRoot: string,
  selectedTopics: Topic[],
  topicsFile: TopicsFile,
  scoresFile: ScoresFile,
  questionCount: number,
  sessionType: 'quiz' | 'calibration',
  selectedBlocks?: BlockInfo[],
): Promise<void> {
  // Load previously asked questions to avoid repeats
  const quizHistory = await store.readQuizHistory(projectRoot);
  const previousQuestions: Record<string, import('../types.js').AskedQuestion[]> = {};
  for (const t of selectedTopics) {
    if (quizHistory.topics[t.id]?.length) {
      previousQuestions[t.id] = quizHistory.topics[t.id];
    }
  }

  // If blocks not provided, compute them
  if (!selectedBlocks) {
    const coverage = await store.readCoverage(projectRoot);
    const allUncoveredBlocks = await getUncoveredBlocksWithInfo(selectedTopics, coverage, projectRoot);
    selectedBlocks = selectRandomBlocks(allUncoveredBlocks, questionCount);
  }

  // Generate questions (with spinner)
  console.log('');
  const { unmount: spinnerUnmount } = render(<Spinner label="Generating questions based on your code..." />);

  let questions: QuizQuestion[];

  try {
    const result = await generateQuestions(selectedBlocks, scoresFile.scores, projectRoot, previousQuestions);
    questions = result.questions;
  } finally {
    spinnerUnmount();
  }

  if (questions.length === 0) {
    console.log(chalk.yellow('\n  Could not generate questions. Try again.\n'));
    return;
  }

  // Record these questions so they won't be repeated
  const questionsByTopic = new Map<string, Array<{ question: string; type: string }>>();
  for (const q of questions) {
    const existing = questionsByTopic.get(q.topicId) || [];
    existing.push({ question: q.question, type: q.type });
    questionsByTopic.set(q.topicId, existing);
  }
  for (const [topicId, qs] of questionsByTopic) {
    await store.recordAskedQuestions(projectRoot, topicId, qs);
  }

  console.log(chalk.green('  ✓ Generated ' + questions.length + ' questions\n'));

  // Build block map for line range display
  const blockMap = new Map<string, BlockInfo>();
  for (const block of selectedBlocks) {
    blockMap.set(`${block.topicId}::${block.filePath}::${block.blockIndex}`, block);
  }

  const wizardQuestions = toWizardQuestions(questions, topicsFile.topics, blockMap);

  return new Promise<void>((resolve) => {
    const { unmount } = render(
      <QuizApp
        questions={questions}
        wizardQuestions={wizardQuestions}
        topicsFile={topicsFile}
        scoresFile={scoresFile}
        projectRoot={projectRoot}
        sessionType={sessionType}
        onExit={() => {
          setTimeout(() => { unmount(); resolve(); }, 200);
        }}
      />,
    );
  });
}

// ─── Block selection helpers ──────────────────────────

async function getUncoveredBlocksWithInfo(
  topics: Topic[],
  coverage: import('../types.js').CoverageFile,
  projectRoot: string,
): Promise<BlockInfo[]> {
  const blocks: BlockInfo[] = [];
  for (const topic of topics) {
    const uncovered = getUncoveredBlocks(topic.id, coverage);
    for (const { filePath, blockIndex } of uncovered) {
      const lines = await countFileLines(filePath, projectRoot);
      if (lines === null) continue; // File missing — skip
      const { startLine, endLine } = getBlockLineRange(blockIndex, lines);
      blocks.push({
        topicId: topic.id,
        topicName: topic.name,
        filePath,
        blockIndex,
        startLine,
        endLine,
        covered: false,
      });
    }
  }
  return blocks;
}

function selectRandomBlocks(blocks: BlockInfo[], count: number): BlockInfo[] {
  if (blocks.length <= count) return blocks;
  // Shuffle and take first N, distributing across topics
  const byTopic = new Map<string, BlockInfo[]>();
  for (const b of blocks) {
    const existing = byTopic.get(b.topicId) || [];
    existing.push(b);
    byTopic.set(b.topicId, existing);
  }

  const selected: BlockInfo[] = [];
  const topicIds = [...byTopic.keys()];
  let idx = 0;
  while (selected.length < count) {
    const topicId = topicIds[idx % topicIds.length];
    const topicBlocks = byTopic.get(topicId)!;
    if (topicBlocks.length > 0) {
      // Pick random block from this topic
      const randIdx = Math.floor(Math.random() * topicBlocks.length);
      selected.push(topicBlocks.splice(randIdx, 1)[0]);
    }
    idx++;
    // Safety: if all topics exhausted
    if ([...byTopic.values()].every(arr => arr.length === 0)) break;
  }
  return selected;
}

// ─── Public commands ───────────────────────────────────

export async function runQuiz(projectRoot: string): Promise<void> {
  if (!(await store.cogtExists(projectRoot))) {
    console.log(chalk.yellow('\n  cogdebt is not initialized. Run: cogdebt init\n'));
    return;
  }

  // Auto-run decay so scores are up-to-date
  const { runDecay } = await import('./decay.js');
  await runDecay(projectRoot, { quiet: true });

  const topicsFile = await store.readTopics(projectRoot);
  const scoresFile = await store.readScores(projectRoot);

  // Get leaf topics with quiz files, exclude 100% covered
  const allLeafTopics = topicsFile.topics.filter(t =>
    !t.deprecated &&
    !topicsFile.topics.some(other => other.parentId === t.id && !other.deprecated) &&
    (t.quizFiles?.length ?? 0) > 0,
  );
  const leafTopics = allLeafTopics.filter(t => (scoresFile.scores[t.id]?.score ?? 0) < 100);

  if (leafTopics.length === 0) {
    if (allLeafTopics.length > 0) {
      console.log(chalk.green('\n  🎉 All topics are at 100% coverage! Nothing to quiz on.\n'));
    } else {
      console.log(chalk.yellow('\n  No topics available. Run: cogdebt scan\n'));
    }
    return;
  }

  // Auto-select lowest-scoring topics as default
  const autoSelected = selectQuizTopics(topicsFile.topics, scoresFile.scores, undefined, 3);
  const preSelectedIds = autoSelected.map(t => t.id).filter(id => leafTopics.some(t => t.id === id));

  console.log(chalk.bold('\n  🧠 Quiz Time!'));

  // Step 1: Select topics
  const selectedIds = await selectTopicsInk(
    leafTopics,
    topicsFile.topics,
    scoresFile.scores,
    preSelectedIds,
  );

  const selectedTopics = leafTopics.filter(t => selectedIds.includes(t.id));
  if (selectedTopics.length === 0) {
    console.log(chalk.dim('\n  No topics selected. Quiz cancelled.\n'));
    return;
  }

  // Compute uncovered blocks and recommended question count
  const coverage = await store.readCoverage(projectRoot);
  const allUncoveredBlocks = await getUncoveredBlocksWithInfo(selectedTopics, coverage, projectRoot);
  const recommendation = await computeRecommendedQuestionCount(allUncoveredBlocks, projectRoot);

  // Step 2: Pick question count
  const questionCount = await pickQuestionCount(recommendation);

  // Select random blocks for the quiz
  const selectedBlocks = selectRandomBlocks(allUncoveredBlocks, questionCount);

  console.log(chalk.dim(`\n  Topics: ${selectedTopics.map(t => t.name).join(', ')}`));
  console.log(chalk.dim(`  Questions: ${questionCount}`));

  // Step 3: Generate and run quiz
  await runQuizCommon(projectRoot, selectedTopics, topicsFile, scoresFile, questionCount, 'quiz', selectedBlocks);
}

export async function runCalibrationQuiz(projectRoot: string): Promise<void> {
  console.log(chalk.bold('\n  📋 Calibration Quiz'));
  console.log(chalk.dim('  Set your initial understanding scores.\n'));

  const topicsFile = await store.readTopics(projectRoot);
  const scoresFile = await store.readScores(projectRoot);

  const leafTopics = topicsFile.topics.filter(t =>
    !t.deprecated &&
    !topicsFile.topics.some(other => other.parentId === t.id && !other.deprecated) &&
    (t.quizFiles?.length ?? 0) > 0,
  );

  if (leafTopics.length === 0) return;

  // Step 1: Select topics (nothing pre-selected — user chooses what to focus on)
  const selectedIds = await selectTopicsInk(
    leafTopics,
    topicsFile.topics,
    scoresFile.scores,
    [],
  );

  const selectedTopics = leafTopics.filter(t => selectedIds.includes(t.id));
  if (selectedTopics.length === 0) {
    console.log(chalk.dim('\n  No topics selected. Skipping calibration.\n'));
    return;
  }

  // Compute uncovered blocks and recommended question count
  const coverage = await store.readCoverage(projectRoot);
  const allUncoveredBlocks = await getUncoveredBlocksWithInfo(selectedTopics, coverage, projectRoot);
  const recommendation = await computeRecommendedQuestionCount(allUncoveredBlocks, projectRoot);

  // Step 2: Pick question count
  const questionCount = await pickQuestionCount(recommendation);

  // Select random blocks for the quiz
  const selectedBlocks = selectRandomBlocks(allUncoveredBlocks, questionCount);

  console.log(chalk.dim(`\n  Topics: ${selectedTopics.map(t => t.name).join(', ')}`));
  console.log(chalk.dim(`  Questions: ${questionCount}`));

  // Step 3: Generate and run calibration
  await runQuizCommon(projectRoot, selectedTopics, topicsFile, scoresFile, questionCount, 'calibration', selectedBlocks);
}
