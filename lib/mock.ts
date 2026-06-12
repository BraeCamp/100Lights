import type { Project, PipelineStep, Output, Caption, Clip } from '@/lib/types'
import { sliceCaptions } from '@/lib/captions'

export const DEMO_PROJECT_ID = 'demo'

export function createDemoPipeline(): PipelineStep[] {
  return [
    { id: 'upload', label: 'Upload', description: 'Transferring file to processing servers', status: 'pending', progress: 0 },
    { id: 'transcribe', label: 'Transcribe & Caption', description: 'Converting speech to timestamped captions with speaker detection', status: 'pending', progress: 0 },
    { id: 'analyze', label: 'Analyze', description: 'Identifying key topics and best moments for clips', status: 'pending', progress: 0 },
    { id: 'generate', label: 'Generate', description: 'Creating clips with captions and written content', status: 'pending', progress: 0 },
  ]
}

export const MOCK_CAPTIONS: Caption[] = [
  { start: 0.0,   end: 3.8,   text: "Welcome back to the show.", speaker: "Host" },
  { start: 4.2,   end: 10.5,  text: "Today I'm joined by someone who's completely changed the way I think about building an audience online.", speaker: "Host" },
  { start: 12.0,  end: 18.5,  text: "Before we dive in — quick shoutout to our sponsors. Now, let's get into it.", speaker: "Host" },
  { start: 20.0,  end: 27.5,  text: "So tell me, you went from zero to half a million subscribers in under eighteen months.", speaker: "Host" },
  { start: 27.8,  end: 31.5,  text: "Walk me through what actually worked.", speaker: "Host" },
  { start: 33.0,  end: 40.8,  text: "Yeah, so the honest answer is that I stopped trying to make content and started trying to solve problems.", speaker: "Guest" },
  { start: 41.2,  end: 49.5,  text: "Every video I made was a direct answer to a question someone had asked me.", speaker: "Guest" },
  { start: 50.0,  end: 62.5,  text: "That shift — from 'what do I want to say' to 'what does my audience need to hear' — that changed everything.", speaker: "Guest" },
  { start: 65.0,  end: 72.5,  text: "And the consistency piece? Because I know people always talk about posting every day.", speaker: "Host" },
  { start: 75.0,  end: 86.0,  text: "Consistency matters, but I actually think consistency of quality beats consistency of frequency.", speaker: "Guest" },
  { start: 87.0,  end: 99.5,  text: "I posted twice a week and I never missed a video that I wasn't proud of.", speaker: "Guest" },
  { start: 100.5, end: 112.5, text: "I turned down brand deals early on if they didn't fit.", speaker: "Guest" },
  { start: 113.0, end: 122.0, text: "That trust you build with your audience compounds.", speaker: "Guest" },
  { start: 125.0, end: 133.5, text: "What about the moment you knew this was actually working?", speaker: "Host" },
  { start: 135.0, end: 148.5, text: "There was a comment on one of my videos — it had maybe eight hundred views at the time —", speaker: "Guest" },
  { start: 149.0, end: 161.0, text: "and someone said 'I've been watching creators for years and this is the first time I've actually taken action.'", speaker: "Guest" },
  { start: 162.0, end: 171.5, text: "That was it. That was the moment I knew the work was connecting.", speaker: "Guest" },
  { start: 174.0, end: 182.5, text: "And now looking back, what would you tell someone just starting?", speaker: "Host" },
  { start: 184.5, end: 190.0, text: "Stop waiting for permission.", speaker: "Guest" },
  { start: 190.5, end: 202.0, text: "Stop waiting until you have better equipment, a bigger audience, a clearer niche.", speaker: "Guest" },
  { start: 202.5, end: 216.0, text: "Start now, iterate fast, and listen obsessively to what lands with the small audience you have.", speaker: "Guest" },
  { start: 216.5, end: 224.0, text: "They're telling you exactly what to make next.", speaker: "Guest" },
]

const CLIP_DEFS: Omit<Clip, 'captions'>[] = [
  {
    id: 'clip-1',
    title: 'The Problem-First Shift',
    start: 33.0,
    end: 62.5,
    reason: 'High-impact insight — reframes how creators should think about content strategy',
  },
  {
    id: 'clip-2',
    title: 'Quality Beats Frequency',
    start: 75.0,
    end: 122.0,
    reason: 'Quotable counter-argument to the "post every day" advice — strong engagement driver',
  },
  {
    id: 'clip-3',
    title: 'Stop Waiting for Permission',
    start: 184.5,
    end: 224.0,
    reason: 'Strong motivational close — high shareability for the creator audience',
  },
]

export const MOCK_CLIPS: Clip[] = CLIP_DEFS.map((def) => ({
  ...def,
  captions: sliceCaptions(MOCK_CAPTIONS, def.start, def.end),
}))

export const MOCK_OUTPUTS: Output[] = [
  {
    id: 'transcript-1',
    type: 'transcript',
    title: 'Full Transcript',
    wordCount: MOCK_CAPTIONS.reduce((acc, c) => acc + c.text.split(' ').length, 0),
    createdAt: new Date(),
    content: MOCK_CAPTIONS.map((c) => c.text).join(' '),
    captions: MOCK_CAPTIONS,
  },
  {
    id: 'clips-1',
    type: 'clips',
    title: 'AI-Selected Clips',
    createdAt: new Date(),
    content: '',
    clips: MOCK_CLIPS,
  },
  {
    id: 'article-1',
    type: 'article',
    title: 'How Solving Problems Instead of Making Content Built a 500K Audience',
    wordCount: 820,
    createdAt: new Date(),
    content: `There's a counterintuitive truth at the heart of every breakout creator story: the ones who grow fastest are rarely the ones thinking hardest about growth.

In a recent conversation on the show, we sat down with a creator who went from zero to half a million subscribers in eighteen months — not by gaming the algorithm, but by fundamentally rethinking what content is for.

**The Problem-First Shift**

"I stopped trying to make content and started trying to solve problems," they told us. "Every video I made was a direct answer to a question someone had asked me."

This reframe — from self-expression to service — is deceptively simple. Most creators start with what they want to say. The fastest-growing creators start with what their audience needs to hear.

**Quality Over Cadence**

The conventional wisdom says post every day. The data on this creator's channel tells a different story.

Posting twice a week, with a hard personal rule never to publish something they weren't proud of, they built an audience that trusted them. Early brand deals were turned down if they didn't fit. That restraint — expensive in the short term — paid compound interest over eighteen months.

**The Moment It Clicked**

Eight hundred views. That's how many the video had when a comment arrived that changed everything: "I've been watching creators for years and this is the first time I've actually taken action."

Not a million views. Not a viral moment. A single comment on a small video that told them the work was connecting at a level that mattered.

**The Advice That Actually Scales**

Stop waiting for permission. Start now, iterate based on what resonates with the small audience you have, and treat their feedback as a direct brief for your next piece of content.

The audience you have — even if it's fifty people — is telling you exactly what to make next.`,
  },
  {
    id: 'shownotes-1',
    type: 'show_notes',
    title: 'Episode Show Notes',
    wordCount: 210,
    createdAt: new Date(),
    content: `**Guest:** Independent creator, 500K+ subscribers across platforms

**Episode Summary:**
A candid conversation about what actually drives audience growth — and why the conventional wisdom about posting frequency might be holding you back.

**Key Takeaways:**
- Shift from "what do I want to say" to "what does my audience need to hear"
- Consistency of quality beats consistency of frequency
- Early restraint on brand deals builds long-term audience trust
- Small audiences give you the clearest signal — listen to them

**Timestamps:**
- 0:00 — Introduction
- 0:33 — The problem-first mindset shift
- 1:15 — Quality vs. frequency debate
- 2:15 — The 800-view comment that changed everything
- 3:04 — Advice for creators just starting out

**Connect with the guest:** [social links]`,
  },
  {
    id: 'blog-1',
    type: 'blog_post',
    title: 'The Creator Who Turned Down Brand Deals to Build Something That Lasts',
    wordCount: 540,
    createdAt: new Date(),
    content: `Most creators take every brand deal they can get when they're starting out. It's income. It's validation. It feels like the business is working.

Our latest guest did the opposite — and it's a big part of why their channel hit 500,000 subscribers in eighteen months.

**Saying no when you can't afford to**

"I turned down brand deals early on if they didn't fit," they told us. At the time, that meant leaving real money on the table. But it also meant that every video felt like the creator's genuine recommendation — and audiences picked up on that.

Trust is the hardest thing to build and the easiest thing to lose.

**What 800 views taught them about impact**

The video that changed everything had 800 views when it mattered most. A single comment from someone saying they'd finally taken action after years of watching creators.

That clarity — knowing exactly what success looks like beyond a number — is what keeps the work intentional when the algorithm throws you a curveball.

**Start before you're ready**

The advice for new creators was the most direct thing said in the whole conversation: stop waiting for permission.

Better equipment won't make better content. What matters is starting, listening closely to the small audience you earn, and treating their response as a brief for what to make next.`,
  },
]

export const mockProjects: Project[] = [
  {
    id: '1',
    name: 'Product Launch Keynote 2025',
    contentType: 'video',
    status: 'completed',
    duration: 3840,
    createdAt: new Date(Date.now() - 86400000 * 2),
    pipeline: [],
    outputs: [MOCK_OUTPUTS[2], MOCK_OUTPUTS[3]],
  },
  {
    id: '2',
    name: 'The Deep Work Podcast — Ep. 47',
    contentType: 'audio',
    status: 'completed',
    duration: 2700,
    createdAt: new Date(Date.now() - 86400000 * 5),
    pipeline: [],
    outputs: [MOCK_OUTPUTS[3], MOCK_OUTPUTS[4]],
  },
  {
    id: '3',
    name: 'Q2 Team All-Hands Recording',
    contentType: 'video',
    status: 'completed',
    duration: 5400,
    createdAt: new Date(Date.now() - 86400000 * 9),
    pipeline: [],
    outputs: [MOCK_OUTPUTS[2]],
  },
]

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  if (h > 0) return `${h}h ${m}m`
  return `${m}m`
}

export function formatRelativeDate(date: Date): string {
  const diff = Date.now() - date.getTime()
  const days = Math.floor(diff / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}
