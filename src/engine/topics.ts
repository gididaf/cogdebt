import { minimatch } from 'minimatch';
import type { Topic, TopicsFile } from '../types.js';

export function matchFileToTopics(filePath: string, topics: Topic[]): Topic[] {
  return topics.filter(topic =>
    !topic.deprecated && topic.filePaths.some(pattern => minimatch(filePath, pattern)),
  );
}

export function mapFilesToTopics(changedFiles: string[], topics: Topic[]): Map<string, string[]> {
  const topicFileMap = new Map<string, string[]>();

  for (const file of changedFiles) {
    for (const topic of topics) {
      if (topic.deprecated) continue;
      if (topic.filePaths.some(pattern => minimatch(file, pattern))) {
        const existing = topicFileMap.get(topic.id) || [];
        existing.push(file);
        topicFileMap.set(topic.id, existing);
      }
    }
  }

  return topicFileMap;
}

export function isLeafTopic(topic: Topic, allTopics: Topic[]): boolean {
  return !allTopics.some(t => t.parentId === topic.id && !t.deprecated);
}

export function getLeafTopicIds(topics: Topic[]): string[] {
  return topics
    .filter(t => !t.deprecated && isLeafTopic(t, topics))
    .map(t => t.id);
}

export function mergeTopics(existing: TopicsFile, newTopics: Topic[]): TopicsFile {
  const existingMap = new Map(existing.topics.map(t => [t.id, t]));
  const newMap = new Map(newTopics.map(t => [t.id, t]));
  const merged: Topic[] = [];

  // Update existing topics that are in the new scan
  for (const newTopic of newTopics) {
    const existing = existingMap.get(newTopic.id);
    if (existing) {
      merged.push({
        ...newTopic,
        deprecated: false,
      });
    } else {
      merged.push({
        ...newTopic,
        deprecated: false,
      });
    }
  }

  // Mark topics that are no longer in scan as deprecated
  for (const existingTopic of existing.topics) {
    if (!newMap.has(existingTopic.id)) {
      merged.push({
        ...existingTopic,
        deprecated: true,
      });
    }
  }

  return { version: 1, topics: merged };
}
