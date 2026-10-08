'use client'

import { useEffect, useRef, useState } from 'react'
import styles from './page.module.css'

// Crop rectangle as fractions (0–1) of the page in its unrotated orientation
export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

const FULL_RECT: CropRect = { x: 0, y: 0, w: 1, h: 1 }
const MIN_SIZE = 0.05

// Map a rect from unrotated page space into the page rotated clockwise by `rotation`
export const rotateRect = (r: CropRect, rotation: number): CropRect => {
  switch (((rotation % 360) + 360) % 360) {
    case 90:
      return { x: 1 - r.y - r.h, y: r.x, w: r.h, h: r.w }
    case 180:
      return { x: 1 - r.x - r.w, y: 1 - r.y - r.h, w: r.w, h: r.h }
    case 270:
      return { x: r.y, y: 1 - r.x - r.w, w: r.h, h: r.w }
    default:
      return r
  }
}

export const unrotateRect = (r: CropRect, rotation: number): CropRect =>
  rotateRect(r, 360 - (((rotation % 360) + 360) % 360))

const isFullRect = (r: CropRect) => r.x < 0.001 && r.y < 0.001 && r.w > 0.999 && r.h > 0.999

const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max)

type DragMode = 'move' | 'nw' | 'ne' | 'sw' | 'se' | 'new'

interface CropEditorProps {
  imageUrl: string
  rotation: number
  crop: CropRect | undefined
  onChange: (crop: CropRect | undefined) => void
}

export default function CropEditor({ imageUrl, rotation, crop, onChange }: CropEditorProps) {
  const [rotatedUrl, setRotatedUrl] = useState<string | null>(null)
  const [stageSize, setStageSize] = useState<{ width: number; height: number } | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null)
  const [draft, setDraft] = useState<CropRect>(FULL_RECT)
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<{ mode: DragMode; startX: number; startY: number; startRect: CropRect } | null>(null)

  // Bake the rotation into the preview image so the crop overlay maps 1:1 onto it
  useEffect(() => {
    let cancelled = false
    const img = new Image()
    img.onload = () => {
      if (cancelled) return
      const quarterTurn = rotation % 180 !== 0
      const canvas = document.createElement('canvas')
      canvas.width = quarterTurn ? img.height : img.width
      canvas.height = quarterTurn ? img.width : img.height
      const ctx = canvas.getContext('2d')!
      ctx.translate(canvas.width / 2, canvas.height / 2)
      ctx.rotate((rotation * Math.PI) / 180)
      ctx.drawImage(img, -img.width / 2, -img.height / 2)
      setRotatedUrl(canvas.toDataURL('image/jpeg', 0.9))
      setNaturalSize({ width: canvas.width, height: canvas.height })
    }
    img.src = imageUrl
    return () => {
      cancelled = true
    }
  }, [imageUrl, rotation])

  // Scale the stage to fill the available viewport space
  useEffect(() => {
    if (!naturalSize) return
    const fit = () => {
      const maxW = Math.min(window.innerWidth * 0.8, 800)
      const maxH = window.innerHeight * 0.55
      const scale = Math.min(maxW / naturalSize.width, maxH / naturalSize.height)
      setStageSize({ width: naturalSize.width * scale, height: naturalSize.height * scale })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [naturalSize])

  // Sync the on-screen rect with the saved crop when not dragging
  useEffect(() => {
    if (dragRef.current) return
    setDraft(rotateRect(crop ?? FULL_RECT, rotation))
  }, [crop, rotation])

  const pointerToFraction = (e: React.PointerEvent) => {
    // Measure the content box so the stage border doesn't skew coordinates
    const stage = stageRef.current!
    const rect = stage.getBoundingClientRect()
    return {
      x: clamp((e.clientX - rect.left - stage.clientLeft) / stage.clientWidth, 0, 1),
      y: clamp((e.clientY - rect.top - stage.clientTop) / stage.clientHeight, 0, 1),
    }
  }

  const startDrag = (mode: DragMode) => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    stageRef.current!.setPointerCapture(e.pointerId)
    const { x, y } = pointerToFraction(e)
    dragRef.current = { mode, startX: x, startY: y, startRect: draft }
    if (mode === 'new') setDraft({ x, y, w: 0, h: 0 })
  }

  const handlePointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current
    if (!drag) return
    const { x: px, y: py } = pointerToFraction(e)
    const s = drag.startRect

    if (drag.mode === 'move') {
      setDraft({
        ...s,
        x: clamp(s.x + px - drag.startX, 0, 1 - s.w),
        y: clamp(s.y + py - drag.startY, 0, 1 - s.h),
      })
      return
    }

    if (drag.mode === 'new') {
      setDraft({
        x: Math.min(drag.startX, px),
        y: Math.min(drag.startY, py),
        w: Math.abs(px - drag.startX),
        h: Math.abs(py - drag.startY),
      })
      return
    }

    let left = s.x
    let top = s.y
    let right = s.x + s.w
    let bottom = s.y + s.h
    if (drag.mode === 'nw' || drag.mode === 'sw') left = Math.min(px, right - MIN_SIZE)
    if (drag.mode === 'ne' || drag.mode === 'se') right = Math.max(px, left + MIN_SIZE)
    if (drag.mode === 'nw' || drag.mode === 'ne') top = Math.min(py, bottom - MIN_SIZE)
    if (drag.mode === 'sw' || drag.mode === 'se') bottom = Math.max(py, top + MIN_SIZE)
    setDraft({ x: left, y: top, w: right - left, h: bottom - top })
  }

  const handlePointerUp = () => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null

    // Ignore accidental clicks that would create a tiny crop
    if (draft.w < MIN_SIZE || draft.h < MIN_SIZE) {
      setDraft(drag.startRect)
      return
    }

    const sourceRect = unrotateRect(draft, rotation)
    onChange(isFullRect(sourceRect) ? undefined : sourceRect)
  }

  if (!rotatedUrl || !stageSize) {
    return <div className={styles.cropStageLoading}>LOADING…</div>
  }

  return (
    <div
      ref={stageRef}
      className={styles.cropStage}
      style={{ width: stageSize.width, height: stageSize.height }}
      onPointerDown={startDrag('new')}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    >
      <img src={rotatedUrl} alt="" className={styles.cropImage} draggable={false} />
      <div
        className={styles.cropRect}
        style={{
          left: `${draft.x * 100}%`,
          top: `${draft.y * 100}%`,
          width: `${draft.w * 100}%`,
          height: `${draft.h * 100}%`,
        }}
        onPointerDown={startDrag('move')}
      >
        {(['nw', 'ne', 'sw', 'se'] as const).map((corner) => (
          <div
            key={corner}
            className={`${styles.cropHandle} ${styles[`cropHandle_${corner}`]}`}
            onPointerDown={startDrag(corner)}
          />
        ))}
      </div>
    </div>
  )
}
