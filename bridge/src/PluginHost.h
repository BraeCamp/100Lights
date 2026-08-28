// ============================================================================
//  Loading and running real plug-ins.
//
//  THE IMPORTANT DESIGN DECISION: this process never opens an audio device.
//  Beacon asks for N frames, the bridge renders exactly N frames and sends them
//  back, and the browser mixes them with everything else. The alternative —
//  letting the bridge play its own audio — would put the plug-ins on a
//  different clock from the rest of the session, so they could never stay in
//  time with it, and an offline bounce could not include them at all.
//
//  A pull model also means the same path serves live playback (Beacon keeps a
//  few blocks of buffer ahead of the playhead) and rendering a mixdown (Beacon
//  pulls as fast as the bridge can go). No separate offline code path, so
//  nothing can be true of one and false of the other.
//
//  Formats: Audio Units and VST3. CLAP hosting is not included — JUCE has no
//  CLAP host format, and writing one is its own project. Beacon's own web
//  plugins cover the "runs anywhere" case, so the gap is narrow.
// ============================================================================
#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_utils/juce_audio_utils.h>
#include <map>
#include <memory>

namespace beacon
{

struct NoteEvent
{
    int  sampleOffset = 0;
    bool isNoteOn = true;
    int  pitch = 60;
    float velocity = 0.8f;
    int  channel = 1;
};

class PluginHost : private juce::AsyncUpdater
{
public:
    PluginHost();
    ~PluginHost() override;

    /** Rescan the standard plug-in folders. Blocking; the caller does it on a
        worker thread and reports progress. */
    void scan (std::function<void (const juce::String& name, int done, int total)> progress);

    /** Everything found, as JSON for the wire. */
    juce::var describeAll() const;

    /** Load an instance.
        Asynchronous because plug-ins must be instantiated on the message
        thread — a VST3 or AU created from a worker thread either asserts or
        hangs, which is exactly what it looks like when a load "times out".
        The callback also arrives on the message thread. */
    using OpenCallback = std::function<void (int uid, juce::String error)>;
    void openAsync (const juce::String& identifier, double sampleRate, int blockSize,
                    OpenCallback done);

    void close (int uid);
    void closeAll();

    /** Parameters and metadata for a loaded instance. */
    juce::var describeInstance (int uid) const;

    void setParameter (int uid, int index, float value);
    float getParameter (int uid, int index) const;

    /** Render exactly `frames` samples, applying the events at their offsets.
        Writes interleaved stereo into `out`, which must hold frames * 2 floats. */
    bool render (int uid, int frames, const std::vector<NoteEvent>& events, float* out);

    /** Plug-in state, base64, for saving into a Beacon project. */
    juce::String getState (int uid) const;
    void setState (int uid, const juce::String& base64);

    /** Show or hide the plug-in's own window. Must be called on the message
        thread; the protocol layer marshals it. */
    void showEditor (int uid, bool shouldShow);

    int getNumLoaded() const;

private:
    struct Instance;

    void handleAsyncUpdate() override;

    juce::AudioPluginFormatManager formats;
    juce::KnownPluginList known;

    mutable juce::CriticalSection lock;
    std::map<int, std::unique_ptr<Instance>> instances;
    int nextUid = 1;

    // editor requests marshalled to the message thread
    juce::CriticalSection editorLock;
    std::vector<std::pair<int, bool>> pendingEditorRequests;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PluginHost)
};

} // namespace beacon
