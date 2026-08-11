import { useEffect, useRef } from 'react'
import type { RefObject } from 'react'
import type { RobustPoseFrame } from '../pose/robustness/types'
import type { VideoMetadata } from '../video/types'
import { findNearestFrame, toDrawOps } from './skeletonGeometry'
import type { DrawOp } from './skeletonGeometry'

export interface SkeletonOverlayProps {
  videoRef: RefObject<HTMLVideoElement | null>
  frames: RobustPoseFrame[]
  /** Used for the canvas's native (pixel-space) width/height — MoveNet keypoints are in
   * video-native pixels (see `movenet.ts`'s `toPoseFrame`), so the canvas's own CSS scaling
   * (100% width/height over an `absolute`, `inset: 0` stage) handles fit-to-displayed-size with
   * zero manual coordinate math here. */
  metadata: VideoMetadata
}

const POINT_RADIUS_PX = 6
const STROKE_WIDTH_PX = 3
const SKELETON_COLOR = '#22d3ee'

function drawOne(ctx: CanvasRenderingContext2D, op: DrawOp) {
  ctx.globalAlpha = op.opacity
  ctx.beginPath()
  if (op.kind === 'point') {
    ctx.fillStyle = SKELETON_COLOR
    ctx.arc(op.x, op.y, POINT_RADIUS_PX, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.strokeStyle = SKELETON_COLOR
    ctx.lineWidth = STROKE_WIDTH_PX
    ctx.moveTo(op.x1, op.y1)
    ctx.lineTo(op.x2, op.y2)
    ctx.stroke()
  }
}

/**
 * Canvas overlay drawing the robustness-adjusted skeleton for whatever video frame is currently
 * displayed, kept in sync at any point in playback — not just start-to-finish through a full
 * analysis run. A `requestAnimationFrame` loop runs only while the video is actually playing
 * (started on `play`, stopped on `pause`/`ended`); `seeked`/`timeupdate` trigger an immediate
 * one-shot redraw the rest of the time, which is what keeps the overlay in sync while the user
 * scrubs a paused video (dragging the native scrubber fires `timeupdate` continuously, `seeked`
 * once on release) without an rAF loop spinning while fully idle.
 */
export function SkeletonOverlay({ videoRef, frames, metadata }: SkeletonOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const framesRef = useRef(frames)

  // Refs are read-only during render; keep this one fresh via an effect (read only from event
  // handlers/the rAF loop below, never during render, so the one-tick delay is inconsequential).
  useEffect(() => {
    framesRef.current = frames
  }, [frames])

  useEffect(() => {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let rafId: number | null = null

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      const frame = findNearestFrame(framesRef.current, video.currentTime)
      if (!frame) return
      for (const op of toDrawOps(frame)) {
        drawOne(ctx, op)
      }
      ctx.globalAlpha = 1
    }

    const loop = () => {
      draw()
      rafId = requestAnimationFrame(loop)
    }

    const startLoop = () => {
      if (rafId === null) {
        rafId = requestAnimationFrame(loop)
      }
    }

    const stopLoop = () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }

    const handleStop = () => {
      stopLoop()
      draw()
    }

    video.addEventListener('play', startLoop)
    video.addEventListener('pause', handleStop)
    video.addEventListener('ended', handleStop)
    video.addEventListener('seeked', draw)
    video.addEventListener('timeupdate', draw)

    if (video.paused) {
      draw()
    } else {
      startLoop()
    }

    return () => {
      stopLoop()
      video.removeEventListener('play', startLoop)
      video.removeEventListener('pause', handleStop)
      video.removeEventListener('ended', handleStop)
      video.removeEventListener('seeked', draw)
      video.removeEventListener('timeupdate', draw)
    }
  }, [videoRef])

  return (
    <canvas
      ref={canvasRef}
      width={metadata.width}
      height={metadata.height}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full"
    />
  )
}
