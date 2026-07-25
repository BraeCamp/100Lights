// Wrap a DawProject into the CfProjFile that POST /api/projects expects, so a
// mobile session saves as a normal project that opens on desktop.

import { DEFAULT_ADJUSTMENTS } from '@/lib/editor-types'
import { CF_VERSION, type CfProjFile } from '@/lib/project-serializer'
import type { DawProject } from '@/lib/daw-types'

export function projectToCfFile(dawProject: DawProject): CfProjFile {
  return {
    _type: '100lights-project',
    version: CF_VERSION,
    id: crypto.randomUUID(),
    name: dawProject.name || 'Mobile Song',
    savedAt: new Date().toISOString(),
    tracks: [], clips: [], adjustments: DEFAULT_ADJUSTMENTS, zoomLevel: 1,
    captions: [], outputs: [], media: [], audioMedia: [],
    moduleSavedAt: {}, modules: ['audio'], audioMode: 'music',
    dawProject,
  }
}
