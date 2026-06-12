const urls = new Map<string, string>()

export function storeFile(projectId: string, file: File): string {
  const existing = urls.get(projectId)
  if (existing) URL.revokeObjectURL(existing)
  const url = URL.createObjectURL(file)
  urls.set(projectId, url)
  return url
}

export function getFileUrl(projectId: string): string | null {
  return urls.get(projectId) ?? null
}
