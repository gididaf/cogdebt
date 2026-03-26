import { spawn, execFile } from 'node:child_process';
import { writeFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { ClaudeCliError } from '../types.js';

export async function isClaudeInstalled(): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('which', ['claude'], (error) => {
      resolve(!error);
    });
  });
}

interface ClaudeOptions {
  prompt: string;
  cwd?: string;
  timeout?: number;
}

interface ClaudeResult {
  text: string;
  costUsd: number;
  durationMs: number;
}

function extractJSON(text: string): string {
  // 1. Try stripping markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();

  // 2. Find the first { and match to the last } — extract embedded JSON object
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return text.slice(firstBrace, lastBrace + 1);
  }

  return text.trim();
}

export async function callClaude(options: ClaudeOptions): Promise<ClaudeResult> {
  const { prompt, cwd, timeout = 300_000 } = options;
  const startTime = Date.now();

  // Write prompt to temp file, then use sh -c to expand it
  // This avoids argument length limits and special character issues
  const tmpFile = join(tmpdir(), `cogdebt-prompt-${randomBytes(8).toString('hex')}.txt`);
  await writeFile(tmpFile, prompt, 'utf-8');

  try {
    return await new Promise<ClaudeResult>((resolve, reject) => {
      // Use sh -c with a single command string for reliable shell expansion
      const shellCmd = `cat "${tmpFile}" | claude -p - --output-format json --dangerously-skip-permissions`;

      const proc = spawn('sh', ['-c', shellCmd], {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      const timer = setTimeout(() => {
        proc.kill('SIGTERM');
        reject(new ClaudeCliError('Claude Code CLI timed out after ' + (timeout / 1000) + 's', stderr));
      }, timeout);

      proc.on('error', (error: any) => {
        clearTimeout(timer);
        if (error.code === 'ENOENT') {
          reject(new ClaudeCliError(
            'Claude Code CLI not found. Install it from https://claude.ai/code',
            stderr,
          ));
          return;
        }
        reject(new ClaudeCliError(
          `Claude Code CLI failed: ${error.message}`,
          stderr,
        ));
      });

      proc.on('close', (code: number | null) => {
        clearTimeout(timer);
        const durationMs = Date.now() - startTime;

        if (code !== 0) {
          reject(new ClaudeCliError(
            `Claude Code CLI exited with code ${code}`,
            stderr.slice(0, 500),
          ));
          return;
        }

        try {
          const jsonResponse = JSON.parse(stdout);
          const resultText = jsonResponse.result || jsonResponse.text || stdout;
          const costUsd = jsonResponse.cost_usd || jsonResponse.total_cost_usd || 0;

          resolve({
            text: typeof resultText === 'string' ? resultText : JSON.stringify(resultText),
            costUsd: typeof costUsd === 'number' ? costUsd : 0,
            durationMs,
          });
        } catch {
          resolve({
            text: stdout,
            costUsd: 0,
            durationMs,
          });
        }
      });
    });
  } finally {
    try { await unlink(tmpFile); } catch {}
  }
}

export async function callClaudeJSON<T>(
  options: ClaudeOptions,
  schema: z.ZodType<T>,
): Promise<{ data: T; costUsd: number; durationMs: number }> {
  const result = await callClaude(options);

  let parsed: unknown;
  try {
    parsed = JSON.parse(result.text);
  } catch {
    const extracted = extractJSON(result.text);
    try {
      parsed = JSON.parse(extracted);
    } catch {
      throw new ClaudeCliError(
        `Failed to parse Claude response as JSON.\nRaw response:\n${result.text.slice(0, 500)}`,
      );
    }
  }

  const validated = schema.safeParse(parsed);
  if (!validated.success) {
    throw new ClaudeCliError(
      `Claude response didn't match expected schema: ${validated.error.message}\nParsed: ${JSON.stringify(parsed).slice(0, 500)}`,
    );
  }

  return {
    data: validated.data,
    costUsd: result.costUsd,
    durationMs: result.durationMs,
  };
}
