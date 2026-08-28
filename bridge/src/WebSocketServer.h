// ============================================================================
//  A minimal RFC 6455 WebSocket server.
//
//  JUCE has no WebSocket, and the browser cannot open a raw socket, so this is
//  the only way Beacon-in-a-browser can talk to a native process. It is
//  deliberately small: one thread per connection, text and binary frames, no
//  extensions, no compression.
//
//  SECURITY. This listens on the loopback interface only, and every connection
//  must pass two checks before it can do anything:
//
//    1. Origin allowlist. A browser sends Origin honestly and cannot forge it,
//       so this is what stops any random web page from driving your plug-ins.
//    2. A token, for callers that are not a browser (the Electron app), which
//       is written to a file only a local user can read.
//
//  The surface exposed is still real: loading a plug-in means loading native
//  code the user already has installed. Scanning is therefore restricted to
//  the standard plug-in folders and nothing else.
// ============================================================================
#pragma once

#include <juce_core/juce_core.h>
#include <functional>
#include <memory>
#include <vector>

namespace beacon
{

class WebSocketConnection;

/** One message from a client. Text is JSON; binary is reserved for future
    client-to-server audio (nothing sends it yet). */
struct WsMessage
{
    bool isBinary = false;
    juce::String text;
    juce::MemoryBlock data;
};

class WebSocketServer : private juce::Thread
{
public:
    struct Options
    {
        int port = 8788;
        juce::StringArray allowedOrigins;
        juce::String token;
        /** Electron connects over loopback with the token and no Origin. */
        bool allowMissingOrigin = true;
    };

    // Handlers get a shared_ptr, not a reference: replies can be asynchronous
    // (loading a plug-in has to happen on the message thread), and by the time
    // one comes back the client may already have gone away.
    using MessageHandler = std::function<void (std::shared_ptr<WebSocketConnection>, const WsMessage&)>;
    using ConnectionHandler = std::function<void (std::shared_ptr<WebSocketConnection>)>;

    WebSocketServer();
    ~WebSocketServer() override;

    bool start (Options options);
    void stop();

    int  getPort() const noexcept { return opts.port; }
    bool isRunning() const noexcept { return isThreadRunning(); }

    MessageHandler onMessage;
    ConnectionHandler onOpen;
    ConnectionHandler onClose;

    /** Number of live connections, for the status line. */
    int getConnectionCount() const;

private:
    void run() override;
    void reap();

    Options opts;
    std::unique_ptr<juce::StreamingSocket> listener;
    mutable juce::CriticalSection lock;
    std::vector<std::shared_ptr<WebSocketConnection>> connections;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (WebSocketServer)
};

// ---------------------------------------------------------------------------

class WebSocketConnection : public std::enable_shared_from_this<WebSocketConnection>,
                            private juce::Thread
{
public:
    WebSocketConnection (std::unique_ptr<juce::StreamingSocket> socket,
                         const WebSocketServer::Options& options,
                         WebSocketServer& owner);
    ~WebSocketConnection() override;

    void begin();
    void close();

    bool sendText (const juce::String& text);
    bool sendBinary (const void* data, size_t bytes);

    bool isOpen() const noexcept { return open.load(); }
    std::shared_ptr<WebSocketConnection> weakSelf();
    juce::String getOrigin() const { return origin; }

private:
    void run() override;
    bool performHandshake();
    bool readFrame (WsMessage& out, bool& isClose);
    bool writeFrame (juce::uint8 opcode, const void* data, size_t bytes);
    bool readExactly (void* dest, int numBytes);

    std::unique_ptr<juce::StreamingSocket> socket;
    WebSocketServer::Options opts;
    WebSocketServer& server;
    juce::String origin;
    std::atomic<bool> open { false };
    juce::CriticalSection writeLock;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (WebSocketConnection)
};

} // namespace beacon
