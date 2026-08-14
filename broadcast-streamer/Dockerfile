# Lightning Bug 24/7 broadcast streamer. Base = Playwright's image (Chromium + all its OS deps,
# pinned so the npm `playwright` version matches the bundled browser). We add ffmpeg + Xvfb +
# PulseAudio so a headful Chromium can be screen+audio captured and pushed to RTMP.
FROM mcr.microsoft.com/playwright:v1.47.2-jammy

RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg xvfb x11-utils pulseaudio pulseaudio-utils fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY stream.mjs entrypoint.sh ./
RUN chmod +x entrypoint.sh \
    && mkdir -p /home/pwuser/.config/pulse /tmp/.X11-unix \
    && chown -R pwuser:pwuser /app /home/pwuser \
    && chmod 1777 /tmp/.X11-unix

# Non-root: keeps the Chromium sandbox on and PulseAudio in user mode.
USER pwuser
ENV HOME=/home/pwuser DISPLAY=:99

ENTRYPOINT ["./entrypoint.sh"]
