'use client'

import VideoEditor from '@/components/editor/VideoEditor'

export default function NewProjectPage() {
  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <VideoEditor
        projectName="New Project"
        videoUrl={null}
        captions={[]}
        clips={[]}
        outputs={[]}
        allowImport
      />
    </div>
  )
}
