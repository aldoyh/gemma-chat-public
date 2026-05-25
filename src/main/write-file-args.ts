export function getWriteFileContent(args: Record<string, unknown>): string | null {
  return typeof args.content === 'string' ? args.content : null
}
