import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ConfigSchema, TopicsFileSchema, ScoresFileSchema, HistoryFileSchema, DecayCursorSchema,
  QuizHistoryFileSchema, CoverageFileSchema,
  type Config, type TopicsFile, type ScoresFile, type HistoryFile, type DecayCursor,
  type HistoryEvent, type QuizHistoryFile, type AskedQuestion, type CoverageFile,
  CogtError,
} from '../types.js';

const COGDEBT_DIR = '.cogt';

export function getCogtDir(projectRoot: string): string {
  return join(projectRoot, COGDEBT_DIR);
}

export async function cogtExists(projectRoot: string): Promise<boolean> {
  try {
    await access(getCogtDir(projectRoot));
    return true;
  } catch {
    return false;
  }
}

export async function ensureCogtDir(projectRoot: string): Promise<void> {
  await mkdir(getCogtDir(projectRoot), { recursive: true });
}

async function readJSON<T>(filePath: string, schema: import('zod').ZodType<T>, fallback: T): Promise<T> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed = JSON.parse(content);
    return schema.parse(parsed);
  } catch (err: any) {
    if (err.code === 'ENOENT' || err.code === 'ENOTDIR') return fallback;
    if (err.name === 'ZodError') {
      throw new CogtError(`Data file corrupted: ${filePath}\nRun 'cogdebt scan' to repair.`, 'DATA_CORRUPT');
    }
    throw err;
  }
}

async function writeJSON(filePath: string, data: unknown): Promise<void> {
  // Ensure parent directory exists
  const dir = filePath.substring(0, filePath.lastIndexOf('/'));
  await mkdir(dir, { recursive: true });
  await writeFile(filePath, JSON.stringify(data, null, 2) + '\n', 'utf-8');
}

// ─── Config ────────────────────────────────────────────

export async function readConfig(projectRoot: string): Promise<Config> {
  return readJSON(
    join(getCogtDir(projectRoot), 'config.json'),
    ConfigSchema,
    null as never,
  );
}

export async function writeConfig(projectRoot: string, config: Config): Promise<void> {
  await writeJSON(join(getCogtDir(projectRoot), 'config.json'), config);
}

// ─── Topics ────────────────────────────────────────────

export async function readTopics(projectRoot: string): Promise<TopicsFile> {
  return readJSON(
    join(getCogtDir(projectRoot), 'topics.json'),
    TopicsFileSchema,
    { version: 1, topics: [] },
  );
}

export async function writeTopics(projectRoot: string, topics: TopicsFile): Promise<void> {
  await writeJSON(join(getCogtDir(projectRoot), 'topics.json'), topics);
}

// ─── Scores ────────────────────────────────────────────

export async function readScores(projectRoot: string): Promise<ScoresFile> {
  return readJSON(
    join(getCogtDir(projectRoot), 'scores.json'),
    ScoresFileSchema,
    { version: 1, scores: {} },
  );
}

export async function writeScores(projectRoot: string, scores: ScoresFile): Promise<void> {
  await writeJSON(join(getCogtDir(projectRoot), 'scores.json'), scores);
}

// ─── History ───────────────────────────────────────────

export async function readHistory(projectRoot: string): Promise<HistoryFile> {
  return readJSON(
    join(getCogtDir(projectRoot), 'history.json'),
    HistoryFileSchema,
    { version: 1, events: [] },
  );
}

export async function writeHistory(projectRoot: string, history: HistoryFile): Promise<void> {
  await writeJSON(join(getCogtDir(projectRoot), 'history.json'), history);
}

export async function appendHistory(projectRoot: string, event: HistoryEvent): Promise<void> {
  const history = await readHistory(projectRoot);
  history.events.push(event);
  // Keep last 500 events max
  if (history.events.length > 500) {
    history.events = history.events.slice(-500);
  }
  await writeHistory(projectRoot, history);
}

// ─── Decay Cursor ──────────────────────────────────────

export async function readDecayCursor(projectRoot: string): Promise<DecayCursor | null> {
  try {
    return await readJSON(
      join(getCogtDir(projectRoot), 'decay-cursor.json'),
      DecayCursorSchema,
      null as never,
    );
  } catch {
    return null;
  }
}

export async function writeDecayCursor(projectRoot: string, cursor: DecayCursor): Promise<void> {
  await writeJSON(join(getCogtDir(projectRoot), 'decay-cursor.json'), cursor);
}

// ─── Quiz History ──────────────────────────────────────

export async function readQuizHistory(projectRoot: string): Promise<QuizHistoryFile> {
  return readJSON(
    join(getCogtDir(projectRoot), 'quiz-history.json'),
    QuizHistoryFileSchema,
    { version: 1, topics: {} },
  );
}

export async function writeQuizHistory(projectRoot: string, history: QuizHistoryFile): Promise<void> {
  await writeJSON(join(getCogtDir(projectRoot), 'quiz-history.json'), history);
}

export async function recordAskedQuestions(
  projectRoot: string,
  topicId: string,
  questions: Array<{ question: string; type: string }>,
): Promise<void> {
  const history = await readQuizHistory(projectRoot);
  if (!history.topics[topicId]) {
    history.topics[topicId] = [];
  }
  const now = new Date().toISOString();
  for (const q of questions) {
    history.topics[topicId].push({
      question: q.question,
      type: q.type,
      askedAt: now,
    });
  }
  // Keep max 20 questions per topic
  if (history.topics[topicId].length > 20) {
    history.topics[topicId] = history.topics[topicId].slice(-20);
  }
  await writeQuizHistory(projectRoot, history);
}

export async function clearTopicQuizHistory(projectRoot: string, topicIds: string[]): Promise<void> {
  const history = await readQuizHistory(projectRoot);
  for (const id of topicIds) {
    delete history.topics[id];
  }
  await writeQuizHistory(projectRoot, history);
}

// ─── Coverage ──────────────────────────────────────────

import { computeFileBlockCount, countFileLines } from '../engine/quiz-engine.js';

// Coverage keys encode topic+file+block: "topicId::filePath::blockIndex"
export function coverageKey(topicId: string, filePath: string, blockIndex: number = 0): string {
  return `${topicId}::${filePath}::${blockIndex}`;
}

export function parseCoverageKey(key: string): { topicId: string; filePath: string; blockIndex: number } {
  const parts = key.split('::');
  return {
    topicId: parts[0],
    filePath: parts[1],
    blockIndex: parts.length > 2 ? parseInt(parts[2], 10) : 0,
  };
}

export async function readCoverage(projectRoot: string): Promise<CoverageFile> {
  const raw = await readJSON(
    join(getCogtDir(projectRoot), 'coverage.json'),
    CoverageFileSchema,
    { version: 3, files: {} },
  );

  const keys = Object.keys(raw.files);
  if (keys.length === 0) return raw;

  // Detect format by counting '::' separators in first key
  const separatorCount = (keys[0].match(/::/g) || []).length;

  // Migrate v1 → v3: plain file paths with topicId inside entry
  if (separatorCount === 0) {
    const migrated: CoverageFile = { version: 3, files: {} };
    for (const [filePath, entry] of Object.entries(raw.files)) {
      const topicId = entry.topicId || 'unknown';
      const lines = await countFileLines(filePath, projectRoot);
      if (lines === null) continue; // File missing — skip
      const blockCount = computeFileBlockCount(lines);
      for (let b = 0; b < blockCount; b++) {
        migrated.files[coverageKey(topicId, filePath, b)] = {
          covered: entry.covered,
          coveredAt: entry.coveredAt,
          score: entry.score,
        };
      }
    }
    await writeCoverage(projectRoot, migrated);
    return migrated;
  }

  // Migrate v2 → v3: "topicId::filePath" → expand to blocks
  if (separatorCount === 1) {
    const migrated: CoverageFile = { version: 3, files: {} };
    for (const [key, entry] of Object.entries(raw.files)) {
      const idx = key.indexOf('::');
      const topicId = key.slice(0, idx);
      const filePath = key.slice(idx + 2);
      const lines = await countFileLines(filePath, projectRoot);
      if (lines === null) continue; // File missing — skip
      const blockCount = computeFileBlockCount(lines);
      for (let b = 0; b < blockCount; b++) {
        migrated.files[coverageKey(topicId, filePath, b)] = {
          covered: entry.covered,
          coveredAt: entry.coveredAt,
          score: entry.score,
        };
      }
    }
    await writeCoverage(projectRoot, migrated);
    return migrated;
  }

  // Already v3 format
  return raw;
}

export async function writeCoverage(projectRoot: string, coverage: CoverageFile): Promise<void> {
  await writeJSON(join(getCogtDir(projectRoot), 'coverage.json'), coverage);
}

export async function markBlockCovered(
  projectRoot: string,
  topicId: string,
  filePath: string,
  blockIndex: number,
  score: number,
): Promise<void> {
  const coverage = await readCoverage(projectRoot);
  const now = new Date().toISOString();
  const key = coverageKey(topicId, filePath, blockIndex);
  if (score >= 0.5) {
    coverage.files[key] = {
      covered: true,
      coveredAt: now,
      score,
    };
  } else if (!coverage.files[key]?.covered) {
    coverage.files[key] = {
      covered: false,
      coveredAt: null,
      score,
    };
  }
  await writeCoverage(projectRoot, coverage);
}

// Keep for backward compat during transition
export async function markFilesCovered(
  projectRoot: string,
  files: string[],
  topicId: string,
  score: number,
): Promise<void> {
  const coverage = await readCoverage(projectRoot);
  const now = new Date().toISOString();
  for (const file of files) {
    const key = coverageKey(topicId, file, 0);
    if (score >= 0.5) {
      coverage.files[key] = { covered: true, coveredAt: now, score };
    } else if (!coverage.files[key]?.covered) {
      coverage.files[key] = { covered: false, coveredAt: null, score };
    }
  }
  await writeCoverage(projectRoot, coverage);
}

export async function markFileBlocksUncovered(
  projectRoot: string,
  entries: Array<{ topicId: string; filePath: string }>,
): Promise<void> {
  const coverage = await readCoverage(projectRoot);
  for (const { topicId, filePath } of entries) {
    // Find all block keys for this topic+file
    const prefix = `${topicId}::${filePath}::`;
    for (const key of Object.keys(coverage.files)) {
      if (key.startsWith(prefix)) {
        coverage.files[key].covered = false;
        coverage.files[key].coveredAt = null;
        coverage.files[key].score = 0;
      }
    }
  }
  await writeCoverage(projectRoot, coverage);
}

export async function markSpecificBlocksUncovered(
  projectRoot: string,
  entries: Array<{ topicId: string; filePath: string; blockIndices: number[] }>,
): Promise<void> {
  const coverage = await readCoverage(projectRoot);
  for (const { topicId, filePath, blockIndices } of entries) {
    for (const blockIndex of blockIndices) {
      const key = coverageKey(topicId, filePath, blockIndex);
      if (coverage.files[key]) {
        coverage.files[key].covered = false;
        coverage.files[key].coveredAt = null;
        coverage.files[key].score = 0;
      }
    }
  }
  await writeCoverage(projectRoot, coverage);
}

export async function syncFileBlocks(
  projectRoot: string,
  topicId: string,
  filePath: string,
  newBlockCount: number,
): Promise<void> {
  const coverage = await readCoverage(projectRoot);
  const prefix = `${topicId}::${filePath}::`;

  // Find existing block indices for this topic+file
  const existingIndices = new Set<number>();
  for (const key of Object.keys(coverage.files)) {
    if (key.startsWith(prefix)) {
      const parsed = parseCoverageKey(key);
      existingIndices.add(parsed.blockIndex);
    }
  }

  const oldBlockCount = existingIndices.size;
  if (oldBlockCount === newBlockCount) return;

  // Add new blocks if file grew
  for (let b = 0; b < newBlockCount; b++) {
    const key = coverageKey(topicId, filePath, b);
    if (!coverage.files[key]) {
      coverage.files[key] = { covered: false, coveredAt: null, score: 0 };
    }
  }

  // Remove orphaned blocks if file shrank
  for (const idx of existingIndices) {
    if (idx >= newBlockCount) {
      delete coverage.files[coverageKey(topicId, filePath, idx)];
    }
  }

  await writeCoverage(projectRoot, coverage);
}

export async function initializeCoverage(projectRoot: string, topics: TopicsFile): Promise<void> {
  const coverage: CoverageFile = { version: 3, files: {} };
  for (const topic of topics.topics) {
    if (topic.deprecated || !topic.quizFiles) continue;
    for (const file of topic.quizFiles) {
      const lines = await countFileLines(file, projectRoot);
      if (lines === null) continue; // File missing — skip
      const blockCount = computeFileBlockCount(lines);
      for (let b = 0; b < blockCount; b++) {
        coverage.files[coverageKey(topic.id, file, b)] = {
          covered: false,
          coveredAt: null,
          score: 0,
        };
      }
    }
  }
  await writeCoverage(projectRoot, coverage);
}
