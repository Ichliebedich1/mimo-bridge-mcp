import type { LiveEvent } from './types';

export type LiveEventEntry = {
  event: LiveEvent;
  index: number;
};

export type LiveViewerItem =
  | { type: 'event'; key: string; event: LiveEvent; index: number }
  | { type: 'tool_group'; key: string; events: LiveEventEntry[] };

export function groupLiveEvents(events: LiveEvent[]): LiveViewerItem[] {
  const items: LiveViewerItem[] = [];
  let toolGroup: LiveEventEntry[] = [];

  function flushToolGroup() {
    if (toolGroup.length === 0) return;
    const first = toolGroup[0];
    const last = toolGroup[toolGroup.length - 1];
    items.push({
      type: 'tool_group',
      key: 'tool-group-' + first.index + '-' + last.index,
      events: toolGroup,
    });
    toolGroup = [];
  }

  events.forEach((event, index) => {
    if (event.kind === 'tool') {
      toolGroup.push({ event, index });
      return;
    }
    flushToolGroup();
    items.push({
      type: 'event',
      key: event.kind + '-' + index,
      event,
      index,
    });
  });

  flushToolGroup();
  return items;
}

export function liveToolGroupPreview(events: LiveEvent[]): string {
  const uniqueTools = Array.from(new Set(events
    .map((event) => event.tool ?? event.event_type)
    .filter(Boolean)
  ));
  const shownTools = uniqueTools.slice(0, 4);
  if (shownTools.length === 0) {
    return '工具调用已折叠，展开可查看每次调用详情。';
  }
  const suffix = uniqueTools.length > shownTools.length ? ' 等' : '';
  return shownTools.join(' / ') + suffix;
}
