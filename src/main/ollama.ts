export const OLLAMA_BASE_URL = 'http://localhost:11434'

export interface OllamaModelEntry {
  name: string
  size: number
  details?: { family?: string; parameter_size?: string }
}

export async function isOllamaRunning(): Promise<boolean> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/v1/models`, { signal: AbortSignal.timeout(2000) })
    return res.ok
  } catch {
    return false
  }
}

export async function listOllamaModels(): Promise<OllamaModelEntry[]> {
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) return []
    const data = (await res.json()) as { models?: OllamaModelEntry[] }
    return data.models ?? []
  } catch {
    return []
  }
}

function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(0)} MB`
  return `${bytes} B`
}

export function ollamaModelToInfo(entry: OllamaModelEntry): { name: string; label: string; size: string } {
  const label = entry.details?.parameter_size
    ? `${entry.name} (${entry.details.parameter_size})`
    : entry.name
  return {
    name: entry.name,
    label,
    size: entry.size ? formatBytes(entry.size) : ''
  }
}
