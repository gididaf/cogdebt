import React, { useState } from 'react';
import { Text, Box, useInput } from 'ink';
import { ScoreText, TrendIcon } from './ProgressBar.js';
import type { Topic, TopicScore } from '../../types.js';

interface TopicSelectorProps {
  topics: Topic[];
  allTopics: Topic[];
  scores: Record<string, TopicScore>;
  preSelected: string[];
  onSubmit: (selectedIds: string[]) => void;
}

export function TopicSelector({ topics, allTopics, scores, preSelected, onSubmit }: TopicSelectorProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set(preSelected));
  const [cursor, setCursor] = useState(0);

  // Build display list: parent headers + leaf topics
  type DisplayItem = { type: 'parent'; name: string } | { type: 'topic'; topic: Topic };
  const displayItems: DisplayItem[] = [];

  // Group topics by parent
  const parentMap = new Map<string | null, Topic[]>();
  for (const t of topics) {
    const parentId = t.parentId;
    const existing = parentMap.get(parentId) || [];
    existing.push(t);
    parentMap.set(parentId, existing);
  }

  // Find top-level parents
  const topLevelParentIds = new Set<string | null>();
  for (const t of topics) {
    if (t.parentId) {
      const parent = allTopics.find(p => p.id === t.parentId);
      if (parent && !parent.deprecated) {
        // Find the top-level ancestor
        let current = parent;
        while (current.parentId) {
          const grandparent = allTopics.find(p => p.id === current.parentId);
          if (grandparent && !grandparent.deprecated) {
            current = grandparent;
          } else break;
        }
        topLevelParentIds.add(current.id);
      }
    } else {
      topLevelParentIds.add(null);
    }
  }

  // Build grouped display
  const topLevelParents = allTopics.filter(t => !t.parentId && !t.deprecated && topLevelParentIds.has(t.id));
  const orphans = topics.filter(t => !t.parentId);

  for (const parent of topLevelParents) {
    displayItems.push({ type: 'parent', name: parent.name });
    // Find leaf topics under this parent (direct or nested)
    const children = topics.filter(t => {
      let current = t;
      while (current.parentId) {
        if (current.parentId === parent.id) return true;
        const p = allTopics.find(x => x.id === current.parentId);
        if (!p) break;
        current = p;
      }
      return false;
    });
    for (const child of children) {
      displayItems.push({ type: 'topic', topic: child });
    }
  }

  // Add orphan topics (no parent)
  for (const t of orphans) {
    displayItems.push({ type: 'topic', topic: t });
  }

  // Get only selectable indices
  const selectableIndices = displayItems
    .map((item, i) => item.type === 'topic' ? i : -1)
    .filter(i => i >= 0);

  const currentSelectablePos = selectableIndices.indexOf(cursor);
  const actualCursor = selectableIndices[Math.max(0, currentSelectablePos)] ?? selectableIndices[0] ?? 0;

  useInput((input, key) => {
    if (key.upArrow) {
      const pos = selectableIndices.indexOf(cursor);
      if (pos > 0) setCursor(selectableIndices[pos - 1]);
    }
    if (key.downArrow) {
      const pos = selectableIndices.indexOf(cursor);
      if (pos < selectableIndices.length - 1) setCursor(selectableIndices[pos + 1]);
    }
    if (key.tab) {
      const pos = selectableIndices.indexOf(cursor);
      const next = (pos + 1) % selectableIndices.length;
      setCursor(selectableIndices[next]);
    }
    if (input === ' ') {
      const item = displayItems[cursor];
      if (item?.type === 'topic') {
        const newSelected = new Set(selected);
        if (newSelected.has(item.topic.id)) {
          newSelected.delete(item.topic.id);
        } else {
          newSelected.add(item.topic.id);
        }
        setSelected(newSelected);
      }
    }
    if (input === 'a') {
      // Toggle all
      if (selected.size === topics.length) {
        setSelected(new Set());
      } else {
        setSelected(new Set(topics.map(t => t.id)));
      }
    }
    if (key.return) {
      if (selected.size > 0) {
        onSubmit(Array.from(selected));
      }
    }
  });

  return (
    <Box flexDirection="column">
      <Box marginTop={1}>
        <Text bold>  Select topics to quiz on:</Text>
      </Box>
      <Box marginTop={1} flexDirection="column">
        {displayItems.map((item, i) => {
          if (item.type === 'parent') {
            return (
              <Box key={`p-${i}`}>
                <Text>  </Text>
                <Text bold dimColor>{item.name}</Text>
              </Box>
            );
          }

          const t = item.topic;
          const isSelected = selected.has(t.id);
          const isCursor = cursor === i;
          const score = scores[t.id];
          const checkbox = isSelected ? '◉' : '○';
          const checkColor = isSelected ? 'green' : 'gray';

          return (
            <Box key={t.id}>
              <Text>  </Text>
              <Text color={isCursor ? 'cyan' : undefined}>{isCursor ? '❯' : ' '} </Text>
              <Text color={checkColor}>{checkbox} </Text>
              <Text color={isCursor ? 'cyan' : undefined}>{t.name.padEnd(30)}</Text>
              {score && (
                <>
                  <Text> </Text>
                  <ScoreText score={score.score} />
                  <Text>  </Text>
                  <TrendIcon trend={score.trend} />
                </>
              )}
            </Box>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text dimColor>  [↑↓] navigate  [Space] toggle  [a] all  [Enter] start  </Text>
        <Text dimColor>({selected.size} selected)</Text>
      </Box>
    </Box>
  );
}
