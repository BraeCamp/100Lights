#include "PluginHost.h"

namespace beacon
{

// ---------------------------------------------------------------------------

struct PluginHost::Instance
{
    std::unique_ptr<juce::AudioPluginInstance> plugin;
    juce::AudioBuffer<float> buffer;
    juce::MidiBuffer midi;
    double sampleRate = 48000.0;
    int blockSize = 512;
    juce::String identifier;

    /** The plug-in's own window. Owned here so closing the instance closes it. */
    std::unique_ptr<juce::DocumentWindow> editorWindow;
};

namespace
{

/** A window that just holds a plug-in editor and tidies up after itself. */
class EditorWindow : public juce::DocumentWindow
{
public:
    EditorWindow (const juce::String& name, juce::AudioProcessorEditor* editor)
        : juce::DocumentWindow (name, juce::Colours::black,
                                juce::DocumentWindow::closeButton | juce::DocumentWindow::minimiseButton)
    {
        setUsingNativeTitleBar (true);
        setContentOwned (editor, true);
        setResizable (editor->isResizable(), false);
        centreWithSize (getWidth(), getHeight());
        setVisible (true);
        toFront (true);
    }

    void closeButtonPressed() override { setVisible (false); }
};

} // namespace

// ---------------------------------------------------------------------------

PluginHost::PluginHost()
{
    formats.addDefaultFormats();
}

PluginHost::~PluginHost()
{
    cancelPendingUpdate();
    closeAll();
}

int PluginHost::getNumLoaded() const
{
    const juce::ScopedLock sl (lock);
    return (int) instances.size();
}

// ------------------------------------------------------------------ scan ---

void PluginHost::scan (std::function<void (const juce::String&, int, int)> progress)
{
    for (int f = 0; f < formats.getNumFormats(); ++f)
    {
        auto* format = formats.getFormat (f);
        if (format == nullptr) continue;

        // Only the standard folders. This process will happily load native code
        // from anywhere it is pointed at, so it is not pointed anywhere else.
        const auto paths = format->getDefaultLocationsToSearch();

        juce::PluginDirectoryScanner scanner (known, *format, paths, true, juce::File(), false);

        juce::String name;
        int done = 0;
        const int total = 100;   // the scanner reports fractional progress
        while (scanner.scanNextFile (true, name))
        {
            done = (int) (scanner.getProgress() * 100.0);
            if (progress) progress (name, done, total);
        }
    }
}

juce::var PluginHost::describeAll() const
{
    juce::Array<juce::var> items;

    for (const auto& type : known.getTypes())
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty ("id", type.createIdentifierString());
        obj->setProperty ("name", type.name);
        obj->setProperty ("vendor", type.manufacturerName);
        obj->setProperty ("version", type.version);
        obj->setProperty ("format", type.pluginFormatName);
        obj->setProperty ("category", type.category);
        obj->setProperty ("isInstrument", type.isInstrument);
        obj->setProperty ("path", type.fileOrIdentifier);
        obj->setProperty ("numInputs", type.numInputChannels);
        obj->setProperty ("numOutputs", type.numOutputChannels);
        items.add (juce::var (obj));
    }

    return juce::var (items);
}

// ------------------------------------------------------------------ open ---

void PluginHost::openAsync (const juce::String& identifier, double sampleRate, int blockSize,
                            OpenCallback done)
{
    juce::PluginDescription description;
    bool found = false;
    for (const auto& t : known.getTypes())
        if (t.createIdentifierString() == identifier) { description = t; found = true; break; }

    if (! found)
    {
        if (done) done (-1, "That plug-in is not in the scan results. Rescan and try again.");
        return;
    }

    // Everything below has to happen on the message thread.
    juce::MessageManager::callAsync (
        [this, description, sampleRate, blockSize, identifier, done]
        {
            formats.createPluginInstanceAsync (
                description, sampleRate, blockSize,
                [this, sampleRate, blockSize, identifier, done]
                (std::unique_ptr<juce::AudioPluginInstance> plugin, const juce::String& error)
                {
                    if (plugin == nullptr)
                    {
                        if (done) done (-1, error.isNotEmpty() ? error : "The plug-in refused to load.");
                        return;
                    }

                    // Stereo out is what Beacon mixes; ask for it, but do not
                    // fail if the plug-in insists otherwise — render() copes.
                    plugin->setPlayConfigDetails (plugin->getTotalNumInputChannels(), 2,
                                                  sampleRate, blockSize);
                    plugin->prepareToPlay (sampleRate, blockSize);

                    auto inst = std::make_unique<Instance>();
                    inst->plugin = std::move (plugin);
                    inst->sampleRate = sampleRate;
                    inst->blockSize = blockSize;
                    inst->identifier = identifier;
                    inst->buffer.setSize (juce::jmax (2, inst->plugin->getTotalNumOutputChannels()),
                                          blockSize);

                    int uid = -1;
                    {
                        const juce::ScopedLock sl (lock);
                        uid = nextUid++;
                        instances[uid] = std::move (inst);
                    }

                    if (done) done (uid, {});
                });
        });
}

void PluginHost::close (int uid)
{
    std::unique_ptr<Instance> dying;
    {
        const juce::ScopedLock sl (lock);
        const auto it = instances.find (uid);
        if (it == instances.end()) return;
        dying = std::move (it->second);
        instances.erase (it);
    }

    // The window has to die on the message thread, and before the processor.
    if (dying->editorWindow != nullptr)
    {
        juce::MessageManager::callAsync (
            [w = dying->editorWindow.release(), p = dying->plugin.release()]
            {
                delete w;
                if (p != nullptr) { p->releaseResources(); delete p; }
            });
        return;
    }

    dying->plugin->releaseResources();
}

void PluginHost::closeAll()
{
    std::vector<int> uids;
    {
        const juce::ScopedLock sl (lock);
        for (const auto& pair : instances) uids.push_back (pair.first);
    }
    for (int uid : uids) close (uid);
}

// -------------------------------------------------------------- describe ---

juce::var PluginHost::describeInstance (int uid) const
{
    const juce::ScopedLock sl (lock);
    const auto it = instances.find (uid);
    if (it == instances.end()) return {};

    auto* plugin = it->second->plugin.get();
    auto* obj = new juce::DynamicObject();
    obj->setProperty ("uid", uid);
    obj->setProperty ("name", plugin->getName());
    obj->setProperty ("latency", plugin->getLatencySamples());
    obj->setProperty ("numOutputs", plugin->getTotalNumOutputChannels());
    obj->setProperty ("acceptsMidi", plugin->acceptsMidi());
    obj->setProperty ("hasEditor", plugin->hasEditor());

    // A VST3 built with JUCE publishes 130 MIDI CC parameters per channel —
    // over 2000 of them — on top of the plug-in's own. They are real, and a
    // DAW does expose them, but sending them all would swamp both the wire and
    // the panel, and none of them is what anyone came here to turn.
    juce::Array<juce::var> params;
    const auto& list = plugin->getParameters();
    int skippedMidiCC = 0;
    const int maxReported = 512;

    for (int i = 0; i < list.size(); ++i)
    {
        auto* p = list[i];
        const auto name = p->getName (48);

        if (name.startsWith ("MIDI CC ")) { ++skippedMidiCC; continue; }
        if (params.size() >= maxReported) break;

        auto* po = new juce::DynamicObject();
        po->setProperty ("index", i);
        po->setProperty ("name", name);
        po->setProperty ("label", p->getLabel());
        po->setProperty ("value", p->getValue());
        po->setProperty ("text", p->getText (p->getValue(), 32));
        po->setProperty ("automatable", p->isAutomatable());
        if (p->isDiscrete() && p->getNumSteps() < 128)
            po->setProperty ("steps", p->getNumSteps());
        params.add (juce::var (po));
    }

    obj->setProperty ("parameters", juce::var (params));
    obj->setProperty ("parameterCount", list.size());
    obj->setProperty ("midiCCParametersHidden", skippedMidiCC);
    obj->setProperty ("parametersTruncated", params.size() >= maxReported);

    return juce::var (obj);
}

void PluginHost::setParameter (int uid, int index, float value)
{
    const juce::ScopedLock sl (lock);
    const auto it = instances.find (uid);
    if (it == instances.end()) return;
    const auto& params = it->second->plugin->getParameters();
    if (index >= 0 && index < params.size())
        params[index]->setValueNotifyingHost (juce::jlimit (0.0f, 1.0f, value));
}

float PluginHost::getParameter (int uid, int index) const
{
    const juce::ScopedLock sl (lock);
    const auto it = instances.find (uid);
    if (it == instances.end()) return 0.0f;
    const auto& params = it->second->plugin->getParameters();
    return (index >= 0 && index < params.size()) ? params[index]->getValue() : 0.0f;
}

// ---------------------------------------------------------------- render ---

bool PluginHost::render (int uid, int frames, const std::vector<NoteEvent>& events, float* out)
{
    const juce::ScopedLock sl (lock);
    const auto it = instances.find (uid);
    if (it == instances.end() || frames <= 0) return false;

    auto& inst = *it->second;
    auto* plugin = inst.plugin.get();

    if (frames > inst.buffer.getNumSamples())
        inst.buffer.setSize (inst.buffer.getNumChannels(), frames, false, true, true);

    inst.buffer.clear();

    inst.midi.clear();
    for (const auto& e : events)
    {
        const int offset = juce::jlimit (0, frames - 1, e.sampleOffset);
        inst.midi.addEvent (
            e.isNoteOn
              ? juce::MidiMessage::noteOn (e.channel, e.pitch,
                                           (juce::uint8) juce::jlimit (1, 127, (int) (e.velocity * 127.0f)))
              : juce::MidiMessage::noteOff (e.channel, e.pitch),
            offset);
    }

    juce::AudioBuffer<float> view (inst.buffer.getArrayOfWritePointers(),
                                   inst.buffer.getNumChannels(), frames);
    plugin->processBlock (view, inst.midi);

    const int channels = view.getNumChannels();
    const float* left = channels > 0 ? view.getReadPointer (0) : nullptr;
    const float* right = channels > 1 ? view.getReadPointer (1) : left;

    if (left == nullptr)
    {
        std::fill (out, out + frames * 2, 0.0f);
        return true;
    }

    for (int i = 0; i < frames; ++i)
    {
        out[i * 2]     = left[i];
        out[i * 2 + 1] = right[i];
    }
    return true;
}

// ----------------------------------------------------------------- state ---

juce::String PluginHost::getState (int uid) const
{
    const juce::ScopedLock sl (lock);
    const auto it = instances.find (uid);
    if (it == instances.end()) return {};

    juce::MemoryBlock block;
    it->second->plugin->getStateInformation (block);
    return block.toBase64Encoding();
}

void PluginHost::setState (int uid, const juce::String& base64)
{
    const juce::ScopedLock sl (lock);
    const auto it = instances.find (uid);
    if (it == instances.end()) return;

    juce::MemoryBlock block;
    if (! block.fromBase64Encoding (base64)) return;
    it->second->plugin->setStateInformation (block.getData(), (int) block.getSize());
}

// ---------------------------------------------------------------- editor ---

void PluginHost::showEditor (int uid, bool shouldShow)
{
    {
        const juce::ScopedLock sl (editorLock);
        pendingEditorRequests.emplace_back (uid, shouldShow);
    }
    triggerAsyncUpdate();
}

void PluginHost::handleAsyncUpdate()
{
    std::vector<std::pair<int, bool>> requests;
    {
        const juce::ScopedLock sl (editorLock);
        requests.swap (pendingEditorRequests);
    }

    for (const auto& [uid, shouldShow] : requests)
    {
        const juce::ScopedLock sl (lock);
        const auto it = instances.find (uid);
        if (it == instances.end()) continue;
        auto& inst = *it->second;

        if (! shouldShow)
        {
            if (inst.editorWindow) inst.editorWindow->setVisible (false);
            continue;
        }

        if (inst.editorWindow)
        {
            inst.editorWindow->setVisible (true);
            inst.editorWindow->toFront (true);
            continue;
        }

        if (! inst.plugin->hasEditor()) continue;
        if (auto* editor = inst.plugin->createEditorIfNeeded())
            inst.editorWindow = std::make_unique<EditorWindow> (inst.plugin->getName(), editor);
    }
}

} // namespace beacon
