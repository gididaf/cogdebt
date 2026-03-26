import { execFile } from 'node:child_process';
import { CogtError } from '../types.js';

function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(new CogtError(`Git error: ${stderr || error.message}`, 'GIT_ERROR'));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

export async function getHead(cwd: string): Promise<string> {
  return runGit(['rev-parse', 'HEAD'], cwd);
}

export async function getProjectName(cwd: string): Promise<string> {
  try {
    const remote = await runGit(['remote', 'get-url', 'origin'], cwd);
    const match = remote.match(/\/([^/]+?)(?:\.git)?$/);
    if (match) return match[1];
  } catch {
    // No remote, use directory name
  }
  const parts = cwd.split('/');
  return parts[parts.length - 1] || 'unknown';
}

export async function diffStat(fromHash: string, toHash: string, cwd: string): Promise<string[]> {
  const output = await runGit(['diff', '--name-only', fromHash, toHash], cwd);
  if (!output) return [];
  return output.split('\n').filter(Boolean);
}

export async function diff(fromHash: string, toHash: string, cwd: string, maxLines = 5000): Promise<string> {
  const output = await runGit(['diff', fromHash, toHash], cwd);
  const lines = output.split('\n');
  if (lines.length > maxLines) {
    return lines.slice(0, maxLines).join('\n') + `\n\n... (truncated, ${lines.length - maxLines} more lines)`;
  }
  return output;
}

export async function diffHunks(
  fromHash: string,
  toHash: string,
  cwd: string,
): Promise<Map<string, Array<{ startLine: number; lineCount: number }>>> {
  const output = await runGit(['diff', '-U0', fromHash, toHash], cwd);
  const result = new Map<string, Array<{ startLine: number; lineCount: number }>>();

  let currentFile: string | null = null;

  for (const line of output.split('\n')) {
    // Track current file from diff headers: "diff --git a/path b/path" or "+++ b/path"
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6);
      if (!result.has(currentFile)) {
        result.set(currentFile, []);
      }
      continue;
    }

    // Parse hunk headers: @@ -oldStart,oldCount +newStart,newCount @@
    if (line.startsWith('@@') && currentFile) {
      const match = line.match(/@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (match) {
        const startLine = parseInt(match[1], 10);
        const lineCount = match[2] !== undefined ? parseInt(match[2], 10) : 1;
        // For deletions (lineCount=0), treat as a point change at startLine
        // so the containing block is still marked as affected
        result.get(currentFile)!.push({ startLine, lineCount: Math.max(lineCount, 1) });
      }
    }
  }

  return result;
}

export async function getCommitSubject(hash: string, cwd: string): Promise<string> {
  try {
    return await runGit(['log', '-1', '--format=%s', hash], cwd);
  } catch {
    return '';
  }
}

export async function logMessages(fromHash: string, toHash: string, cwd: string): Promise<string> {
  return runGit(['log', '--oneline', `${fromHash}..${toHash}`], cwd);
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    await runGit(['rev-parse', '--git-dir'], cwd);
    return true;
  } catch {
    return false;
  }
}

export async function getDirectoryTree(cwd: string, maxDepth = 3): Promise<string> {
  // Use git ls-tree to get tracked files, then build a tree
  try {
    const output = await runGit(['ls-tree', '-r', '--name-only', 'HEAD'], cwd);
    const files = output.split('\n').filter(Boolean);

    // Build a simplified directory tree (top N levels)
    const dirs = new Set<string>();
    for (const file of files) {
      const parts = file.split('/');
      for (let i = 1; i <= Math.min(parts.length, maxDepth); i++) {
        dirs.add(parts.slice(0, i).join('/'));
      }
    }

    const sorted = Array.from(dirs).sort();
    // Limit output size
    if (sorted.length > 200) {
      return sorted.slice(0, 200).join('\n') + `\n... (${sorted.length - 200} more entries)`;
    }
    return sorted.join('\n');
  } catch {
    return '(unable to read directory tree)';
  }
}

export async function getRecentCommitCount(cwd: string, days = 30): Promise<number> {
  try {
    const output = await runGit(['rev-list', '--count', `--since=${days} days ago`, 'HEAD'], cwd);
    return parseInt(output, 10) || 0;
  } catch {
    return 0;
  }
}
