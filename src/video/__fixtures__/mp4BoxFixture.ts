import { BoxParser, DataStream, Endianness } from 'mp4box'

/**
 * Hand-builds a minimal, syntactically valid MP4 (`ArrayBuffer`) using `mp4box`'s OWN box
 * classes -- `ftyp` + `moov(mvhd, trak(tkhd, [edts(elst)], mdia(mdhd, hdlr, minf(stbl(stsd(avc1),
 * stts)))))` -- with no `mdat`/actual sample data, and no `vmhd`/`dinf`/`stco`/`stsz`/`stsc`.
 * Those are required by the ISO/IEC 14496-12 spec for a conformant file, but NOT by `mp4box`'s own
 * parser to reach `onReady` and populate the `stts`/`edts.elst` fields `containerTiming.ts`
 * reads -- verified empirically against this exact minimal box set before committing to it here
 * (a fuller box tree would parse identically for this module's purposes, just with more
 * boilerplate that has nothing to do with what these tests are checking).
 *
 * This is the "mp4box.js-written... fixture" option from the spike's plan, chosen over
 * hand-rolled raw bytes (tedious and easy to get subtly wrong at the box-size-field level) and
 * over ffmpeg-generated real files (this spike found ffmpeg's only available retiming tool,
 * `-itsscale`, does not produce the elst-stretches-while-stts-stays-native shape this predicate
 * targets -- see `containerTiming.ts`'s and `slowMotionDetection.ts`'s module docs). Every field
 * this repo's fixtures don't set falls back to mp4box's own box-class defaults.
 */
export interface Mp4FixtureElst {
  segmentDuration: number
  mediaTime: number
  mediaRateInteger: number
  mediaRateFraction: number
}

export interface Mp4FixtureOptions {
  /** Movie (`mvhd`) timescale, Hz. */
  movieTimescaleHz: number
  /** Movie (`mvhd`/`tkhd`) duration, in `movieTimescaleHz` ticks. */
  movieDurationTicks: number
  /** Track (`mdia/mdhd`) timescale, Hz -- what `stts` deltas and `elst.mediaTime` are in. */
  mediaTimescaleHz: number
  /** `stts` run-length table as `[sampleCount, sampleDelta]` pairs, `sampleDelta` in
   * `mediaTimescaleHz` ticks. Mirrors the real box's own (count, delta) run-length encoding. */
  sttsRuns: Array<[sampleCount: number, sampleDelta: number]>
  /** Omit entirely for a "no edit list" fixture; an empty array is NOT the same thing as
   * omitting this -- both are supported since `containerTiming.ts` treats "no elst box" and "an
   * elst box with zero entries" as equivalent (empty `elst: []` either way), but only omission
   * here skips writing the `edts` box at all, which is the more realistic no-elst shape. */
  elst?: Mp4FixtureElst[]
  trackId?: number
  width?: number
  height?: number
}

function identityMatrix(): [number, number, number, number, number, number, number, number, number] {
  return [0x00010000, 0, 0, 0, 0x00010000, 0, 0, 0, 0x40000000]
}

export function buildMinimalMp4(options: Mp4FixtureOptions): ArrayBuffer {
  const trackId = options.trackId ?? 1
  const width = options.width ?? 640
  const height = options.height ?? 360

  const ftyp = new BoxParser.box.ftyp()
  ftyp.major_brand = 'isom'
  ftyp.minor_version = 0
  ftyp.compatible_brands = ['isom', 'iso2', 'mp41']

  const mvhd = new BoxParser.box.mvhd()
  mvhd.version = 0
  mvhd.flags = 0
  mvhd.creation_time = 0
  mvhd.modification_time = 0
  mvhd.timescale = options.movieTimescaleHz
  mvhd.duration = options.movieDurationTicks
  mvhd.rate = 1 << 16
  mvhd.volume = 1 << 8
  mvhd.matrix = identityMatrix()
  mvhd.next_track_id = trackId + 1

  const tkhd = new BoxParser.box.tkhd()
  tkhd.version = 0
  tkhd.flags = 3 // track enabled + in movie
  tkhd.creation_time = 0
  tkhd.modification_time = 0
  tkhd.track_id = trackId
  tkhd.duration = options.movieDurationTicks
  tkhd.layer = 0
  tkhd.alternate_group = 0
  tkhd.volume = 0
  tkhd.matrix = identityMatrix()
  tkhd.width = width << 16
  tkhd.height = height << 16

  const mdhd = new BoxParser.box.mdhd()
  mdhd.version = 0
  mdhd.flags = 0
  mdhd.creation_time = 0
  mdhd.modification_time = 0
  mdhd.timescale = options.mediaTimescaleHz
  mdhd.duration = options.sttsRuns.reduce((sum, [count, delta]) => sum + count * delta, 0)
  mdhd.language = 0x55c4 // 'und'

  const hdlr = new BoxParser.box.hdlr()
  hdlr.version = 0
  hdlr.flags = 0
  hdlr.handler = 'vide'
  hdlr.name = 'VideoHandler'

  const avc1 = new BoxParser.sampleEntry.avc1()
  avc1.data_reference_index = 1
  avc1.width = width
  avc1.height = height
  avc1.horizresolution = 0x00480000
  avc1.vertresolution = 0x00480000
  avc1.frame_count = 1
  avc1.compressorname = ''
  avc1.depth = 24
  avc1.boxes = []

  const stsd = new BoxParser.box.stsd()
  stsd.version = 0
  stsd.flags = 0
  stsd.entries = [avc1]

  const stts = new BoxParser.box.stts()
  stts.version = 0
  stts.flags = 0
  stts.sample_counts = options.sttsRuns.map(([count]) => count)
  stts.sample_deltas = options.sttsRuns.map(([, delta]) => delta)

  const stbl = new BoxParser.box.stbl()
  stbl.addBox(stsd)
  stbl.addBox(stts)

  const minf = new BoxParser.box.minf()
  minf.addBox(stbl)

  const mdia = new BoxParser.box.mdia()
  mdia.addBox(mdhd)
  mdia.addBox(hdlr)
  mdia.addBox(minf)

  const trak = new BoxParser.box.trak()
  trak.addBox(tkhd)

  if (options.elst && options.elst.length > 0) {
    const elst = new BoxParser.box.elst()
    elst.version = 0
    elst.flags = 0
    elst.entries = options.elst.map((entry) => ({
      segment_duration: entry.segmentDuration,
      media_time: entry.mediaTime,
      media_rate_integer: entry.mediaRateInteger,
      media_rate_fraction: entry.mediaRateFraction,
    }))
    const edts = new BoxParser.box.edts()
    edts.addBox(elst)
    trak.addBox(edts)
  }

  trak.addBox(mdia)

  const moov = new BoxParser.box.moov()
  moov.addBox(mvhd)
  moov.addBox(trak)

  const ds = new DataStream(undefined, 0, Endianness.BIG_ENDIAN)
  ftyp.write(ds)
  moov.write(ds)
  return ds.buffer
}
