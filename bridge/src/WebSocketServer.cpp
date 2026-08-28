#include "WebSocketServer.h"

namespace beacon
{

// ---------------------------------------------------------------------------
//  SHA-1. Needed only for the WebSocket handshake, which specifies it; JUCE
//  ships SHA-256 but not SHA-1, and the handshake will not accept anything
//  else. Not used for anything security-bearing here.
// ---------------------------------------------------------------------------
namespace
{

struct Sha1
{
    juce::uint32 h[5] { 0x67452301u, 0xEFCDAB89u, 0x98BADCFEu, 0x10325476u, 0xC3D2E1F0u };
    juce::uint64 total = 0;
    juce::uint8 block[64] {};
    size_t blockLen = 0;

    static juce::uint32 rol (juce::uint32 v, int n) { return (v << n) | (v >> (32 - n)); }

    void processBlock (const juce::uint8* p)
    {
        juce::uint32 w[80];
        for (int i = 0; i < 16; ++i)
            w[i] = ((juce::uint32) p[i * 4] << 24) | ((juce::uint32) p[i * 4 + 1] << 16)
                 | ((juce::uint32) p[i * 4 + 2] << 8) | (juce::uint32) p[i * 4 + 3];
        for (int i = 16; i < 80; ++i)
            w[i] = rol (w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);

        juce::uint32 a = h[0], b = h[1], c = h[2], d = h[3], e = h[4];
        for (int i = 0; i < 80; ++i)
        {
            juce::uint32 f, k;
            if (i < 20)      { f = (b & c) | ((~b) & d);            k = 0x5A827999u; }
            else if (i < 40) { f = b ^ c ^ d;                        k = 0x6ED9EBA1u; }
            else if (i < 60) { f = (b & c) | (b & d) | (c & d);      k = 0x8F1BBCDCu; }
            else             { f = b ^ c ^ d;                        k = 0xCA62C1D6u; }

            const juce::uint32 temp = rol (a, 5) + f + e + k + w[i];
            e = d; d = c; c = rol (b, 30); b = a; a = temp;
        }
        h[0] += a; h[1] += b; h[2] += c; h[3] += d; h[4] += e;
    }

    void update (const void* dataIn, size_t len)
    {
        const auto* p = static_cast<const juce::uint8*> (dataIn);
        total += len;
        while (len > 0)
        {
            const size_t take = juce::jmin (len, size_t (64) - blockLen);
            memcpy (block + blockLen, p, take);
            blockLen += take;
            p += take;
            len -= take;
            if (blockLen == 64) { processBlock (block); blockLen = 0; }
        }
    }

    void finish (juce::uint8 out[20])
    {
        const juce::uint64 bits = total * 8;
        const juce::uint8 one = 0x80;
        update (&one, 1);
        const juce::uint8 zero = 0;
        while (blockLen != 56) update (&zero, 1);
        juce::uint8 lenBytes[8];
        for (int i = 0; i < 8; ++i) lenBytes[i] = (juce::uint8) (bits >> (56 - i * 8));
        update (lenBytes, 8);
        for (int i = 0; i < 5; ++i)
        {
            out[i * 4]     = (juce::uint8) (h[i] >> 24);
            out[i * 4 + 1] = (juce::uint8) (h[i] >> 16);
            out[i * 4 + 2] = (juce::uint8) (h[i] >> 8);
            out[i * 4 + 3] = (juce::uint8) (h[i]);
        }
    }
};

juce::String headerValue (const juce::String& request, const juce::String& name)
{
    const auto lines = juce::StringArray::fromLines (request);
    for (const auto& line : lines)
    {
        const int colon = line.indexOfChar (':');
        if (colon <= 0) continue;
        if (line.substring (0, colon).trim().equalsIgnoreCase (name))
            return line.substring (colon + 1).trim();
    }
    return {};
}

} // namespace

// ===========================================================================
//  Server
// ===========================================================================

WebSocketServer::WebSocketServer() : juce::Thread ("beacon-bridge-accept") {}

WebSocketServer::~WebSocketServer() { stop(); }

bool WebSocketServer::start (Options options)
{
    stop();
    opts = std::move (options);

    listener = std::make_unique<juce::StreamingSocket>();
    // Loopback only. Binding to 0.0.0.0 would put a plug-in host on the network.
    if (! listener->createListener (opts.port, "127.0.0.1"))
    {
        listener.reset();
        return false;
    }

    startThread();
    return true;
}

void WebSocketServer::stop()
{
    signalThreadShouldExit();
    if (listener) listener->close();
    stopThread (2000);
    listener.reset();

    std::vector<std::shared_ptr<WebSocketConnection>> toClose;
    {
        const juce::ScopedLock sl (lock);
        toClose.swap (connections);
    }
    for (auto& c : toClose) c->close();
}

int WebSocketServer::getConnectionCount() const
{
    const juce::ScopedLock sl (lock);
    int n = 0;
    for (const auto& c : connections) if (c->isOpen()) ++n;
    return n;
}

void WebSocketServer::reap()
{
    const juce::ScopedLock sl (lock);
    connections.erase (
        std::remove_if (connections.begin(), connections.end(),
                        [] (const std::shared_ptr<WebSocketConnection>& c) { return ! c->isOpen(); }),
        connections.end());
}

void WebSocketServer::run()
{
    while (! threadShouldExit())
    {
        if (! listener) break;

        std::unique_ptr<juce::StreamingSocket> accepted (listener->waitForNextConnection());
        if (threadShouldExit()) break;
        if (accepted == nullptr) continue;

        reap();

        auto connection = std::make_shared<WebSocketConnection> (std::move (accepted), opts, *this);
        {
            const juce::ScopedLock sl (lock);
            connections.push_back (connection);
        }
        connection->begin();
    }
}

// ===========================================================================
//  Connection
// ===========================================================================

WebSocketConnection::WebSocketConnection (std::unique_ptr<juce::StreamingSocket> s,
                                          const WebSocketServer::Options& options,
                                          WebSocketServer& owner)
    : juce::Thread ("beacon-bridge-conn"),
      socket (std::move (s)),
      opts (options),
      server (owner)
{
}

WebSocketConnection::~WebSocketConnection()
{
    close();
    stopThread (1500);
}

void WebSocketConnection::begin() { startThread(); }

/** shared_from_this() throws if the object is not owned by a shared_ptr, which
    is true only while it is being destroyed. Returning null there is safer than
    letting a late callback resurrect a dying connection. */
std::shared_ptr<WebSocketConnection> WebSocketConnection::weakSelf()
{
    try { return shared_from_this(); }
    catch (const std::bad_weak_ptr&) { return nullptr; }
}

void WebSocketConnection::close()
{
    if (open.exchange (false))
    {
        if (server.onClose) server.onClose (weakSelf());
    }
    signalThreadShouldExit();
    if (socket) socket->close();
}

bool WebSocketConnection::readExactly (void* dest, int numBytes)
{
    auto* p = static_cast<char*> (dest);
    int got = 0;
    while (got < numBytes)
    {
        if (threadShouldExit() || socket == nullptr) return false;
        // Blocking. A non-blocking read returns 0 when nothing has ARRIVED YET,
        // which is not the same as end of stream — treating it as one closes
        // the connection the instant the client is a millisecond slow.
        const int n = socket->read (p + got, numBytes - got, true);
        if (n <= 0) return false;
        got += n;
    }
    return true;
}

bool WebSocketConnection::performHandshake()
{
    // Read headers up to the blank line. Bounded, so a client that never sends
    // one cannot make us allocate forever.
    juce::String request;
    char c = 0;
    while (! request.endsWith ("\r\n\r\n"))
    {
        if (request.length() > 16384) return false;
        const int n = socket->read (&c, 1, true);
        if (n <= 0) return false;
        request += juce::String::charToString ((juce::juce_wchar) (juce::uint8) c);
    }

    const auto key = headerValue (request, "Sec-WebSocket-Key");
    if (key.isEmpty()) return false;

    origin = headerValue (request, "Origin");

    // ---- authorisation
    bool allowed = false;
    if (origin.isNotEmpty())
    {
        // A browser cannot lie about Origin, so the allowlist is the real gate.
        allowed = opts.allowedOrigins.contains (origin);
    }
    else if (opts.allowMissingOrigin)
    {
        // Not a browser (the desktop app). Require the token instead.
        const auto path = request.upToFirstOccurrenceOf ("\r\n", false, false);
        allowed = opts.token.isEmpty() || path.contains ("token=" + opts.token);
    }

    if (! allowed)
    {
        const juce::String deny =
            "HTTP/1.1 403 Forbidden\r\n"
            "Content-Length: 0\r\n"
            "Connection: close\r\n\r\n";
        socket->write (deny.toRawUTF8(), (int) deny.getNumBytesAsUTF8());
        return false;
    }

    // ---- accept
    const juce::String magic = key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
    Sha1 sha;
    sha.update (magic.toRawUTF8(), magic.getNumBytesAsUTF8());
    juce::uint8 digest[20];
    sha.finish (digest);

    const auto accept = juce::Base64::toBase64 (digest, sizeof (digest));

    const juce::String response =
        "HTTP/1.1 101 Switching Protocols\r\n"
        "Upgrade: websocket\r\n"
        "Connection: Upgrade\r\n"
        "Sec-WebSocket-Accept: " + accept + "\r\n\r\n";

    return socket->write (response.toRawUTF8(), (int) response.getNumBytesAsUTF8())
             == (int) response.getNumBytesAsUTF8();
}

bool WebSocketConnection::readFrame (WsMessage& out, bool& isClose)
{
    isClose = false;

    juce::uint8 header[2];
    if (! readExactly (header, 2)) return false;

    const bool fin = (header[0] & 0x80) != 0;
    const juce::uint8 opcode = header[0] & 0x0f;
    const bool masked = (header[1] & 0x80) != 0;
    juce::uint64 length = header[1] & 0x7f;

    if (length == 126)
    {
        juce::uint8 ext[2];
        if (! readExactly (ext, 2)) return false;
        length = ((juce::uint64) ext[0] << 8) | ext[1];
    }
    else if (length == 127)
    {
        juce::uint8 ext[8];
        if (! readExactly (ext, 8)) return false;
        length = 0;
        for (int i = 0; i < 8; ++i) length = (length << 8) | ext[i];
    }

    // A client frame must be masked, and must not be absurd.
    if (! masked) return false;
    if (length > 64u * 1024u * 1024u) return false;

    juce::uint8 mask[4];
    if (! readExactly (mask, 4)) return false;

    juce::MemoryBlock payload ((size_t) length);
    if (length > 0 && ! readExactly (payload.getData(), (int) length)) return false;

    auto* bytes = static_cast<juce::uint8*> (payload.getData());
    for (juce::uint64 i = 0; i < length; ++i) bytes[i] ^= mask[i & 3];

    switch (opcode)
    {
        case 0x8:  isClose = true; return true;
        case 0x9:  return writeFrame (0xA, payload.getData(), (size_t) length);  // ping -> pong
        case 0xA:  return true;                                                   // pong
        case 0x1:
            out.isBinary = false;
            out.text = juce::String::fromUTF8 (static_cast<const char*> (payload.getData()), (int) length);
            return fin;
        case 0x2:
            out.isBinary = true;
            out.data = payload;
            return fin;
        default:
            return true;   // ignore continuation and reserved opcodes
    }
}

bool WebSocketConnection::writeFrame (juce::uint8 opcode, const void* data, size_t bytes)
{
    if (socket == nullptr) return false;

    juce::MemoryBlock frame;
    juce::uint8 header[10];
    size_t headerLen = 2;

    header[0] = (juce::uint8) (0x80 | opcode);

    if (bytes < 126)
    {
        header[1] = (juce::uint8) bytes;
    }
    else if (bytes <= 0xffff)
    {
        header[1] = 126;
        header[2] = (juce::uint8) (bytes >> 8);
        header[3] = (juce::uint8) bytes;
        headerLen = 4;
    }
    else
    {
        header[1] = 127;
        for (int i = 0; i < 8; ++i) header[2 + i] = (juce::uint8) (bytes >> (56 - i * 8));
        headerLen = 10;
    }

    const juce::ScopedLock sl (writeLock);
    if (socket->write (header, (int) headerLen) != (int) headerLen) return false;
    if (bytes == 0) return true;
    return socket->write (data, (int) bytes) == (int) bytes;
}

bool WebSocketConnection::sendText (const juce::String& text)
{
    if (! open.load()) return false;
    return writeFrame (0x1, text.toRawUTF8(), text.getNumBytesAsUTF8());
}

bool WebSocketConnection::sendBinary (const void* data, size_t bytes)
{
    if (! open.load()) return false;
    return writeFrame (0x2, data, bytes);
}

void WebSocketConnection::run()
{
    if (! performHandshake())
    {
        if (socket) socket->close();
        open.store (false);
        return;
    }

    open.store (true);
    if (server.onOpen) server.onOpen (weakSelf());

    while (! threadShouldExit())
    {
        WsMessage msg;
        bool isClose = false;
        if (! readFrame (msg, isClose) || isClose) break;

        if (msg.text.isNotEmpty() || msg.isBinary)
        {
            if (server.onMessage) server.onMessage (weakSelf(), msg);
        }
    }

    close();
}

} // namespace beacon
