import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Topic, TopicScore, QuizQuestion, QuizEvaluation, AskedQuestion, CoverageFile } from '../types.js';
import { QuizGenerationSchema, QuizEvaluationSchema } from '../types.js';
import { callClaudeJSON } from '../core/claude.js';

// ─── Block types ──────────────────────────────────────

export const BLOCK_SIZE = 200; // lines per block

export interface BlockInfo {
  topicId: string;
  topicName: string;
  filePath: string;
  blockIndex: number;
  startLine: number;
  endLine: number;
  covered: boolean;
}

// ─── Block computation ────────────────────────────────

interface QuizTopicCandidate {
  topic: Topic;
  score: TopicScore;
  priority: number;
}

export function selectQuizTopics(
  topics: Topic[],
  scores: Record<string, TopicScore>,
  focusTopic?: string,
  maxTopics = 3,
): Topic[] {
  if (focusTopic) {
    const normalized = focusTopic.toLowerCase();
    const matches = topics.filter(t =>
      !t.deprecated &&
      (t.id.toLowerCase().includes(normalized) ||
       t.name.toLowerCase().includes(normalized)),
    );
    if (matches.length > 0) return matches.slice(0, maxTopics);
  }

  const leafTopics = topics.filter(t =>
    !t.deprecated &&
    !topics.some(other => other.parentId === t.id && !other.deprecated),
  );

  const candidates: QuizTopicCandidate[] = leafTopics
    .filter(t => scores[t.id])
    .map(t => {
      const score = scores[t.id];
      const scorePenalty = 100 - score.score;
      const decayBonus = score.trend === 'down' ? 20 : 0;
      const daysSinceQuiz = score.lastQuizAt
        ? (Date.now() - new Date(score.lastQuizAt).getTime()) / (1000 * 60 * 60 * 24)
        : 30;
      const stalenessBonus = Math.min(daysSinceQuiz * 2, 60);

      return {
        topic: t,
        score,
        priority: scorePenalty + decayBonus + stalenessBonus,
      };
    })
    .sort((a, b) => b.priority - a.priority);

  return candidates.slice(0, maxTopics).map(c => c.topic);
}

// ─── Block-to-line mapping ──────────────────────────────

export function getAffectedBlockIndices(
  changedRanges: Array<{ startLine: number; lineCount: number }>,
  totalLines: number,
): number[] {
  const blockCount = computeFileBlockCount(totalLines);
  const affected = new Set<number>();

  for (const range of changedRanges) {
    const rangeStart = range.startLine;
    const rangeEnd = range.startLine + range.lineCount - 1;

    for (let b = 0; b < blockCount; b++) {
      const { startLine, endLine } = getBlockLineRange(b, totalLines);
      // Check if the changed range overlaps with this block
      if (rangeStart <= endLine && rangeEnd >= startLine) {
        affected.add(b);
      }
    }
  }

  return Array.from(affected).sort((a, b) => a - b);
}

// ─── File line counting ─────────────────────────────────

export async function countFileLines(filePath: string, cwd: string): Promise<number | null> {
  try {
    const content = await readFile(join(cwd, filePath), 'utf-8');
    return content.split('\n').length;
  } catch {
    return null;
  }
}

export function computeFileBlockCount(totalLines: number): number {
  return Math.max(1, Math.ceil(totalLines / BLOCK_SIZE));
}

export function getBlockLineRange(blockIndex: number, totalLines: number): { startLine: number; endLine: number } {
  const blockCount = computeFileBlockCount(totalLines);
  const linesPerBlock = Math.ceil(totalLines / blockCount);
  const startLine = blockIndex * linesPerBlock + 1;
  const endLine = Math.min((blockIndex + 1) * linesPerBlock, totalLines);
  return { startLine, endLine };
}

// ─── Recommended question count based on blocks ─────────

export async function computeRecommendedQuestionCount(
  uncoveredBlocks: BlockInfo[],
  cwd: string,
): Promise<{ recommended: number; max: number; totalLoc: number; blockCount: number }> {
  if (uncoveredBlocks.length === 0) {
    return { recommended: 1, max: 1, totalLoc: 0, blockCount: 0 };
  }

  // Estimate total LOC from blocks
  let totalLoc = 0;
  for (const block of uncoveredBlocks) {
    totalLoc += block.endLine - block.startLine + 1;
  }

  const blockCount = uncoveredBlocks.length;
  const max = Math.min(blockCount, 10);
  const recommended = Math.min(Math.max(Math.round(blockCount * 0.7), 1), max);

  return { recommended, max, totalLoc, blockCount };
}

// ─── Question generation ───────────────────────────────

export async function generateQuestions(
  selectedBlocks: BlockInfo[],
  scores: Record<string, TopicScore>,
  cwd: string,
  previousQuestions?: Record<string, AskedQuestion[]>,
): Promise<{ questions: QuizQuestion[]; costUsd: number }> {
  // Build block descriptions for the prompt
  const blockDescriptions = selectedBlocks.map((block, i) => {
    return `BLOCK ${i + 1}:
  Topic: "${block.topicName}" (${block.topicId})
  File: ${block.filePath}
  Focus on lines ${block.startLine}-${block.endLine} (but you can reference surrounding code for context)
  blockIndex: ${block.blockIndex}`;
  }).join('\n\n');

  // Build "previously asked" section
  let previousSection = '';
  if (previousQuestions) {
    const topicIds = [...new Set(selectedBlocks.map(b => b.topicId))];
    const prevEntries = topicIds
      .map(topicId => {
        const prev = previousQuestions[topicId];
        if (!prev || prev.length === 0) return null;
        const qList = prev.map(q => `    - [${q.type}] "${q.question}"`).join('\n');
        return `  ${topicId}:\n${qList}`;
      })
      .filter(Boolean);

    if (prevEntries.length > 0) {
      previousSection = `\n\nPREVIOUSLY ASKED QUESTIONS (DO NOT repeat these — ask about different aspects of the code):
${prevEntries.join('\n')}`;
    }
  }

  const prompt = `You are creating a quiz to test a developer's understanding of their own codebase.
You have access to read files in this project.

For each code block below, generate exactly ONE question. Read the file first, then focus your question on the specified line range (you may reference surrounding code for context).

${blockDescriptions}${previousSection}

Mix these question types across the blocks:
1. "What happens when..." — trace a flow through the code
2. "Where would you look..." — debugging instinct
3. "What breaks if..." — consequence awareness
4. "Explain the flow..." — deep understanding
5. "True or false..." — factual check about the implementation

For each question, read the relevant source file first to ensure your question is answerable and your expected answer is accurate.

Rules:
- Each question MUST be about the code within the specified line range of its block
- Questions must be about IMPLEMENTATION, not product behavior
- Questions should require knowledge of actual code, not just documentation
- Include the specific file in relevantFiles (MUST be the real file from the block)
- Include the blockIndex from the block description
- Provide a detailed expected answer
- NEVER repeat a previously asked question

RESPOND WITH ONLY A JSON OBJECT (no markdown fences, no explanation):
{
  "questions": [
    {
      "topicId": "topic.id.here",
      "type": "what_happens_when",
      "question": "Your question here?",
      "relevantFiles": ["path/to/file.ts"],
      "blockIndex": 0,
      "expectedAnswer": "Detailed expected answer...",
      "difficulty": "easy|medium|hard"
    }
  ]
}`;

  const result = await callClaudeJSON({ prompt, cwd, timeout: 300_000 }, QuizGenerationSchema);
  return { questions: result.data.questions, costUsd: result.costUsd };
}

export async function evaluateAnswers(
  questionsAndAnswers: Array<{ question: QuizQuestion; answer: string }>,
  cwd: string,
): Promise<{ evaluations: QuizEvaluation['evaluations']; costUsd: number }> {
  const qaPairs = questionsAndAnswers.map((qa, i) =>
    `QUESTION ${i + 1}: ${qa.question.question}
EXPECTED ANSWER: ${qa.question.expectedAnswer}
DEVELOPER'S ANSWER: ${qa.answer || '(no answer provided)'}`,
  ).join('\n\n');

  const prompt = `You are grading a developer's answers about their own codebase.
Be fair but strict — the goal is to measure REAL understanding, not reward vague answers.

For each question-answer pair, score 0.0 to 1.0:
- 1.0: Complete, accurate, shows deep understanding
- 0.7-0.9: Mostly correct, minor gaps
- 0.4-0.6: Partially correct, significant gaps
- 0.1-0.3: Vaguely related but mostly wrong
- 0.0: Completely wrong or "I don't know"

${qaPairs}

RESPOND WITH ONLY A JSON OBJECT (no markdown fences, no explanation):
{
  "evaluations": [
    {
      "questionIndex": 0,
      "score": 0.7,
      "feedback": "Brief feedback explaining the score"
    }
  ]
}`;

  const result = await callClaudeJSON({ prompt, cwd, timeout: 120_000 }, QuizEvaluationSchema);
  return { evaluations: result.data.evaluations, costUsd: result.costUsd };
}
