import { afterEach, describe, expect, it, vi } from 'vitest'
import { createGoogleDriveProvider } from './googleDriveProvider'
import { GIS_SCRIPT_SRC, loadGisScript, resetGisLoaderForTests, type GisOAuth2, type GisTokenResponse, type GisClientError } from './gis'
import { DRIVE_FILE_SCOPE } from './tokenManager'
import type { XhrLike } from './driveApi'
import { StorageError } from '../provider'

interface FakeGis {
  oauth2: GisOAuth2
  config: { client_id: string; scope: string } | null
  requests: (Record<string, string> | undefined)[]
  respond(response: GisTokenResponse): void
  fail(error: GisClientError): void
  revoked: string[]
  granted: boolean
}

function fakeGis(): FakeGis {
  let callback: ((r: GisTokenResponse) => void) | null = null
  let errorCallback: ((e: GisClientError) => void) | null = null
  const gis: FakeGis = {
    config: null,
    requests: [],
    revoked: [],
    granted: true,
    respond: (r) => callback?.(r),
    fail: (e) => errorCallback?.(e),
    oauth2: {
      initTokenClient(config) {
        gis.config = { client_id: config.client_id, scope: config.scope }
        callback = config.callback
        errorCallback = config.error_callback ?? null
        return { requestAccessToken: (overrides) => void gis.requests.push(overrides as Record<string, string> | undefined) }
      },
      hasGrantedAllScopes: () => gis.granted,
      revoke: (token, done) => {
        gis.revoked.push(token)
        done?.()
      },
    },
  }
  return gis
}

type Call = { url: string; init: RequestInit }

function jsonResponse(body: unknown, init: { status?: number; headers?: Record<string, string> } = {}): Response {
  return new Response(JSON.stringify(body), { status: init.status ?? 200, headers: init.headers })
}

function setup(responder: (call: Call) => Response = () => jsonResponse({ id: 'F1', name: 'x' })) {
  const gis = fakeGis()
  const calls: Call[] = []
  const fetchImpl = vi.fn(async (url: string, init: RequestInit = {}) => {
    const call = { url, init }
    calls.push(call)
    return responder(call)
  })
  const xhrs: FakeXhr[] = []
  let clock = 1_000_000
  const provider = createGoogleDriveProvider({
    clientId: 'client-123.apps.googleusercontent.com',
    loadGis: async () => gis.oauth2,
    fetchImpl,
    createXhr: () => {
      const xhr = new FakeXhr()
      xhrs.push(xhr)
      return xhr
    },
    now: () => clock,
  })
  return { gis, calls, provider, xhrs, advance: (ms: number) => (clock += ms) }
}

class FakeXhr implements XhrLike {
  method = ''
  url = ''
  headers: Record<string, string> = {}
  body: Blob | null = null
  status = 0
  responseText = ''
  upload: XhrLike['upload'] = { onprogress: null }
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  onabort: (() => void) | null = null
  open(method: string, url: string) {
    this.method = method
    this.url = url
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value
  }
  send(body: Blob) {
    this.body = body
  }
  abort() {
    this.onabort?.()
  }
  finish(status: number, body: unknown) {
    this.status = status
    this.responseText = JSON.stringify(body)
    this.upload.onprogress?.({ loaded: 5, total: 10, lengthComputable: true })
    this.onload?.()
  }
}

async function connected(responder?: (call: Call) => Response) {
  const ctx = setup(responder)
  await ctx.provider.prepare()
  const pending = ctx.provider.connect()
  ctx.gis.respond({ access_token: 'tok-1', expires_in: 3599, scope: DRIVE_FILE_SCOPE })
  await pending
  return ctx
}

afterEach(() => {
  resetGisLoaderForTests()
  delete window.google
  document.head.querySelectorAll('script').forEach((s) => s.remove())
})

describe('availability and config', () => {
  it('is unavailable without a client ID and never loads the script', async () => {
    const loadGis = vi.fn()
    const provider = createGoogleDriveProvider({ clientId: undefined, loadGis })
    expect(provider.availability()).toBe('unavailable')
    await expect(provider.prepare()).rejects.toMatchObject({ code: 'unavailable' })
    await expect(provider.connect()).rejects.toMatchObject({ code: 'unavailable' })
    expect(loadGis).not.toHaveBeenCalled()
  })

  it('treats a blank client ID as absent', () => {
    expect(createGoogleDriveProvider({ clientId: '  ' }).availability()).toBe('unavailable')
  })

  it('does not inject the Google script until prepare is called', async () => {
    const provider = createGoogleDriveProvider({ clientId: 'c' })
    expect(provider.availability()).toBe('disconnected')
    expect(document.querySelector(`script[src="${GIS_SCRIPT_SRC}"]`)).toBeNull()
    const preparing = provider.prepare()
    const script = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SCRIPT_SRC}"]`)
    expect(script).not.toBeNull()
    window.google = { accounts: { oauth2: fakeGis().oauth2 } }
    script!.onload?.(new Event('load'))
    await preparing
    expect(provider.isPrepared()).toBe(true)
  })

  it('injects the script once even when asked twice', async () => {
    const a = loadGisScript()
    const b = loadGisScript()
    expect(a).toBe(b)
    expect(document.querySelectorAll(`script[src="${GIS_SCRIPT_SRC}"]`)).toHaveLength(1)
    document.querySelector<HTMLScriptElement>('script')!.onerror?.(new Event('error'))
    await expect(a).rejects.toThrow(/Could not load/)
  })
})

describe('token client', () => {
  it('asks for drive.file only, with the configured client ID', async () => {
    const { gis } = await connected()
    expect(gis.config).toEqual({ client_id: 'client-123.apps.googleusercontent.com', scope: DRIVE_FILE_SCOPE })
    expect(DRIVE_FILE_SCOPE).toBe('https://www.googleapis.com/auth/drive.file')
  })

  it('opens the popup synchronously inside connect()', async () => {
    const { gis, provider } = setup()
    await provider.prepare()
    void provider.connect()
    expect(gis.requests).toHaveLength(1) // before any await
  })

  it('refuses to connect before prepare finishes', async () => {
    const { provider } = setup()
    await expect(provider.connect()).rejects.toMatchObject({ code: 'not-connected' })
  })

  it('is connected until the token nears expiry, then re-asks with prompt empty', async () => {
    const { provider, gis, advance } = await connected()
    expect(provider.availability()).toBe('connected')
    await provider.ensureAccess()
    expect(gis.requests).toHaveLength(1)
    advance(3599_000 - 30_000)
    expect(provider.availability()).toBe('disconnected')
    const again = provider.ensureAccess()
    expect(gis.requests.at(-1)).toEqual({ prompt: '' })
    gis.respond({ access_token: 'tok-2', expires_in: 3599 })
    await again
    expect(provider.availability()).toBe('connected')
  })

  it('maps popup failures and a denied scope to retryable errors', async () => {
    const { provider, gis } = setup()
    await provider.prepare()
    let p = provider.connect()
    gis.fail({ type: 'popup_failed_to_open' })
    await expect(p).rejects.toMatchObject({ code: 'popup-blocked', retryable: true })
    p = provider.connect()
    gis.fail({ type: 'popup_closed' })
    await expect(p).rejects.toMatchObject({ code: 'popup-closed' })
    p = provider.connect()
    gis.granted = false
    gis.respond({ access_token: 't', expires_in: 3600 })
    await expect(p).rejects.toThrow(/Tick it/)
    p = provider.connect()
    gis.respond({ error: 'access_denied' })
    await expect(p).rejects.toMatchObject({ code: 'access-denied' })
    expect(provider.availability()).toBe('disconnected')
  })

  it('asks for a token to revoke with when a remembered runner disconnects after a reload', async () => {
    const { provider, gis } = setup()
    await provider.prepare()
    const pending = provider.disconnect()
    expect(gis.requests.at(-1)).toEqual({ prompt: '' }) // synchronously, inside the tap
    gis.respond({ access_token: 'tok-r', expires_in: 3600 })
    await pending
    expect(gis.revoked).toEqual(['tok-r'])
  })

  it('revokes the token on disconnect', async () => {
    const { provider, gis } = await connected()
    await provider.disconnect()
    expect(gis.revoked).toEqual(['tok-1'])
    expect(provider.availability()).toBe('disconnected')
  })
})

describe('Drive v3 requests', () => {
  it('finds the root by appProperties and sends the bearer token', async () => {
    const { provider, calls } = await connected(() => jsonResponse({ files: [{ id: 'R', name: 'Strides' }] }))
    expect(await provider.findRoot(null)).toEqual({ id: 'R', name: 'Strides' })
    const url = new URL(calls[0].url)
    expect(url.origin + url.pathname).toBe('https://www.googleapis.com/drive/v3/files')
    expect(url.searchParams.get('q')).toBe(
      "mimeType='application/vnd.google-apps.folder' and appProperties has { key='stridesKind' and value='root' } and trashed=false",
    )
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tok-1')
  })

  it('uses a remembered root id when it is still a live root', async () => {
    const { provider, calls } = await connected(() =>
      jsonResponse({ id: 'R9', name: 'Strides', appProperties: { stridesKind: 'root' }, trashed: false }),
    )
    expect(await provider.findRoot('R9')).toEqual({ id: 'R9', name: 'Strides' })
    expect(calls).toHaveLength(1)
  })

  it('creates the root folder in My Drive when none exists', async () => {
    const { provider, calls } = await connected((call) =>
      call.init.method === 'POST' ? jsonResponse({ id: 'NEW', name: 'Strides' }) : jsonResponse({ files: [] }),
    )
    expect(await provider.ensureRoot(null)).toEqual({ id: 'NEW', name: 'Strides' })
    expect(JSON.parse(calls[1].init.body as string)).toEqual({
      name: 'Strides',
      mimeType: 'application/vnd.google-apps.folder',
      appProperties: { stridesKind: 'root' },
    })
  })

  it('lists children by parent and props, following pages', async () => {
    let page = 0
    const { provider, calls } = await connected(() =>
      jsonResponse(
        page++ === 0
          ? { files: [{ id: 'a', name: 'A', appProperties: { stridesKind: 'assessment', stridesAssessmentId: 'x' } }], nextPageToken: 'P2' }
          : { files: [{ id: 'b', name: 'B', appProperties: { stridesKind: 'assessment' } }] },
      ),
    )
    const found = await provider.findByProps({ id: "it's", name: 'r' }, { stridesKind: 'assessment' })
    expect(found.map((f) => f.id)).toEqual(['a', 'b'])
    expect(found[0].props).toEqual({ stridesKind: 'assessment', stridesAssessmentId: 'x' })
    const q = new URL(calls[0].url).searchParams.get('q')
    expect(q).toBe("'it\\'s' in parents and appProperties has { key='stridesKind' and value='assessment' } and trashed=false")
    expect(new URL(calls[1].url).searchParams.get('pageToken')).toBe('P2')
  })

  it('writes JSON as a multipart upload, and PATCHes an existing file', async () => {
    const { provider, calls } = await connected(() => jsonResponse({ id: 'J', name: 'a.json', appProperties: { stridesKind: 'analysis' } }))
    const parent = { id: 'P', name: 'p' }
    await provider.writeJson(parent, 'a.json', { n: 1 }, { stridesKind: 'analysis', stridesAssessmentId: 'id' })
    expect(calls[0].url).toBe(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,appProperties,trashed',
    )
    expect(calls[0].init.method).toBe('POST')
    const body = calls[0].init.body as string
    expect(body).toContain('"parents":["P"]')
    expect(body).toContain('"appProperties":{"stridesKind":"analysis","stridesAssessmentId":"id"}')
    expect(body).toContain('"n": 1')
    await provider.writeJson(parent, 'i.json', {}, { stridesKind: 'index' }, { id: 'EX', name: 'i', props: { stridesKind: 'index' } })
    expect(calls[1].init.method).toBe('PATCH')
    expect(calls[1].url).toContain('/upload/drive/v3/files/EX?uploadType=multipart')
    expect(calls[1].init.body as string).not.toContain('parents')
  })

  it('uploads a clip through a resumable session with progress', async () => {
    const { provider, calls, xhrs } = await connected(() =>
      new Response(null, { status: 200, headers: { Location: 'https://upload.example/session-1' } }),
    )
    const blob = new Blob([new Uint8Array(10)], { type: 'video/mp4' })
    const progress: number[] = []
    const pending = provider.uploadBlob({ id: 'P', name: 'p' }, 'clip-1.mp4', blob, { stridesKind: 'clip', stridesAssessmentId: 'id' }, (f) => progress.push(f))
    await vi.waitFor(() => expect(xhrs).toHaveLength(1))
    expect(calls[0].url).toContain('uploadType=resumable')
    expect((calls[0].init.headers as Record<string, string>)['X-Upload-Content-Length']).toBe('10')
    expect(xhrs[0].method).toBe('PUT')
    expect(xhrs[0].url).toBe('https://upload.example/session-1')
    xhrs[0].finish(200, { id: 'C1', name: 'clip-1.mp4', appProperties: { stridesKind: 'clip' } })
    expect(await pending).toEqual({ id: 'C1', name: 'clip-1.mp4', props: { stridesKind: 'clip' } })
    expect(progress).toEqual([0.5, 1])
  })

  it('maps a full Drive to a non-retryable quota error', async () => {
    const { provider, xhrs } = await connected(() => new Response(null, { status: 200, headers: { Location: 'https://u/s' } }))
    const pending = provider.uploadBlob({ id: 'P', name: 'p' }, 'c', new Blob([]), { stridesKind: 'clip' })
    await vi.waitFor(() => expect(xhrs).toHaveLength(1))
    xhrs[0].finish(403, { error: { errors: [{ reason: 'storageQuotaExceeded' }] } })
    await expect(pending).rejects.toMatchObject({ code: 'quota', retryable: false })
  })

  it('maps HTTP and network failures', async () => {
    const { provider } = await connected(() => jsonResponse({}, { status: 401 }))
    await expect(provider.readJson({ id: 'x' })).rejects.toMatchObject({ code: 'not-connected' })
    const net = await connected(() => {
      throw new TypeError('Failed to fetch')
    })
    await expect(net.provider.readJson({ id: 'x' })).rejects.toMatchObject({ code: 'network' })
  })

  it('trashes a folder and orders root lookups oldest first', async () => {
    const { provider, calls } = await connected(() => jsonResponse({ files: [] , id: 'x' }))
    await provider.trash({ id: 'F9', name: 'f' })
    expect(calls[0].url).toBe('https://www.googleapis.com/drive/v3/files/F9?fields=id')
    expect(calls[0].init.method).toBe('PATCH')
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ trashed: true })
    await provider.findRoot(null)
    expect(new URL(calls[1].url).searchParams.get('orderBy')).toBe('createdTime')
  })

  it('reports an expired token as not connected, not as a network failure', async () => {
    const { provider, advance } = await connected()
    advance(4000_000)
    await expect(provider.readJson({ id: 'x' })).rejects.toMatchObject({ code: 'not-connected' })
  })

  it('refuses Drive calls without a token', async () => {
    const { provider } = setup()
    await expect(provider.findRoot(null)).rejects.toBeInstanceOf(StorageError)
  })
})
