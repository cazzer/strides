/// <reference types="node" />
// This app's src tree is otherwise browser-only (tsconfig.app.json's `types` is deliberately
// just `vite/client`, no `node`) -- this is the first test to need real filesystem access
// (reading a demo clip's actual bytes off disk, see the doc comment below), so it opts into
// Node's ambient types locally rather than widening every file under src to see them.
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Mp4DemuxError, demuxMp4 } from './mp4Demux'

/**
 * Real bytes off disk, not a synthetic/mocked container — this repo's CLAUDE.md precedent for
 * exercising the demux boundary against ground truth rather than a hand-built fixture that might
 * not match what a real encoder/muxer actually produces. `park-approach.mp4` is the only demo
 * clip checked into the repo (the other demo button fetches a remote Pexels URL at runtime, see
 * `DemoVideoButton.tsx`), so it's the only one available for an offline, network-free unit test.
 *
 * Resolved off `process.cwd()`, not `import.meta.url` — under vitest's `jsdom` environment,
 * `import.meta.url` resolves to a simulated `http://localhost` document URL, not a real `file://`
 * URL, so `fileURLToPath` throws on it (`TypeError: The URL must be of scheme file`). Vitest
 * always runs with cwd at the project root.
 */
const PARK_APPROACH_PATH = join(process.cwd(), 'src/video/demo-clips/park-approach.mp4')

function readAsArrayBuffer(path: string): ArrayBuffer {
  const buffer = readFileSync(path)
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  ) as ArrayBuffer
}

describe('demuxMp4', () => {
  it('parses the park-approach demo clip: codec, dimensions, fps, duration, sample count', async () => {
    const bytes = readAsArrayBuffer(PARK_APPROACH_PATH)

    const track = await demuxMp4(bytes)

    // Snapshot of ground-truth values measured directly against this file via a real mp4box.js
    // parse (see the implementation notes) — pins this test to the actual checked-in clip, not
    // an assumption about it.
    expect(track.codec).toBe('avc1.640034')
    expect(track.width).toBe(2160)
    expect(track.height).toBe(3840)
    expect(track.samples).toHaveLength(99)
    expect(track.durationSec).toBeCloseTo(1.65165, 4)
    // ~59.94fps (99 samples / 1.65165s) -- this is the 60fps clip CLAUDE.md's live-verification
    // notes refer to.
    expect(track.fps).toBeGreaterThan(59)
    expect(track.fps).toBeLessThan(61)
  })

  it('extracts a non-empty avcC description with the 8-byte box header stripped', async () => {
    const bytes = readAsArrayBuffer(PARK_APPROACH_PATH)

    const track = await demuxMp4(bytes)

    expect(track.description).toBeInstanceOf(Uint8Array)
    // A raw avcC payload starts with configurationVersion (0x01), never the box size/fourcc
    // bytes an un-stripped box would start with.
    expect(track.description?.[0]).toBe(0x01)
    expect(track.description!.length).toBeGreaterThan(0)
  })

  it('returns samples in decode order (dts-ascending), not presentation order', async () => {
    const bytes = readAsArrayBuffer(PARK_APPROACH_PATH)

    const track = await demuxMp4(bytes)

    // This clip has B-frames (confirmed via a real mp4box.js parse): ptsSec is NOT monotonic
    // sample-to-sample, which is exactly why decode order (what VideoDecoder.decode() requires)
    // and presentation order (what the fitted amplitude/heuristics pipeline downstream wants)
    // are different orderings of the same array.
    const ptsValues = track.samples.map((s) => s.ptsSec)
    const isMonotonic = ptsValues.every((v, i) => i === 0 || v >= ptsValues[i - 1])
    expect(isMonotonic).toBe(false)
  })

  it('marks exactly the sample(s) mp4box reports as sync samples as keyframes', async () => {
    const bytes = readAsArrayBuffer(PARK_APPROACH_PATH)

    const track = await demuxMp4(bytes)

    const keyframeCount = track.samples.filter((s) => s.isKeyframe).length
    // This short, single-GOP clip has exactly one sync sample (measured directly).
    expect(keyframeCount).toBe(1)
    expect(track.samples[0].isKeyframe).toBe(true)
  })

  it('every sample carries non-empty data and a positive duration', async () => {
    const bytes = readAsArrayBuffer(PARK_APPROACH_PATH)

    const track = await demuxMp4(bytes)

    for (const sample of track.samples) {
      expect(sample.data.byteLength).toBeGreaterThan(0)
      expect(sample.durationSec).toBeGreaterThan(0)
    }
  })

  it('rejects with Mp4DemuxError on a non-MP4 buffer (e.g. WebM/EBML magic bytes)', async () => {
    // WebcamCapture records WebM (see webCodecsSupport.ts's design notes) -- this is the exact
    // shape of input that feasibility probe needs to reject rather than hang on.
    const webmMagic = new Uint8Array([
      0x1a, 0x45, 0xdf, 0xa3, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
    ]).buffer

    await expect(demuxMp4(webmMagic)).rejects.toThrow(Mp4DemuxError)
  })

  it('rejects rather than hanging on an empty buffer', async () => {
    await expect(demuxMp4(new ArrayBuffer(0))).rejects.toThrow(Mp4DemuxError)
  })

  it('rejects rather than hanging on a truncated file with no moov box', async () => {
    // A bare, complete ftyp box with nothing after it -- well-formed enough that mp4box.js
    // doesn't call onError, but there is no moov box to ever complete parsing with, so
    // onReady never fires either. This is the "neither callback ever fires" case the
    // implementation's trailing explicit reject exists for.
    // Box layout: size(4)='0x14' + 'ftyp' + major_brand='isom' + minor_version(4)=0 + compatible_brands='isom'
    const ftypOnly = new Uint8Array([
      0x00, 0x00, 0x00, 0x14, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x00,
      0x00, 0x69, 0x73, 0x6f, 0x6d,
    ]).buffer

    await expect(demuxMp4(ftypOnly)).rejects.toThrow(Mp4DemuxError)
  })

  it('rejects (rather than throwing uncaught) when the stsd sample entry is unparseable', async () => {
    // mp4box.js classifies a track as video by the *type* of its stsd sample-entry box (an
    // `instanceof VisualSampleEntry` check on the parsed box, not the hdlr box's handler_type
    // field — confirmed by reading mp4box.js's own isofile.ts) — so the realistic way this
    // clip's video track goes missing is its 'avc1' sample-entry fourcc becoming unrecognized.
    // Corrupting it doesn't produce a clean "no video track" outcome, though: mp4box.js itself
    // throws an uncaught TypeError from inside its own getInfo() (it assumes a sample_desc box it
    // no longer has). This test's real assertion is that `demuxMp4`'s try/catch around
    // `appendBuffer` converts that throw into a rejected `Mp4DemuxError` instead of propagating
    // an uncaught exception to the caller — the same "never hang, never throw uncaught" contract
    // as the other malformed-input cases above, just reached via a different mp4box.js failure
    // mode (a synchronous throw instead of onError/silence).
    const bytes = readAsArrayBuffer(PARK_APPROACH_PATH)
    const view = new Uint8Array(bytes)
    // Locating the 'stsd' box specifically (not a bare 'avc1' scan) matters: the multi-megabyte
    // compressed mdat bitstream that dominates this file could in principle contain an incidental
    // 4-byte match unrelated to the real sample-entry fourcc.
    const stsdFourcc = [0x73, 0x74, 0x73, 0x64] // 'stsd'
    let stsdIndex = -1
    for (let i = 0; i < view.length - stsdFourcc.length; i += 1) {
      if (stsdFourcc.every((b, j) => view[i + j] === b)) {
        stsdIndex = i
        break
      }
    }
    expect(stsdIndex).toBeGreaterThan(-1)
    // stsd layout: 'stsd'(4) + version/flags(4) + entry_count(4) + [entry: size(4) + fourcc(4)]
    const entryFourccIndex = stsdIndex + 16
    expect(String.fromCharCode(...view.slice(entryFourccIndex, entryFourccIndex + 4))).toBe(
      'avc1',
    )
    const corrupted = view.slice()
    corrupted[entryFourccIndex] = 0x00 // 'avc1' -> '\0vc1', not a registered sample-entry box

    await expect(demuxMp4(corrupted.buffer as ArrayBuffer)).rejects.toThrow(Mp4DemuxError)
  })
})
