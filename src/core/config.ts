import { readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';

export async function addToGitignore(projectRoot: string): Promise<boolean> {
  const gitignorePath = join(projectRoot, '.gitignore');
  let content = '';

  try {
    content = await readFile(gitignorePath, 'utf-8');
  } catch {
    // No .gitignore exists
  }

  if (content.includes('.cogt')) {
    return false; // Already there
  }

  const newContent = content.trimEnd() + '\n\n# Cognitive Debt Tracker (personal scores)\n.cogt/\n';
  await writeFile(gitignorePath, newContent, 'utf-8');
  return true;
}

export async function hasGitignoreEntry(projectRoot: string): Promise<boolean> {
  try {
    const content = await readFile(join(projectRoot, '.gitignore'), 'utf-8');
    return content.includes('.cogt');
  } catch {
    return false;
  }
}

export function findProjectRoot(): string {
  return process.cwd();
}
