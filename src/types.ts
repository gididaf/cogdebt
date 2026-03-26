import { z } from 'zod';

// ─── Config ────────────────────────────────────────────

export const ConfigSchema = z.object({
  version: z.number().default(1),
  projectName: z.string(),
  createdAt: z.string(),
  lastScanAt: z.string().nullable().default(null),
  lastDecayAt: z.string().nullable().default(null),
  lastQuizAt: z.string().nullable().default(null),
  settings: z.object({
    decayRate: z.number().default(1.0),
    quizQuestionCount: z.number().default(5),
    urgentThresholdDays: z.number().default(7),
  }).default({}),
});

export type Config = z.infer<typeof ConfigSchema>;

// ─── Topics ────────────────────────────────────────────

export const TopicSchema = z.object({
  id: z.string(),
  name: z.string(),
  parentId: z.string().nullable(),
  filePaths: z.array(z.string()),
  description: z.string(),
  deprecated: z.boolean().optional().default(false),
  quizFiles: z.array(z.string()).optional().default([]),
});

export type Topic = z.infer<typeof TopicSchema>;

export const TopicsFileSchema = z.object({
  version: z.number().default(1),
  topics: z.array(TopicSchema),
});

export type TopicsFile = z.infer<typeof TopicsFileSchema>;

// ─── Scores ────────────────────────────────────────────

export const TopicScoreSchema = z.object({
  score: z.number().min(0).max(100),
  trend: z.enum(['up', 'down', 'stable']).default('stable'),
  lastQuizAt: z.string().nullable().default(null),
  lastDecayAt: z.string().nullable().default(null),
});

export type TopicScore = z.infer<typeof TopicScoreSchema>;

export const ScoresFileSchema = z.object({
  version: z.number().default(1),
  scores: z.record(z.string(), TopicScoreSchema),
});

export type ScoresFile = z.infer<typeof ScoresFileSchema>;

// ─── History ───────────────────────────────────────────

export const HistoryEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('scan'),
    timestamp: z.string(),
    details: z.string(),
  }),
  z.object({
    type: z.literal('decay'),
    timestamp: z.string(),
    topicId: z.string(),
    scoreBefore: z.number(),
    scoreAfter: z.number(),
    reason: z.string(),
    commitRange: z.string().optional(),
  }),
  z.object({
    type: z.literal('quiz'),
    timestamp: z.string(),
    topicId: z.string(),
    scoreBefore: z.number(),
    scoreAfter: z.number(),
    questionsAsked: z.number(),
    correctAnswers: z.number(),
  }),
  z.object({
    type: z.literal('calibration'),
    timestamp: z.string(),
    topicId: z.string(),
    scoreBefore: z.number(),
    scoreAfter: z.number(),
    questionsAsked: z.number(),
    correctAnswers: z.number(),
  }),
]);

export type HistoryEvent = z.infer<typeof HistoryEventSchema>;

export const HistoryFileSchema = z.object({
  version: z.number().default(1),
  events: z.array(HistoryEventSchema),
});

export type HistoryFile = z.infer<typeof HistoryFileSchema>;

// ─── Coverage (per-file understanding tracking) ────────

export const CoverageEntrySchema = z.object({
  topicId: z.string().optional(), // Legacy v1 field, no longer used in v2+ (topic is encoded in the key)
  covered: z.boolean(),
  coveredAt: z.string().nullable(),
  score: z.number(),
});

export type CoverageEntry = z.infer<typeof CoverageEntrySchema>;

export const CoverageFileSchema = z.object({
  version: z.number().default(3),
  files: z.record(z.string(), CoverageEntrySchema),
});

export type CoverageFile = z.infer<typeof CoverageFileSchema>;

// ─── Quiz History (prevents repeat questions) ──────────

export const AskedQuestionSchema = z.object({
  question: z.string(),
  type: z.string(),
  askedAt: z.string(),
});

export type AskedQuestion = z.infer<typeof AskedQuestionSchema>;

export const QuizHistoryFileSchema = z.object({
  version: z.number().default(1),
  topics: z.record(z.string(), z.array(AskedQuestionSchema)),
});

export type QuizHistoryFile = z.infer<typeof QuizHistoryFileSchema>;

// ─── Decay Cursor ──────────────────────────────────────

export const DecayCursorSchema = z.object({
  lastCommitHash: z.string(),
  lastRunAt: z.string(),
});

export type DecayCursor = z.infer<typeof DecayCursorSchema>;

// ─── Claude Response Schemas ───────────────────────────

export const ScanResponseSchema = z.object({
  topics: z.array(z.object({
    id: z.string(),
    name: z.string(),
    parentId: z.string().nullable(),
    filePaths: z.array(z.string()),
    description: z.string(),
  })),
});

export type ScanResponse = z.infer<typeof ScanResponseSchema>;

export const QuizFilesResponseSchema = z.object({
  topics: z.array(z.object({
    topicId: z.string(),
    quizFiles: z.array(z.string()),
  })),
});

export type QuizFilesResponse = z.infer<typeof QuizFilesResponseSchema>;

export const DecayAssessmentSchema = z.object({
  assessments: z.array(z.object({
    topicId: z.string(),
    impact: z.number().min(0).max(1),
    reason: z.string(),
  })),
});

export type DecayAssessment = z.infer<typeof DecayAssessmentSchema>;

export const QuizQuestionSchema = z.object({
  topicId: z.string(),
  type: z.string(),
  question: z.string(),
  relevantFiles: z.array(z.string()),
  blockIndex: z.number().optional(),
  expectedAnswer: z.string(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
});

export type QuizQuestion = z.infer<typeof QuizQuestionSchema>;

export const QuizGenerationSchema = z.object({
  questions: z.array(QuizQuestionSchema),
});

export type QuizGeneration = z.infer<typeof QuizGenerationSchema>;

export const QuizEvaluationItemSchema = z.object({
  questionIndex: z.number(),
  score: z.number().min(0).max(1),
  feedback: z.string(),
});

export const QuizEvaluationSchema = z.object({
  evaluations: z.array(QuizEvaluationItemSchema),
});

export type QuizEvaluation = z.infer<typeof QuizEvaluationSchema>;

// ─── Errors ────────────────────────────────────────────

export class CogtError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = 'CogtError';
  }
}

export class ClaudeCliError extends CogtError {
  constructor(message: string, public stderr?: string) {
    super(message, 'CLAUDE_CLI_ERROR');
  }
}
