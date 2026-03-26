import chalk from 'chalk';
import { ScanResponseSchema, QuizFilesResponseSchema, type Topic } from '../types.js';
import { callClaudeJSON } from '../core/claude.js';
import * as git from '../core/git.js';
import * as store from '../core/store.js';
import { mergeTopics } from '../engine/topics.js';
import { readFile, access } from 'node:fs/promises';
import { join } from 'node:path';

async function readFileSafe(path: string, maxChars = 3000): Promise<string> {
  try {
    const content = await readFile(path, 'utf-8');
    return content.slice(0, maxChars);
  } catch {
    return '';
  }
}

export async function runScan(projectRoot: string): Promise<Topic[]> {
  console.log(chalk.bold('\n  Scanning codebase for topics...\n'));

  await store.ensureCogtDir(projectRoot);

  const tree = await git.getDirectoryTree(projectRoot);
  const claudeMd = await readFileSafe(join(projectRoot, 'CLAUDE.md'));
  const readmeMd = await readFileSafe(join(projectRoot, 'README.md'));

  // ─── Pass 1: Discover topics ───────────────────────────

  const prompt = `You are analyzing a codebase to identify the main topics/domains a developer should understand.

PROJECT DIRECTORY TREE:
${tree}

${claudeMd ? `CLAUDE.md (project documentation):\n${claudeMd}\n` : ''}
${readmeMd ? `README.md:\n${readmeMd}\n` : ''}

Analyze this codebase and produce a hierarchical topic tree. Each topic represents a distinct area of knowledge a developer needs to understand.

Rules:
- Max 3 levels of hierarchy (e.g., "Backend" > "Billing" > "Stripe Integration")
- Each leaf topic should map to specific directories/file patterns using glob syntax
- Include 8-25 topics total. Prefer fewer meaningful topics over many tiny ones
- Focus on BUSINESS LOGIC areas, not generic infrastructure (no "utils", "helpers", "config")
- If you see a monorepo with frontend/backend, create top-level topics for each
- If you see a modular architecture (modules/ directory), each module is likely a topic
- The id field should be lowercase dot-separated path (e.g., "backend.billing.rivhit")

RESPOND WITH ONLY A JSON OBJECT (no markdown fences, no explanation):
{
  "topics": [
    {
      "id": "backend.billing",
      "name": "Billing",
      "parentId": "backend",
      "filePaths": ["backend/src/modules/billing/**"],
      "description": "One sentence about what this area does"
    }
  ]
}`;

  process.stdout.write(chalk.dim('  Discovering topics...'));
  const result = await callClaudeJSON({ prompt, cwd: projectRoot, timeout: 300_000 }, ScanResponseSchema);
  console.log(chalk.green(' ✓'));

  const newTopics = result.data.topics.map(t => ({ ...t, deprecated: false, quizFiles: [] as string[] }));

  // Merge with existing topics
  const existingTopics = await store.readTopics(projectRoot);
  const merged = existingTopics.topics.length > 0
    ? mergeTopics(existingTopics, newTopics)
    : { version: 1 as const, topics: newTopics };

  // ─── Pass 2: Identify quiz-worthy files per leaf topic ──

  const leafTopics = merged.topics.filter(t =>
    !t.deprecated &&
    !merged.topics.some(other => other.parentId === t.id && !other.deprecated),
  );

  if (leafTopics.length > 0) {
    // Process in batches of 5 topics to avoid overwhelming Claude
    const batchSize = 5;
    const batches: Topic[][] = [];
    for (let i = 0; i < leafTopics.length; i += batchSize) {
      batches.push(leafTopics.slice(i, i + batchSize));
    }

    process.stdout.write(chalk.dim(`  Identifying quiz-worthy files (${batches.length} batch${batches.length > 1 ? 'es' : ''})...`));
    let totalFiles = 0;

    for (const batch of batches) {
      const topicsList = batch.map(t =>
        `- ${t.id}: ${t.name}\n  Paths: ${t.filePaths.join(', ')}`,
      ).join('\n');

      const quizFilesPrompt = `For each topic below, list the source files that contain important business logic.

TOPICS:
${topicsList}

For each topic, look at the files in the listed directories.

INCLUDE: Route handlers, models with logic, service layers, middleware, utilities with non-trivial logic.
EXCLUDE: Barrel exports (index.ts with only re-exports), type-only files, constants, tests.

List actual file paths relative to project root.

RESPOND WITH ONLY A JSON OBJECT (no markdown fences, no explanation):
{
  "topics": [
    {
      "topicId": "the.topic.id",
      "quizFiles": ["path/to/file.ts"]
    }
  ]
}`;

      try {
        const quizResult = await callClaudeJSON({ prompt: quizFilesPrompt, cwd: projectRoot, timeout: 300_000 }, QuizFilesResponseSchema);
        for (const entry of quizResult.data.topics) {
          const topic = merged.topics.find(t => t.id === entry.topicId);
          if (topic) {
            // Filter out files that don't exist on disk
            const validFiles: string[] = [];
            for (const f of entry.quizFiles) {
              try {
                await access(join(projectRoot, f));
                validFiles.push(f);
              } catch {
                // File doesn't exist — skip
              }
            }
            topic.quizFiles = validFiles;
            totalFiles += validFiles.length;
          }
        }
      } catch (err) {
        // Continue with other batches even if one fails
      }
    }

    if (totalFiles > 0) {
      console.log(chalk.green(` ✓ (${totalFiles} files)`));
    } else {
      console.log(chalk.yellow(' (skipped — will use all files)'));
    }
  }

  await store.writeTopics(projectRoot, merged);

  // Initialize coverage for quiz files
  await store.initializeCoverage(projectRoot, merged);

  // Update config
  try {
    const config = await store.readConfig(projectRoot);
    config.lastScanAt = new Date().toISOString();
    await store.writeConfig(projectRoot, config);
  } catch {}

  await store.appendHistory(projectRoot, {
    type: 'scan',
    timestamp: new Date().toISOString(),
    details: `Scan complete: ${newTopics.length} topics discovered`,
  });

  // Display
  const activeTopics = merged.topics.filter(t => !t.deprecated);
  const totalQuizFiles = activeTopics.reduce((sum, t) => sum + (t.quizFiles?.length || 0), 0);
  console.log(chalk.green(`\n  ✓ Discovered ${activeTopics.length} topics, ${totalQuizFiles} quiz-worthy files\n`));

  const topLevel = activeTopics.filter(t => !t.parentId);
  for (const parent of topLevel) {
    const children = activeTopics.filter(t => t.parentId === parent.id);
    if (children.length === 0) {
      // Top-level leaf topic
      const fileCount = parent.quizFiles?.length || 0;
      if (fileCount > 0) {
        console.log(chalk.bold(`  ${parent.name}`) + chalk.dim(` (${fileCount} files)`));
      } else {
        console.log(chalk.bold(`  ${parent.name}`) + chalk.yellow(` (no quiz-worthy files)`));
      }
    } else {
      console.log(chalk.bold(`  ${parent.name}`));
      for (const child of children) {
        const grandchildren = activeTopics.filter(t => t.parentId === child.id);
        const fileCount = child.quizFiles?.length || 0;
        if (grandchildren.length > 0) {
          console.log(`    ├─ ${child.name}`);
          for (const gc of grandchildren) {
            const gcFiles = gc.quizFiles?.length || 0;
            console.log(`    │  └─ ${gc.name} ${chalk.dim(`(${gcFiles} files)`)}`);
          }
        } else {
          console.log(`    ├─ ${child.name} ${chalk.dim(`(${fileCount} files)`)}`);
        }
      }
    }
  }


  return activeTopics;
}
