// ============================================================================
//  Beacon Bridge — lets Beacon host real Audio Unit and VST3 plug-ins.
//
//  Beacon runs in a browser, and a browser cannot load native plug-ins. This
//  process can. It listens on loopback, Beacon connects to it over a
//  WebSocket, and plug-ins are loaded, driven and rendered here while the
//  browser stays in charge of the mix and the transport.
//
//  It never opens an audio device. See PluginHost.h for why that matters.
// ============================================================================

#include <juce_gui_extra/juce_gui_extra.h>

#include <unistd.h>   // getpid, for the discovery file

#include "PluginHost.h"
#include "WebSocketServer.h"

namespace beacon
{

static constexpr const char* kVersion = "1.0.0";
static constexpr int kDefaultPort = 8788;

/** Where the desktop app looks to find out how to reach us.

    NB: JUCE's userApplicationDataDirectory is "~/Library" on macOS, not
    "~/Library/Application Support" as the name suggests. Without the extra
    child, everything lands in a non-standard ~/Library/100Lights. */
static juce::File dataDirectory()
{
    auto root = juce::File::getSpecialLocation (juce::File::userApplicationDataDirectory);
   #if JUCE_MAC
    root = root.getChildFile ("Application Support");
   #endif
    return root.getChildFile ("100Lights").getChildFile ("Beacon");
}

static juce::File discoveryFile()
{
    return dataDirectory().getChildFile ("bridge.json");
}

// ===========================================================================

class BridgeApp : public juce::JUCEApplication,
                  private juce::Timer
{
public:
    const juce::String getApplicationName() override    { return "Beacon Bridge"; }
    const juce::String getApplicationVersion() override { return kVersion; }
    bool moreThanOneInstanceAllowed() override          { return false; }

    void initialise (const juce::String& commandLine) override
    {
        port = commandLine.contains ("--port")
                 ? commandLine.fromFirstOccurrenceOf ("--port", false, false).trim()
                              .upToFirstOccurrenceOf (" ", false, false).getIntValue()
                 : kDefaultPort;
        if (port <= 0) port = kDefaultPort;

        token = juce::Uuid().toDashedString();

        WebSocketServer::Options options;
        options.port = port;
        options.token = token;
        options.allowedOrigins = {
            "https://100lights.com",
            "https://www.100lights.com",
            "https://100lights.app",
            "http://localhost:3000",
            "http://127.0.0.1:3000",
        };

        server.onMessage = [this] (std::shared_ptr<WebSocketConnection> c, const WsMessage& m)
                           { if (c) handle (c, m); };
        server.onOpen    = [this] (std::shared_ptr<WebSocketConnection>) { refreshStatus(); };
        server.onClose   = [this] (std::shared_ptr<WebSocketConnection>) { refreshStatus(); };

        if (! server.start (options))
        {
            juce::AlertWindow::showMessageBoxAsync (
                juce::MessageBoxIconType::WarningIcon,
                "Beacon Bridge",
                "Another copy is already listening on port " + juce::String (port) +
                ", so this one has nothing to do.");
            quit();
            return;
        }

        writeDiscoveryFile();

        window = std::make_unique<StatusWindow> (*this);
        startTimer (1000);
        refreshStatus();
    }

    void shutdown() override
    {
        stopTimer();
        window.reset();
        server.stop();
        host.closeAll();
        discoveryFile().deleteFile();
    }

    void systemRequestedQuit() override { quit(); }

    juce::String status() const
    {
        return "Listening on 127.0.0.1:" + juce::String (port) + "\n"
             + juce::String (server.getConnectionCount()) + " connection(s)\n"
             + juce::String (host.getNumLoaded()) + " plug-in(s) loaded";
    }

private:
    // ------------------------------------------------------------ window --

    class StatusWindow : public juce::DocumentWindow
    {
    public:
        explicit StatusWindow (BridgeApp& appIn)
            : juce::DocumentWindow ("Beacon Bridge", juce::Colour (0xff141414),
                                    juce::DocumentWindow::allButtons),
              app (appIn)
        {
            setUsingNativeTitleBar (true);
            setContentOwned (new Content (app), true);
            centreWithSize (420, 200);
            setResizable (false, false);
            setVisible (true);
        }

        void closeButtonPressed() override
        {
            // Closing the window should not silently stop the audio; the app
            // quits, which tells Beacon the bridge went away.
            juce::JUCEApplication::getInstance()->systemRequestedQuit();
        }

        void refresh() { if (auto* c = dynamic_cast<Content*> (getContentComponent())) c->refresh(); }

    private:
        class Content : public juce::Component
        {
        public:
            explicit Content (BridgeApp& appIn) : app (appIn)
            {
                text.setJustificationType (juce::Justification::topLeft);
                text.setColour (juce::Label::textColourId, juce::Colour (0xffe8e8e8));
                addAndMakeVisible (text);

                blurb.setJustificationType (juce::Justification::topLeft);
                blurb.setColour (juce::Label::textColourId, juce::Colour (0xff8a8a8a));
                blurb.setText ("Beacon uses this to load Audio Unit and VST3 plug-ins. "
                               "It only accepts connections from this machine. "
                               "Quitting it removes plug-ins from the session until it is running again.",
                               juce::dontSendNotification);
                addAndMakeVisible (blurb);

                rescan.setButtonText ("Rescan plug-ins");
                rescan.onClick = [this] { app.startScan (nullptr); };   // no client to report to
                addAndMakeVisible (rescan);

                setSize (420, 200);
            }

            void refresh() { text.setText (app.status(), juce::dontSendNotification); }

            void paint (juce::Graphics& g) override { g.fillAll (juce::Colour (0xff141414)); }

            void resized() override
            {
                auto r = getLocalBounds().reduced (16);
                text.setBounds (r.removeFromTop (60));
                r.removeFromTop (6);
                rescan.setBounds (r.removeFromBottom (28).removeFromLeft (140));
                r.removeFromBottom (8);
                blurb.setBounds (r);
            }

        private:
            BridgeApp& app;
            juce::Label text, blurb;
            juce::TextButton rescan;
        };

        BridgeApp& app;
    };

    void timerCallback() override { refreshStatus(); }
    void refreshStatus() { if (window) window->refresh(); }

    // ------------------------------------------------------- discovery ----

    void writeDiscoveryFile()
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty ("port", port);
        obj->setProperty ("token", token);
        obj->setProperty ("version", kVersion);
        obj->setProperty ("pid", (int) getpid());

        auto f = discoveryFile();
        f.getParentDirectory().createDirectory();
        f.replaceWithText (juce::JSON::toString (juce::var (obj), false));
    }

    // -------------------------------------------------------- protocol ----

    static juce::var errorReply (const juce::String& op, const juce::String& message)
    {
        auto* obj = new juce::DynamicObject();
        obj->setProperty ("op", "error");
        obj->setProperty ("re", op);
        obj->setProperty ("message", message);
        return juce::var (obj);
    }

    static void send (const std::shared_ptr<WebSocketConnection>& c, const juce::var& v)
    {
        if (c && c->isOpen()) c->sendText (juce::JSON::toString (v, true));
    }

    void startScan (std::shared_ptr<WebSocketConnection> client)
    {
        if (scanning.exchange (true)) return;

        juce::Thread::launch ([this, client]
        {
            host.scan ([this, client] (const juce::String& name, int done, int total)
            {
                if (! client || ! client->isOpen()) return;
                auto* obj = new juce::DynamicObject();
                obj->setProperty ("op", "scanning");
                obj->setProperty ("current", name);
                obj->setProperty ("done", done);
                obj->setProperty ("total", total);
                client->sendText (juce::JSON::toString (juce::var (obj), true));
            });

            scanning.store (false);

            if (client && client->isOpen())
            {
                auto* obj = new juce::DynamicObject();
                obj->setProperty ("op", "plugins");
                obj->setProperty ("items", host.describeAll());
                client->sendText (juce::JSON::toString (juce::var (obj), true));
            }
            refreshStatus();
        });
    }

    void handle (const std::shared_ptr<WebSocketConnection>& c, const WsMessage& m)
    {
        if (m.isBinary) return;

        const auto parsed = juce::JSON::parse (m.text);
        const auto op = parsed.getProperty ("op", "").toString();

        if (op == "hello")
        {
            auto* obj = new juce::DynamicObject();
            obj->setProperty ("op", "welcome");
            obj->setProperty ("version", kVersion);
            obj->setProperty ("formats", juce::var (juce::Array<juce::var> { "AudioUnit", "VST3" }));
            send (c, juce::var (obj));
            return;
        }

        if (op == "scan")
        {
            startScan (c);
            return;
        }

        if (op == "plugins")
        {
            auto* obj = new juce::DynamicObject();
            obj->setProperty ("op", "plugins");
            obj->setProperty ("items", host.describeAll());
            send (c, juce::var (obj));
            return;
        }

        if (op == "open")
        {
            host.openAsync (parsed.getProperty ("id", "").toString(),
                            (double) parsed.getProperty ("sampleRate", 48000.0),
                            (int) parsed.getProperty ("blockSize", 512),
                            [this, c] (int uid, juce::String error)
                            {
                                if (uid < 0) { send (c, errorReply ("open", error)); return; }

                                auto* obj = new juce::DynamicObject();
                                obj->setProperty ("op", "opened");
                                obj->setProperty ("uid", uid);
                                obj->setProperty ("plugin", host.describeInstance (uid));
                                send (c, juce::var (obj));
                                refreshStatus();
                            });
            return;
        }

        if (op == "close")
        {
            host.close ((int) parsed.getProperty ("uid", -1));
            refreshStatus();
            return;
        }

        if (op == "param")
        {
            host.setParameter ((int) parsed.getProperty ("uid", -1),
                               (int) parsed.getProperty ("index", -1),
                               (float) (double) parsed.getProperty ("value", 0.0));
            return;
        }

        if (op == "editor")
        {
            host.showEditor ((int) parsed.getProperty ("uid", -1),
                             (bool) parsed.getProperty ("show", true));
            return;
        }

        if (op == "getState")
        {
            auto* obj = new juce::DynamicObject();
            obj->setProperty ("op", "state");
            obj->setProperty ("uid", parsed.getProperty ("uid", -1));
            obj->setProperty ("state", host.getState ((int) parsed.getProperty ("uid", -1)));
            send (c, juce::var (obj));
            return;
        }

        if (op == "setState")
        {
            host.setState ((int) parsed.getProperty ("uid", -1),
                           parsed.getProperty ("state", "").toString());
            return;
        }

        if (op == "render")
        {
            const int uid = (int) parsed.getProperty ("uid", -1);
            const int frames = juce::jlimit (1, 16384, (int) parsed.getProperty ("frames", 512));

            std::vector<NoteEvent> events;
            if (auto* arr = parsed.getProperty ("events", juce::var()).getArray())
            {
                for (const auto& e : *arr)
                {
                    NoteEvent ev;
                    ev.sampleOffset = (int) e.getProperty ("offset", 0);
                    ev.isNoteOn = (bool) e.getProperty ("on", true);
                    ev.pitch = (int) e.getProperty ("pitch", 60);
                    ev.velocity = (float) (double) e.getProperty ("velocity", 0.8);
                    ev.channel = (int) e.getProperty ("channel", 1);
                    events.push_back (ev);
                }
            }

            // [uid][frames][interleaved stereo float32]
            const size_t headerBytes = sizeof (juce::int32) * 2;
            juce::MemoryBlock out (headerBytes + (size_t) frames * 2 * sizeof (float));
            auto* header = static_cast<juce::int32*> (out.getData());
            header[0] = uid;
            header[1] = frames;

            auto* audio = reinterpret_cast<float*> (static_cast<char*> (out.getData()) + headerBytes);

            if (! host.render (uid, frames, events, audio))
            {
                send (c, errorReply ("render", "That plug-in is not open."));
                return;
            }

            if (c->isOpen()) c->sendBinary (out.getData(), out.getSize());
            return;
        }

        send (c, errorReply (op, "Unknown operation."));
    }

    // ---------------------------------------------------------------------

    PluginHost host;
    WebSocketServer server;
    std::unique_ptr<StatusWindow> window;
    std::atomic<bool> scanning { false };
    int port = kDefaultPort;
    juce::String token;
};

} // namespace beacon

START_JUCE_APPLICATION (beacon::BridgeApp)
