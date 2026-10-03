export interface ClipboardWriter {
  writeText(text: string): Promise<void>;
}

export async function writeClipboard(
  text: string,
  writer?: ClipboardWriter,
): Promise<void> {
  const clipboard =
    writer ??
    (typeof navigator !== "undefined" ? navigator.clipboard : undefined);
  if (!clipboard?.writeText) {
    throw new Error("Clipboard API is unavailable.");
  }
  await clipboard.writeText(text);
}
