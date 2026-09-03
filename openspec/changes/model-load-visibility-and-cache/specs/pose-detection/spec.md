## ADDED Requirements

### Requirement: Model load state is observable from both detector owners

The system SHALL expose, for each of its two independent detector owners — the primary detector hook
and the module-cached scale-pass detector accessor — a load state consisting of a phase (`idle`,
`loading`, `ready`, or `error`) and an **optional** determinate progress reading (bytes loaded and
bytes total). Progress SHALL be absent whenever byte counts are not known, rather than present with
a placeholder, a zero, or an inferred figure: an absent reading means "indeterminate", and a
consumer SHALL be able to tell the two apart without guessing.

Both owners SHALL publish that state to whichever component owns the application header, so that a
model download in flight is observable by the code that presents the page rather than discarded at
the top of the tree.

The scale-pass accessor's channel SHALL be a plain subscription independent of any rendering
library, and observing it SHALL NOT change what it is. Specifically, the accessor SHALL keep its
module-level, page-lifetime instance cache (no per-observer creation or disposal), SHALL still not
read `resolvePoseDetectorConfig()` or the `__STRIDES_POSE_BACKEND_OVERRIDE__` window override, and
SHALL NOT begin creating a detector merely because something subscribed. Observation is a read of
state the accessor already had; it is not an owner of the resource.

#### Scenario: The primary detector's load reaches its observer

- **WHEN** the primary detector hook is mounted and its underlying detector creation resolves
- **THEN** its load phase reads `loading` before the creation settles and `ready` afterwards, and
  both readings are available to the component that owns the application header

#### Scenario: A creation failure is observable rather than swallowed

- **WHEN** the primary detector's creation rejects
- **THEN** its load phase reads `error` and that phase is available to the component that owns the
  application header, instead of being reported only into a value nothing reads

#### Scenario: The scale-pass detector reads idle until something asks for it

- **WHEN** the page has loaded and no analysis run has requested the scale-pass detector
- **THEN** the scale-pass load phase reads `idle`

#### Scenario: Subscribing does not start a download

- **WHEN** an observer subscribes to the scale-pass detector's load channel and nothing requests the
  detector
- **THEN** no detector is created and no model asset is fetched as a result of the subscription

#### Scenario: The scale-pass detector's load is delivered to its subscribers

- **WHEN** an analysis run requests the scale-pass detector for the first time
- **THEN** every current subscriber observes the phase moving to `loading`, and then to `ready` on
  success or `error` on failure

#### Scenario: Observation does not cost the page-lifetime cache or the config exemption

- **WHEN** the scale-pass detector is observed and then requested twice across two analysis runs
- **THEN** the cached instance is returned on the second request with no second creation, and the
  detector is still created with `{ backend: 'mediapipePoseLandmarker' }` regardless of
  `window.__STRIDES_POSE_BACKEND_OVERRIDE__`

#### Scenario: Unknown byte totals leave progress absent

- **WHEN** a model download is in flight and no total byte count is known for it
- **THEN** the load state's progress reading is absent, and no loaded-or-total byte figure is
  reported for it

### Requirement: Model assets load through one cached, progress-reporting fetch

The system SHALL route model asset downloads through a single shared utility that fetches an asset,
reports byte progress against the response's `Content-Length` where that header is present and
CORS-readable, reports no progress figure at all where it is not, consults a client-side response
cache before fetching, and populates that cache on a miss.

Cache entries SHALL be keyed by a **stable asset identity supplied by the caller** — its canonical
URL — **together with an explicit model version token**, so that changing the token supersedes the
stored bytes rather than serving a stale model forever. Superseded entries SHALL be removed rather
than accumulating, and removal SHALL be scoped to the asset whose token changed.

The key SHALL NOT be derived from the URL a request actually resolves to. MoveNet's weights reach a
per-request signed URL through two redirects, so a key taken from the fetched or redirected URL
would differ on every request, miss every time, and disable the cache while appearing to work.

The utility SHALL degrade gracefully rather than fail: the cache API is absent in some browsing
contexts and throws in others (private browsing, blocked site data), so every cache read and every
cache write SHALL be guarded, and an unavailable or throwing cache SHALL still yield a completed,
uncached download.

#### Scenario: A cached asset is served without a network fetch

- **WHEN** a model asset is requested and a cache entry exists for its URL and current version token
- **THEN** the stored bytes are returned and no network request is made for that asset

#### Scenario: A miss populates the cache

- **WHEN** a model asset is requested with no cache entry for its URL and current version token
- **THEN** the asset is fetched over the network and its bytes are stored under that key

#### Scenario: A version-token change evicts the old entry

- **WHEN** a model asset is requested with a version token different from the one an existing entry
  was stored under
- **THEN** the old entry is removed, the asset is re-fetched, and the new bytes are stored under the
  new key

#### Scenario: A redirecting, per-request-signed URL still hits

- **WHEN** a model asset is requested twice under the same identity and version token, and the URL
  it resolves to differs between the two requests
- **THEN** the second request is served from the cache and issues no network request

#### Scenario: An unavailable cache still yields the asset

- **WHEN** the cache API is absent, or a cache read or write throws
- **THEN** the request still resolves with the fetched asset, and the failure is not surfaced as a
  download failure

#### Scenario: A missing Content-Length reports no progress figure

- **WHEN** a model asset's response carries no readable `Content-Length`
- **THEN** the download reports progress as absent for its whole duration, rather than reporting an
  invented total

### Requirement: The MediaPipe pose landmarker model loads from the shared model cache

The system SHALL create the MediaPipe pose landmarker from model bytes obtained through the shared
model-asset utility, rather than handing the library an asset path for it to fetch itself, so that
the 9.4 MB `.task` file is subject to the same progress reporting and client-side cache as every
other model asset. A returning visitor SHALL NOT re-download those bytes.

The self-hosting rationale recorded alongside that asset SHALL state the measured deploy behaviour
rather than an assumption: the deploy's response headers are not controllable and the file is served
with a ten-minute max-age, which is why client-side storage is required.

#### Scenario: A second page load does not re-download the landmarker model

- **WHEN** a reader loads the page, runs an analysis that creates the scale-pass detector, and then
  loads the page again and runs another analysis
- **THEN** the second run obtains the model bytes from the client-side cache and issues no network
  request for the `.task` asset

#### Scenario: The landmarker still loads with no usable cache

- **WHEN** the client-side cache is unavailable and the scale-pass detector is requested
- **THEN** the model bytes are fetched over the network and the landmarker is created as before

### Requirement: MoveNet model weights load from the shared model cache

The system SHALL load MoveNet's single-pose and multi-pose model weights through the shared
model-asset utility, by supplying the pose-detection library a model loader rather than a URL
string, so that those assets report progress and are cached client-side alongside the MediaPipe
asset. Where an asset's byte total is not readable from the browser, its progress SHALL degrade to
indeterminate rather than being fabricated.

Routing weights through a different loader SHALL NOT change any analysis output. The loaded weights
are the same bytes reaching the same graph, so every metric value, confidence, view reading and
sampling count SHALL be unchanged.

#### Scenario: A second page load does not re-download the MoveNet weights

- **WHEN** a reader loads the page twice
- **THEN** the second load obtains MoveNet's weights from the client-side cache and issues no
  network request for them

#### Scenario: Analysis output is identical through the cached loader

- **WHEN** the same clip is analysed before and after MoveNet's weights are routed through the
  shared utility
- **THEN** every reported field is identical apart from elapsed wall-clock time
