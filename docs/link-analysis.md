# Analysis from a link

FORM supports two genuine frame-acquisition routes. Both end in the same MediaPipe VIDEO inference, reconstruction, synchronization and practice tools. There is no server, downloader proxy, yt-dlp integration, page scraping, cookie harvesting or precomputed animation.

## Direct media URLs

A CORS-readable MP4 / WebM (or supported video response) is fetched in the browser and automatically analyzed. This works with permitted static media, a user's own CDN, or a signed media URL that explicitly allows cross-origin reading.

The importer uses HTTP(S), `mode: cors`, `credentials: omit`, a no-referrer request, a streaming 200MiB cap, cancellation, MIME validation and actual decoded-video inspection. HTML pages are rejected. Errors explain when to use tab capture. Redirects still follow the browser's normal CORS restrictions. File/JavaScript URLs and embedded credentials are rejected. Signed query parameters are used for the request but removed from persisted provenance.

## YouTube / Shorts / Instagram Reels

1. Open **링크로 분석**, paste the video link, select **연결**.
2. Use the official embed when available, or **원본 영상 탭 열기** to open the link and play it there. Private / login-dependent content may require login in the original tab. FORM does not obtain account credentials.
3. Select **영상 탭 공유**. The browser asks you to choose a different browser tab. Choose the tab actually playing the authorized video. A new native permission choice is required each time.
4. On the captured-tab preview, drag a rectangle around one dancer's entire body, or enter the region as percentages. Keep the original tab's zoom / layout / scroll fixed.
5. Play the desired segment, then select **이 영역 녹화 후 3D 분석**. Finish with **녹화 마치고 분석**, or let the two-minute limit stop it. Captured pixels are drawn into a bounded local canvas and recorded; tab audio is included only when the browser supplies it.
6. FORM fixes missing WebM duration metadata, imports the actual clip and automatically analyzes it. The final source video and 3D use that recorded clip as their common clock. The original platform timestamp is not claimed to be the recorded timeline. Stop playback in the original tab manually when finished. Use **탭 클립 저장** in the footer to retain the recorded video alongside an exported motion JSON; importing that clip again lets the JSON source fingerprint match.

An iframe alone does not expose pixels. This path uses the standard browser **Screen Capture API with an explicit native user grant**, not cross-origin DOM access or an access-control bypass. The URL records the user's reference; the app cannot verify that the selected capture tab has the same origin / video. The preview and crop make that choice visible to the user. FORM refuses full-screen / window captures when the browser identifies them; a browser-tab capture is expected. The app does not auto-select a tab or persist capture permission.

Official references: [getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia), [YouTube player](https://developers.google.com/youtube/iframe_api_reference).

## Platform and browser limits

- This is **not unattended arbitrary URL → download → 3D**. Social URLs require playback and a browser-selected capture grant. Capturing occurs in real time; inference follows recording. Direct readable media URLs can go straight to analysis without that recording step.
- Desktop Chrome / Edge over HTTPS (or localhost for development) are recommended for tab capture. Unsupported browsers and mobile devices receive an actionable message; direct media / local files remain available.
- Protected or blacked-out video, a denied capture prompt, a wrong tab or an incorrect crop can prevent tracking. There is no DRM / login / paywall bypass. Captured-source quality is bounded by viewport resolution, compression, dropped frames and the source video.
- YouTube embedding can be disabled by the owner. Instagram embedding / login availability can vary. Opening the permitted video in its original tab and explicitly sharing that tab avoids relying on embed pixel access.
- During capture, only the chosen rectangle is encoded into the resulting clip. The full shared tab is temporarily visible in the local selection preview. Frames, recordings and landmarks are not uploaded by FORM. Opening third-party embeds / original URLs still contacts those providers normally.
- Capture is bounded to 120 seconds, 150MiB of recorded chunks and a maximum 960px output dimension; direct URL files are bounded to 200MiB. Source streams and recorder tracks stop on finish, cancel, dialog close or unmount.
- The app ships no copyrighted music / choreography sample. Use media you are authorized to process.

## Provenance

`source.origin` is an optional v1 schema extension:

```ts
{ kind: 'direct-url' | 'tab-capture'; url: string; capturedAt?: string }
```

`tab-capture` explicitly denotes user-selected tab pixels. Its URL is a reference, not a verified assertion about the captured tab. `capturedAt` is an ISO capture completion timestamp. Older v1 files without this field remain supported.
