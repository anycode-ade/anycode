export interface ToolResultImage {
  mimeType: string;
  data: string;
}

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
};

const getField = (value: unknown, key: string) => {
  return asRecord(value)?.[key];
};

const getMaybeString = (value: unknown): string | undefined => {
  return typeof value === 'string' ? value : undefined;
};

/**
 * Images are shown in the chat feed, not inside the collapsed tool-call details.
 */
export const getToolResultImages = (result: unknown): ToolResultImage[] => {
  const resultRecord = asRecord(result);
  const content = resultRecord?.content ?? asRecord(resultRecord?.fields)?.content;
  if (!Array.isArray(content)) {
    return [];
  }
  return content.flatMap((item: unknown) => {
    const block = asRecord(getField(item, 'content')) ?? asRecord(item);
    if (block?.type !== 'image' || typeof block.data !== 'string') {
      return [];
    }
    return [{ mimeType: getMaybeString(block.mimeType) ?? 'image/png', data: block.data }];
  });
};
