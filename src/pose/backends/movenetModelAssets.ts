/**
 * MoveNet's model weights, obtained through this app's own cache rather than by the pose-detection
 * library's URL fetch — a `tf.io.IOHandler` that assembles `ModelArtifacts` out of
 * `fetchModelAsset` calls, one per file.
 *
 * ## Why this exists at all
 *
 * `strides-utn.2` measured MoveNet at **14,522,593 body bytes fetched at app MOUNT**, before a
 * reader touches a clip — SinglePose Lightning 4,818,229 across 3 files, MultiPose Lightning
 * 9,697,908 across 4. MultiPose alone is larger than the 9.4 MB MediaPipe `.task`. A warm repeat
 * visit re-downloaded **all** of it: 0 of 7 files came from any cache. There are two independent
 * measured reasons, and **neither is fixable by any header or CDN change**:
 *
 * 1. the final response carries `cache-control: private, max-age=0`; and
 * 2. `https://tfhub.dev/...` 302s to `www.kaggle.com`, which 302s to a **per-request V4-signed**
 *    `storage.googleapis.com` URL whose `X-Goog-Date` and `X-Goog-Signature` differ on every single
 *    request — so the browser's URL-keyed HTTP cache has no entry to revalidate in the first place.
 *
 * That second fact is also the trap this module must not fall into. **A cache keyed on the fetched
 * or resolved URL would miss 100% of the time and silently do nothing** — the feature would appear
 * to work and every visitor would still pay 14.5 MB. `ModelAssetSpec` separates `id` (stable, the
 * key) from `url` (fetched, signed, redirecting), and this module supplies an `id` derived only
 * from the model's canonical TFHub path.
 *
 * ## Why an IOHandler is a supported input, not a hack
 *
 * `@tensorflow-models/pose-detection@2.1.3`'s `movenet/detector.js` sets `fromTFHub = false`
 * whenever `config.modelUrl` is not a string and hands the value straight to
 * `tfc.loadGraphModel`, whose `GraphModel.findIOHandler` treats anything with a `load` method as
 * the handler. `MoveNetModelConfig.modelUrl` is declared `string | io.IOHandler` in the package's
 * own types.
 *
 * ## Why the assembly is the library's own
 *
 * The URLs, the weight-spec flattening and the artifact object are all produced the way tfjs's own
 * `HTTPRequest` handler produces them — same `?tfjs-format=file` suffix, same
 * `io.getWeightSpecs`, same `io.getModelArtifactsForJSONSync`, same "one `ArrayBuffer` per shard,
 * in manifest order" shape that `loadWeightsAsArrayBuffer` returns. This is not politeness: the
 * acceptance gate for routing weights through a different loader is that **no analysis output
 * moves**, and the cheapest way to guarantee that is to hand `GraphModel.loadSync` a byte-for-byte
 * equivalent of what it would have received.
 */

import { io } from '@tensorflow/tfjs-core'
import { fetchModelAsset } from '../modelAssetCache'
import type { ModelAssetProgressListener } from '../modelAssetCache'

/**
 * The model URLs `@tensorflow-models/pose-detection` would have fetched, mirrored here because the
 * package does not export them from its public entry point (`dist/movenet/constants` is reachable
 * only as a deep import, and `movenet.ts` already mirrors that module's input resolutions for the
 * same reason).
 *
 * ⚠️ Mirroring means these can drift out of the package. `movenetModelAssets.test.ts` asserts each
 * one against the installed package's own constant, so a dependency upgrade that repoints a model
 * fails a test rather than silently keying the cache on a name the library no longer uses. That
 * assertion is this module's answer to `strides-8w2` — the version token is DERIVED from the URL
 * below (see `resolveMoveNetModelSource`), never hand-copied beside it, so there is no second
 * constant to forget.
 */
export const MOVENET_MODEL_URLS = {
  'singlepose-lightning':
    'https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4',
  'singlepose-thunder':
    'https://tfhub.dev/google/tfjs-model/movenet/singlepose/thunder/4',
  'multipose-lightning':
    'https://tfhub.dev/google/tfjs-model/movenet/multipose/lightning/1',
} as const

export type MoveNetModelKey = keyof typeof MOVENET_MODEL_URLS

/**
 * TFHub's own convention, reproduced from `tfjs-converter`'s `getTFHubUrl`/`parseUrl`: the model
 * lives at `<base>/model.json?tfjs-format=file`, and each weight shard the manifest names lives
 * beside it under the same prefix and the same query suffix.
 */
const MODEL_JSON_NAME = 'model.json'
const TFHUB_SEARCH_PARAM = '?tfjs-format=file'

/**
 * A model version token for a URL whose trailing segment is not a recognisable version.
 *
 * Never reached by the three constants above; it exists so an unexpected URL shape degrades to
 * "the whole URL is the identity" (still correct — a different URL is a different cache entry)
 * rather than throwing at app mount or, worse, silently sharing a key with another model.
 */
const UNVERSIONED_TOKEN = 'url'

/** Where one MoveNet model's files are fetched from, and what they are cached under. */
export interface MoveNetModelSource {
  /**
   * The version-FREE identity of this model, which every file's cache `id` is prefixed with.
   * Splitting the version out of the id (rather than leaving it in) is what makes a model bump an
   * EVICTION rather than an orphan: `fetchModelAsset` prunes other versions of the same id on a
   * miss, and it can only do that for keys that share an id.
   */
  assetIdPrefix: string
  /** The published model version — the TFHub URL's trailing segment, e.g. `'4'`. */
  version: string
  /** The URL tfjs itself would have fetched the manifest from. */
  modelJsonUrl: string
  /** The URL tfjs itself would have fetched a manifest-named weight shard from. */
  weightUrl: (manifestPath: string) => string
}

/**
 * Splits a TFHub model URL into the two things a cache key needs: a stable identity and a version
 * token. `https://tfhub.dev/google/tfjs-model/movenet/singlepose/lightning/4` becomes identity
 * `.../movenet/singlepose/lightning` at version `4`.
 */
export function resolveMoveNetModelSource(modelUrl: string): MoveNetModelSource {
  const trimmed = modelUrl.endsWith('/') ? modelUrl.slice(0, -1) : modelUrl

  // Split on the URL's PATH segments, not on the last `/` in the string: `https://example.test`
  // has a slash at index 7, and a naive `lastIndexOf` reads the host as a version and `https:/`
  // as the identity — which would collide every such URL onto one cache key.
  let assetIdPrefix = trimmed
  let version = UNVERSIONED_TOKEN
  try {
    const segments = new URL(trimmed).pathname.split('/').filter((part) => part.length > 0)
    const tail = segments.at(-1)
    if (segments.length >= 2 && tail !== undefined && /^[A-Za-z0-9._-]+$/.test(tail)) {
      version = tail
      assetIdPrefix = trimmed.slice(0, trimmed.length - tail.length - 1)
    }
  } catch {
    // Not an absolute URL. Keep the whole string as the identity: still correct (a different URL
    // is a different entry), it only forgoes evicting a superseded version.
  }

  return {
    assetIdPrefix,
    version,
    modelJsonUrl: `${trimmed}/${MODEL_JSON_NAME}${TFHUB_SEARCH_PARAM}`,
    weightUrl: (manifestPath: string) =>
      `${trimmed}/${manifestPath}${TFHUB_SEARCH_PARAM}`,
  }
}

/**
 * `fetchModelAsset` hands back a `Uint8Array` it allocated at exactly the asset's length, so its
 * `buffer` is already the whole asset — but a view is not a buffer, and a future change to either
 * the cache path or the download path must not be able to smuggle a padded or offset view into a
 * weight tensor. The copy only ever runs if that invariant stops holding.
 */
function toArrayBuffer(bytes: Uint8Array<ArrayBuffer>): ArrayBuffer {
  return bytes.byteOffset === 0 && bytes.byteLength === bytes.buffer.byteLength
    ? bytes.buffer
    : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}

/**
 * An `io.IOHandler` that loads one MoveNet model through the shared model cache.
 *
 * Hand the result to `poseDetection.createDetector` as `modelUrl`. `load()` fetches `model.json`
 * first (small, and the only thing that names the shards), then every shard the weights manifest
 * lists — in parallel, exactly as `loadWeightsAsArrayBuffer` does — and returns the artifacts
 * `GraphModel.loadSync` expects.
 *
 * **Progress reports only what a response actually declared.** Each file's total appears as soon
 * as its own response headers arrive, so a multi-file aggregate's total GROWS as the shards begin
 * rather than being correct from the first byte. That is deliberate. The manifest does name every
 * weight's dtype and shape, so a per-GROUP byte total is derivable — but the split of that group
 * across its shards is not in the file, and reconstructing it would mean assuming the converter's
 * 4 MiB shard size. `ModelLoadState.progress` exists to distinguish a measurement from a guess, so
 * this module reports the measurement and leaves the growth for the header to present.
 */
export function createMoveNetModelLoader(
  modelUrl: string,
  onAssetProgress?: ModelAssetProgressListener,
): io.IOHandler {
  const source = resolveMoveNetModelSource(modelUrl)

  return {
    async load(): Promise<io.ModelArtifacts> {
      const manifestBytes = await fetchModelAsset(
        {
          id: `${source.assetIdPrefix}/${MODEL_JSON_NAME}`,
          url: source.modelJsonUrl,
          version: source.version,
        },
        onAssetProgress,
      )

      let modelJSON: io.ModelJSON
      try {
        modelJSON = JSON.parse(new TextDecoder().decode(manifestBytes)) as io.ModelJSON
      } catch (error) {
        throw new Error(
          `Failed to parse MoveNet model JSON from ${source.modelJsonUrl}: ${String(error)}`,
          { cause: error },
        )
      }

      // The same guard tfjs's own HTTP handler applies: a manifest with neither topology nor
      // weights is a served error page or a truncated body, and failing here names the URL
      // instead of surfacing as an opaque graph-construction crash later.
      if (modelJSON.modelTopology == null && modelJSON.weightsManifest == null) {
        throw new Error(
          `MoveNet model JSON at ${source.modelJsonUrl} contains neither model topology nor a weights manifest.`,
        )
      }

      if (modelJSON.weightsManifest == null) {
        return io.getModelArtifactsForJSONSync(modelJSON)
      }

      // One entry per shard, in manifest order — `decodeWeights` reads the concatenation of these
      // buffers against `weightSpecs`, so the order IS the data.
      const manifestPaths = modelJSON.weightsManifest.flatMap((group) => group.paths)
      const weightSpecs = io.getWeightSpecs(modelJSON.weightsManifest)
      const weightData = await Promise.all(
        manifestPaths.map(async (manifestPath) =>
          toArrayBuffer(
            await fetchModelAsset(
              {
                id: `${source.assetIdPrefix}/${manifestPath}`,
                url: source.weightUrl(manifestPath),
                version: source.version,
              },
              onAssetProgress,
            ),
          ),
        ),
      )

      return io.getModelArtifactsForJSONSync(modelJSON, weightSpecs, weightData)
    },
  }
}
