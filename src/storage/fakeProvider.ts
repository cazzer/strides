import {
  StorageError,
  type ProviderAvailability,
  type StorageProvider,
  type StoredFile,
  type StoredFolder,
  type StoredProps,
} from './provider'

/**
 * An in-memory provider (design D2). Backs the unit tests and, through the dev-only
 * `window.__STRIDES_STORAGE_PROVIDER_OVERRIDE__ = 'fake'`, live checks with no Google account.
 * With `persistKey` it mirrors its tree to `localStorage` so a reload keeps what was saved — JSON
 * contents and blob SIZES only, never blob bytes.
 */

interface FakeNode {
  id: string
  name: string
  parentId: string | null
  props: StoredProps
  folder: boolean
  json?: unknown
  sizeBytes?: number
}

export interface FakeProviderOptions {
  /** Start connected (tests) instead of disconnected. */
  connected?: boolean
  unavailable?: boolean
  persistKey?: string
  /** Fail the n-th blob upload (0-based) with a network error. */
  failUploadAt?: number
}

export interface FakeProvider extends StorageProvider {
  /** Test hook: every node, in creation order. */
  nodes(): readonly FakeNode[]
  /** Test hook: delete a node (and its children), as a runner might in Drive. */
  remove(id: string): void
  /** Test hook: overwrite a JSON file's contents, as a runner might in Drive. */
  overwrite(id: string, json: unknown): void
  readonly calls: string[]
}

export function createFakeProvider(options: FakeProviderOptions = {}): FakeProvider {
  let nodes: FakeNode[] = load()
  let connected = options.connected ?? false
  let prepared = false
  let uploads = 0
  let counter = nodes.length
  const calls: string[] = []

  function load(): FakeNode[] {
    if (!options.persistKey) return []
    try {
      const raw = window.localStorage.getItem(options.persistKey)
      return raw ? (JSON.parse(raw) as FakeNode[]) : []
    } catch {
      return []
    }
  }
  function persist(): void {
    if (!options.persistKey) return
    try {
      window.localStorage.setItem(options.persistKey, JSON.stringify(nodes))
    } catch {
      // ignore
    }
  }
  function nextId(): string {
    counter += 1
    return `fake-${counter}`
  }
  function requireConnected(): void {
    if (!connected) throw new StorageError('not-connected', 'Not connected.')
  }
  function add(node: Omit<FakeNode, 'id'>): FakeNode {
    const created = { ...node, id: nextId() }
    nodes.push(created)
    persist()
    return created
  }
  const asFile = (n: FakeNode): StoredFile => ({ id: n.id, name: n.name, props: { ...n.props } })

  const provider: FakeProvider = {
    id: 'fake',
    label: 'Test storage',
    calls,
    availability(): ProviderAvailability {
      if (options.unavailable) return 'unavailable'
      return connected ? 'connected' : 'disconnected'
    },
    async prepare() {
      calls.push('prepare')
      prepared = true
    },
    isPrepared: () => prepared,
    async connect() {
      calls.push('connect')
      if (options.unavailable) throw new StorageError('unavailable', 'Unavailable.', false)
      connected = true
    },
    async ensureAccess() {
      calls.push('ensureAccess')
      if (options.unavailable) throw new StorageError('unavailable', 'Unavailable.', false)
      connected = true
    },
    async disconnect() {
      calls.push('disconnect')
      connected = false
    },
    async findRoot(knownId) {
      requireConnected()
      calls.push('findRoot')
      const known = knownId ? nodes.find((n) => n.id === knownId && n.folder) : undefined
      const root = known ?? nodes.find((n) => n.parentId === null && n.props.stridesKind === 'root')
      return root ? { id: root.id, name: root.name } : null
    },
    async ensureRoot(knownId) {
      requireConnected()
      calls.push('ensureRoot')
      const known = knownId ? nodes.find((n) => n.id === knownId && n.folder) : undefined
      const root = known ?? nodes.find((n) => n.parentId === null && n.props.stridesKind === 'root')
      if (root) return { id: root.id, name: root.name }
      const created = add({ name: 'Strides', parentId: null, props: { stridesKind: 'root' }, folder: true })
      return { id: created.id, name: created.name }
    },
    async createFolder(parent: StoredFolder, name: string, props: StoredProps) {
      requireConnected()
      calls.push(`createFolder:${name}`)
      const created = add({ name, parentId: parent.id, props: { ...props }, folder: true })
      return { id: created.id, name: created.name }
    },
    async writeJson(parent, name, data, props, existing) {
      requireConnected()
      calls.push(`writeJson:${name}`)
      const json = JSON.parse(JSON.stringify(data))
      const current = existing ? nodes.find((n) => n.id === existing.id) : undefined
      if (current) {
        current.json = json
        current.name = name
        persist()
        return asFile(current)
      }
      return asFile(add({ name, parentId: parent.id, props: { ...props }, folder: false, json }))
    },
    async uploadBlob(parent, name, blob, props, onProgress, signal) {
      requireConnected()
      calls.push(`uploadBlob:${name}`)
      if (signal?.aborted) throw new StorageError('cancelled', 'Cancelled.')
      const n = uploads++
      onProgress?.(0.5)
      if (options.failUploadAt === n) throw new StorageError('network', 'Upload failed.')
      onProgress?.(1)
      return asFile(add({ name, parentId: parent.id, props: { ...props }, folder: false, sizeBytes: blob.size }))
    },
    async readJson(file) {
      requireConnected()
      calls.push(`readJson:${file.id}`)
      const node = nodes.find((n) => n.id === file.id)
      if (!node || node.folder) throw new StorageError('not-found', 'File not found.')
      return JSON.parse(JSON.stringify(node.json))
    },
    async trash(folder) {
      requireConnected()
      calls.push(`trash:${folder.name}`)
      provider.remove(folder.id)
    },
    async findByProps(parent, props) {
      requireConnected()
      calls.push(`findByProps:${props.stridesKind ?? '*'}`)
      return nodes
        .filter(
          (n) =>
            n.parentId === parent.id &&
            Object.entries(props).every(([k, v]) => (n.props as unknown as Record<string, unknown>)[k] === v),
        )
        .map(asFile)
    },
    nodes: () => nodes,
    remove(id) {
      const doomed = new Set([id])
      let grew = true
      while (grew) {
        grew = false
        for (const n of nodes) {
          if (n.parentId && doomed.has(n.parentId) && !doomed.has(n.id)) {
            doomed.add(n.id)
            grew = true
          }
        }
      }
      nodes = nodes.filter((n) => !doomed.has(n.id))
      persist()
    },
    overwrite(id, json) {
      const node = nodes.find((n) => n.id === id)
      if (node) node.json = json
      persist()
    },
  }
  return provider
}
