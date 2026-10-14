import { describe, expect, it } from "vitest";
import { externalSubtitlesOf, resolutionOf, streamUrl, streamsOf, subtitlesFor, type JfSource } from "./sources";
import { BASE, EP3, FIX } from "./fixture";

/** The real answer for the 600s episode with its external subtitle, as the
 * server sent it: with `Path` and a `DeliveryUrl` that carries a token. */
const raw = FIX.playbackInfo[EP3].MediaSources[0];

describe("a source's stream URL", () => {
  it("is the direct stream by the source id and its tag, with no credential", () => {
    const u = streamUrl(BASE, EP3, raw)!;
    expect(u).toBe(`${BASE}/Videos/${EP3}/stream?static=true&mediaSourceId=${raw.Id}&tag=${raw.ETag}`);
    expect(u.toLowerCase()).not.toMatch(/api_?key|token/);
  });
  it("drops a trailing slash on the address and an absent tag", () => {
    expect(streamUrl(`${BASE}//`, EP3, { Id: raw.Id })).toBe(`${BASE}/Videos/${EP3}/stream?static=true&mediaSourceId=${raw.Id}`);
  });
  it("is null for an id that is not one, or a remote source", () => {
    expect(streamUrl(BASE, "../x", raw)).toBeNull();
    expect(streamUrl(BASE, EP3, { ...raw, Id: "nope" })).toBeNull();
    expect(streamUrl(BASE, EP3, { ...raw, Id: undefined })).toBeNull();
    expect(streamUrl(BASE, EP3, { ...raw, IsRemote: true })).toBeNull();
  });
});

describe("resolution", () => {
  const src = (w: number, h: number): JfSource => ({ MediaStreams: [{ Type: "Video", Width: w, Height: h }] });
  it("reads the usual bands, a wide crop included", () => {
    expect(resolutionOf(src(1280, 720))).toBe("720p");
    expect(resolutionOf(src(1920, 1080))).toBe("1080p");
    expect(resolutionOf(src(1920, 800))).toBe("1080p");
    expect(resolutionOf(src(3840, 2160))).toBe("2160p");
    expect(resolutionOf(src(3840, 1600))).toBe("2160p");
    expect(resolutionOf(src(2560, 1440))).toBe("1440p");
    expect(resolutionOf(src(720, 480))).toBe("480p");
    expect(resolutionOf(src(320, 240))).toBe("240p");
  });
  it("is undefined with no picture", () => {
    expect(resolutionOf({ MediaStreams: [{ Type: "Audio" }] })).toBeUndefined();
    expect(resolutionOf({})).toBeUndefined();
  });
});

describe("streams", () => {
  const [s] = streamsOf(BASE, EP3, [raw]);

  it("carry the quality as the name, and lines the source row shows", () => {
    expect(s.name).toBe("720p");
    expect(s.description?.split("\n")).toEqual(["Severance S01E03", "720p · H264", "AAC · mono", "MKV · 13 MB"]);
  });

  it("are the user's own file and there already, so auto-play may take it", () => {
    expect(s.streamData).toEqual({ type: "jellyfin", service: { id: "jellyfin", cached: true } });
    expect(s.behaviorHints).toMatchObject({
      bingeGroup: "jellyfin|720p|H264",
      filename: "Severance S01E03.mkv",
      videoSize: 13053643,
    });
  });

  it("never carry the file's path or the server's own subtitle URL, which holds the token", () => {
    expect(JSON.stringify(raw)).toMatch(/ApiKey=/);
    const out = JSON.stringify(streamsOf(BASE, EP3, [raw]));
    expect(out).not.toMatch(/ApiKey|C:\\|jf-test|DeliveryUrl|Path/);
  });

  it("keep the server's order and skip a source it cannot play", () => {
    const b = { ...raw, Id: "b".repeat(32), Name: "Second" };
    const list = streamsOf(BASE, EP3, [raw, { ...raw, IsRemote: true }, b]);
    expect(list.map((x) => x.url?.match(/mediaSourceId=(\w+)/)?.[1])).toEqual([raw.Id, b.Id]);
  });

  it("an empty list is empty", () => {
    expect(streamsOf(BASE, EP3, [])).toEqual([]);
  });

  it("with no picture falls back to the server's name and an unknown group", () => {
    const [n] = streamsOf(BASE, EP3, [{ Id: raw.Id, Container: "mp4" }]);
    expect(n.name).toBe("Jellyfin");
    expect(n.behaviorHints?.bingeGroup).toBe("jellyfin|unknown|unknown");
    expect(n.description).toBe("MP4");
  });

  it("names HDR and bit depth when there is any", () => {
    const hdr: JfSource = {
      ...raw,
      MediaStreams: [{ Type: "Video", Codec: "hevc", Width: 3840, Height: 2160, VideoRange: "HDR", BitDepth: 10 }],
    };
    expect(streamsOf(BASE, EP3, [hdr])[0].description?.split("\n")[1]).toBe("2160p · HEVC · HDR · 10-bit");
  });
});

describe("external subtitles", () => {
  it("are a token-free URL built from the stream's index", () => {
    expect(externalSubtitlesOf(BASE, EP3, raw)).toEqual([
      {
        index: 0,
        url: `${BASE}/Videos/${EP3}/${raw.Id}/Subtitles/0/Stream.srt`,
        language: "eng",
        title: "English - SUBRIP - External",
        isDefault: false,
        isForced: false,
      },
    ]);
  });

  it("leave out an embedded subtitle and an image one", () => {
    const s: JfSource = {
      Id: raw.Id,
      MediaStreams: [
        { Type: "Subtitle", Index: 3, IsExternal: false, IsTextSubtitleStream: true },
        { Type: "Subtitle", Index: 4, IsExternal: true, IsTextSubtitleStream: false, Codec: "PGSSUB" },
        { Type: "Subtitle", Index: 5, IsExternal: true, IsTextSubtitleStream: true, IsDefault: true, IsForced: true },
        { Type: "Subtitle", Index: -1, IsExternal: true, IsTextSubtitleStream: true },
        { Type: "Video", Index: 1 },
      ],
    };
    expect(externalSubtitlesOf(BASE, EP3, s).map((x) => [x.index, x.title, x.isDefault, x.isForced])).toEqual([
      [5, "Subtitles", true, true],
    ]);
  });

  it("are none for an id that is not one", () => {
    expect(externalSubtitlesOf(BASE, "x", raw)).toEqual([]);
    expect(externalSubtitlesOf(BASE, EP3, { ...raw, Id: "x" })).toEqual([]);
  });
});

describe("what native is told about subtitles", () => {
  it("is each source's stream and its external text subtitles by index, with no address of their own", () => {
    expect(subtitlesFor(BASE, EP3, [raw])).toEqual([
      {
        streamUrl: streamUrl(BASE, EP3, raw),
        subtitles: [{ index: 0, title: "English - SUBRIP - External", language: "eng" }],
      },
    ]);
  });

  it("lists a source with no subtitles too, so it clears what it had, and skips one with no stream", () => {
    const bare: JfSource = { Id: raw.Id, MediaStreams: [{ Type: "Video", Index: 0 }] };
    expect(subtitlesFor(BASE, EP3, [bare])).toEqual([{ streamUrl: streamUrl(BASE, EP3, bare), subtitles: [] }]);
    expect(subtitlesFor(BASE, EP3, [{ ...raw, IsRemote: true }, { ...raw, Id: "x" }])).toEqual([]);
  });

  it("leaves out an embedded, an image and a negative one, as the player's list does", () => {
    const s: JfSource = {
      Id: raw.Id,
      MediaStreams: [
        { Type: "Subtitle", Index: 3, IsExternal: false, IsTextSubtitleStream: true },
        { Type: "Subtitle", Index: 4, IsExternal: true, IsTextSubtitleStream: false },
        { Type: "Subtitle", Index: 6, IsExternal: true, IsTextSubtitleStream: true, Language: "fra", DisplayTitle: "Français" },
      ],
    };
    expect(subtitlesFor(BASE, EP3, [s])[0].subtitles).toEqual([{ index: 6, title: "Français", language: "fra" }]);
  });
});
