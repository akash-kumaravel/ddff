# Recordly Web

This folder contains a browser-based companion for the Recordly desktop app. Start it from the repository root with `npm run dev:web`.

The browser version supports screen/window capture through `getDisplayMedia`, optional microphone and browser-provided system audio, local video import, a persistent IndexedDB library, playback, basic in/out trimming, and WebM download. It requires a secure context (`localhost` or HTTPS) and a browser that supports screen capture and `MediaRecorder`.

This is not a feature-complete port of the desktop application. Native cursor telemetry and overlays, advanced timeline effects, captions, project-file compatibility, cloud sharing, and the desktop MP4/native export pipeline require Electron or server/native services and are not available here. Browser support for system audio and trimmed video capture varies by browser.