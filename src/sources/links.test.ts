import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchVideoLink, MAX_REMOTE_BYTES, parseVideoLink } from "./links";
import { clampRect } from "./capture";
afterEach(() => vi.unstubAllGlobals());
describe("video-link normalization", () => {
  it.each([
    "https://www.youtube.com/watch?v=M7lc1UVf-VE",
    "https://youtu.be/M7lc1UVf-VE?si=tracking",
    "https://www.youtube.com/shorts/M7lc1UVf-VE",
    "https://m.youtube.com/watch?v=M7lc1UVf-VE",
  ])("recognizes YouTube / Shorts: %s", (url) => {
    const link = parseVideoLink(url);
    expect(link.kind).toBe("youtube");
    expect(link.id).toBe("M7lc1UVf-VE");
    expect(link.url).not.toContain("tracking");
  });
  it("recognizes Reel links without login scraping", () => {
    const link = parseVideoLink("https://www.instagram.com/reel/AbCdEF123_-/");
    expect(link.kind).toBe("instagram");
    expect(link.embed).toBe(
      "https://www.instagram.com/reel/AbCdEF123_-/embed/",
    );
  });
  it("preserves a YouTube share timestamp", () => {
    const link = parseVideoLink("https://youtu.be/M7lc1UVf-VE?t=1m30s");
    expect(link.embed).toContain("start=90");
    expect(link.url).toContain("t=90");
  });
  it("accepts Instagram shared Reel redirects for native tab capture", () => {
    const link = parseVideoLink(
      "https://www.instagram.com/share/reel/ABCdef_123/?igsh=tracking",
    );
    expect(link.kind).toBe("instagram");
    expect(link.embed).toBeUndefined();
    expect(link.url).not.toContain("tracking");
  });
  it("keeps signed direct-media queries for fetching", () =>
    expect(
      parseVideoLink("https://media.example/a.mp4?token=abc").url,
    ).toContain("token=abc"));
  it.each([
    "javascript:alert(1)",
    "file:///tmp/a.mp4",
    "https://user:secret@example.com/a.mp4",
    "https://youtube.com/playlist?list=x",
    "https://www.instagram.com/someuser/",
  ])("rejects unsupported input: %s", (url) =>
    expect(() => parseVideoLink(url)).toThrow(),
  );
  it("does not mistake a look-alike host for YouTube", () =>
    expect(
      parseVideoLink("https://youtube.com.evil.example/watch?v=M7lc1UVf-VE")
        .kind,
    ).toBe("direct"));
});
describe("bounded direct-media import", () => {
  it("fetches actual bytes with CORS and without account cookies", async () => {
    const fetch = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "content-type": "video/mp4", "content-length": "3" },
      }),
    );
    vi.stubGlobal("fetch", fetch);
    const events: number[] = [];
    const file = await fetchVideoLink(
      parseVideoLink("https://media.example/dance.mp4"),
      new AbortController().signal,
      (n) => events.push(n),
    );
    expect(file.name).toBe("dance.mp4");
    expect(file.size).toBe(3);
    expect(events).toEqual([3]);
    expect(fetch.mock.calls[0][1]).toMatchObject({
      mode: "cors",
      credentials: "omit",
    });
  });
  it("rejects HTML pages instead of treating embeds as media", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response("<html/>", { headers: { "content-type": "text/html" } }),
        ),
    );
    await expect(
      fetchVideoLink(
        parseVideoLink("https://example.com/page"),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("웹페이지");
  });
  it("rejects declared oversized files before reading", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("", {
          headers: {
            "content-type": "video/mp4",
            "content-length": String(MAX_REMOTE_BYTES + 1),
          },
        }),
      ),
    );
    await expect(
      fetchVideoLink(
        parseVideoLink("https://example.com/a.mp4"),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("200MB");
  });
  it("never scrapes platform pages through the direct-media path", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchVideoLink(
        parseVideoLink("https://youtu.be/M7lc1UVf-VE"),
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow("탭 공유");
    expect(fetch).not.toHaveBeenCalled();
  });
});
describe("capture crop bounds", () => {
  it("bounds the crop to the chosen capture surface", () =>
    expect(clampRect({ x: 0.8, y: 0.9, width: 0.8, height: 0.5 })).toEqual({
      x: 0.8,
      y: 0.9,
      width: 1 - 0.8,
      height: 1 - 0.9,
    }));
  it("rejects negative dimensions by clamping to zero", () =>
    expect(clampRect({ x: -1, y: 0, width: -0.1, height: 1 }).width).toBe(0));
});
