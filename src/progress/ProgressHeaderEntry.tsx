import { BUTTON_OUTLINED } from '../storage/buttonStyles'
import { useStorageConnection, type StorageConnection } from '../storage/storageConnection'

/**
 * The header's way into Progress, offered once a runner has connected storage (now or on an
 * earlier visit). For a remembered runner whose token is gone, the tap itself asks for access
 * again, synchronously, so the page can load without a second tap.
 */
export function ProgressHeaderEntry({
  onOpen,
  current,
  connection: connectionProp,
}: {
  onOpen: () => void
  current: boolean
  connection?: StorageConnection
}) {
  const { snapshot, connection } = useStorageConnection(connectionProp)
  const { availability, remembered, prepared } = snapshot
  if (availability === 'unavailable') return null
  if (availability !== 'connected' && remembered === null) return null
  return (
    <button
      type="button"
      className={`${BUTTON_OUTLINED} progress-entry shrink-0`}
      aria-current={current ? 'page' : undefined}
      onClick={() => {
        if (availability !== 'connected' && prepared) connection.ensureAccess().catch(() => undefined)
        onOpen()
      }}
    >
      Progress
    </button>
  )
}
