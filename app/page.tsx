'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { PDFDocument, degrees } from 'pdf-lib'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import * as pdfjsLib from 'pdfjs-dist'
import styles from './page.module.css'

// Set up PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs'
}

type Mode = 'merge' | 'trim'

interface PDFFile {
  id: string
  file: File
  name: string
  pageCount: number | null
}

interface PageThumbnail {
  pageNum: number
  dataUrl: string
  width: number
  height: number
}

interface TrimFile {
  file: File
  name: string
  pageCount: number
  thumbnails: PageThumbnail[]
}

export default function Home() {
  // Mode state
  const [mode, setMode] = useState<Mode>('merge')

  // Merge mode state
  const [files, setFiles] = useState<PDFFile[]>([])
  const [isMerging, setIsMerging] = useState(false)

  // Trim mode state
  const [trimFile, setTrimFile] = useState<TrimFile | null>(null)
  const [cutPoints, setCutPoints] = useState<number[]>([])
  const [deletedPages, setDeletedPages] = useState<Set<number>>(new Set())
  const [rotations, setRotations] = useState<Map<number, number>>(new Map())
  const [isProcessing, setIsProcessing] = useState(false)
  const [isLoadingThumbnails, setIsLoadingThumbnails] = useState(false)
  const [viewerPage, setViewerPage] = useState<number | null>(null)

  // Shared state
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)
  const thumbnailRefs = useRef<Map<number, HTMLDivElement>>(new Map())

  const MAX_FILES = 5
  const MAX_CUTS = 4
  const THUMBNAIL_SCALE = 0.5

  const getPageCount = async (file: File): Promise<number | null> => {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })
      return pdf.getPageCount()
    } catch {
      return null
    }
  }

  const generateThumbnails = async (file: File): Promise<PageThumbnail[]> => {
    const arrayBuffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
    const thumbnails: PageThumbnail[] = []

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const viewport = page.getViewport({ scale: THUMBNAIL_SCALE })

      const canvas = document.createElement('canvas')
      const context = canvas.getContext('2d')!
      canvas.width = viewport.width
      canvas.height = viewport.height

      await page.render({
        canvasContext: context,
        viewport: viewport,
      }).promise

      thumbnails.push({
        pageNum: i,
        dataUrl: canvas.toDataURL('image/jpeg', 0.8),
        width: viewport.width,
        height: viewport.height,
      })
    }

    return thumbnails
  }

  // Reset when switching modes
  const handleModeChange = (newMode: Mode) => {
    setMode(newMode)
    setError(null)
    setFiles([])
    setTrimFile(null)
    setCutPoints([])
    setDeletedPages(new Set())
    setRotations(new Map())
  }

  // MERGE MODE FUNCTIONS
  const addFiles = useCallback(async (newFiles: FileList | File[]) => {
    setError(null)
    const pdfFiles = Array.from(newFiles).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    )

    if (pdfFiles.length === 0) {
      setError('Only PDF files are accepted')
      return
    }

    const availableSlots = MAX_FILES - files.length
    const filesToAdd = pdfFiles.slice(0, availableSlots)

    if (pdfFiles.length > availableSlots) {
      setError(`Only ${availableSlots} more file${availableSlots === 1 ? '' : 's'} can be added`)
    }

    const processedFiles: PDFFile[] = await Promise.all(
      filesToAdd.map(async (file) => ({
        id: `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        file,
        name: file.name,
        pageCount: await getPageCount(file),
      }))
    )

    setFiles((prev) => [...prev, ...processedFiles])
  }, [files.length])

  const removeFile = (id: string) => {
    setFiles((prev) => prev.filter((f) => f.id !== id))
    setError(null)
  }

  const mergePDFs = useCallback(async () => {
    if (files.length < 2) return

    setIsMerging(true)
    setError(null)

    try {
      const mergedPdf = await PDFDocument.create()

      for (const pdfFile of files) {
        const arrayBuffer = await pdfFile.file.arrayBuffer()
        const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })
        const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
        pages.forEach((page) => mergedPdf.addPage(page))
      }

      const mergedPdfBytes = await mergedPdf.save()
      const blob = new Blob([new Uint8Array(mergedPdfBytes)], { type: 'application/pdf' })
      const url = URL.createObjectURL(blob)

      const link = document.createElement('a')
      link.href = url
      link.download = `merged-${Date.now()}.pdf`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      setTimeout(() => {
        setFiles([])
        setIsMerging(false)
      }, 1000)
    } catch {
      setError('Failed to merge PDFs. Some files may be corrupted or encrypted.')
      setIsMerging(false)
    }
  }, [files])

  // TRIM MODE FUNCTIONS
  const addTrimFile = useCallback(async (newFiles: FileList | File[]) => {
    setError(null)
    const pdfFiles = Array.from(newFiles).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    )

    if (pdfFiles.length === 0) {
      setError('Only PDF files are accepted')
      return
    }

    const file = pdfFiles[0]
    const pageCount = await getPageCount(file)

    if (pageCount === null) {
      setError('Could not read PDF. File may be corrupted or encrypted.')
      return
    }

    if (pageCount < 1) {
      setError('PDF appears to be empty')
      return
    }

    setIsLoadingThumbnails(true)

    try {
      const thumbnails = await generateThumbnails(file)
      setTrimFile({ file, name: file.name, pageCount, thumbnails })
      setCutPoints([])
      setDeletedPages(new Set())
      setRotations(new Map())
    } catch {
      setError('Could not generate page previews. File may be corrupted.')
    } finally {
      setIsLoadingThumbnails(false)
    }
  }, [])

  const toggleCutPoint = (afterPage: number) => {
    setCutPoints((prev) => {
      if (prev.includes(afterPage)) {
        return prev.filter((p) => p !== afterPage)
      }
      if (prev.length >= MAX_CUTS) {
        setError(`Maximum ${MAX_CUTS} cut points (${MAX_CUTS + 1} parts)`)
        return prev
      }
      setError(null)
      return [...prev, afterPage].sort((a, b) => a - b)
    })
  }

  // Toggle page deletion
  const toggleDeletePage = (pageNum: number) => {
    setDeletedPages((prev) => {
      const newSet = new Set(prev)
      if (newSet.has(pageNum)) {
        newSet.delete(pageNum)
      } else {
        // Don't allow deleting all pages
        if (trimFile && newSet.size >= trimFile.pageCount - 1) {
          setError('Cannot delete all pages')
          return prev
        }
        newSet.add(pageNum)
        setError(null)
      }
      return newSet
    })
  }

  // Rotate page by 90 degrees
  const rotatePage = (pageNum: number) => {
    setRotations((prev) => {
      const newMap = new Map(prev)
      const currentRotation = newMap.get(pageNum) || 0
      const newRotation = (currentRotation + 90) % 360
      if (newRotation === 0) {
        newMap.delete(pageNum)
      } else {
        newMap.set(pageNum, newRotation)
      }
      return newMap
    })
  }

  // Check if there are any modifications
  const hasModifications = deletedPages.size > 0 || rotations.size > 0 || cutPoints.length > 0

  // Get active (non-deleted) page numbers
  const getActivePages = (): number[] => {
    if (!trimFile) return []
    return Array.from({ length: trimFile.pageCount }, (_, i) => i + 1)
      .filter(p => !deletedPages.has(p))
  }

  const processTrim = useCallback(async () => {
    if (!trimFile || !hasModifications) return

    setIsProcessing(true)
    setError(null)

    try {
      const arrayBuffer = await trimFile.file.arrayBuffer()
      const sourcePdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })

      // Get non-deleted pages
      const activePageNums = Array.from({ length: trimFile.pageCount }, (_, i) => i + 1)
        .filter(p => !deletedPages.has(p))

      const baseName = trimFile.name.replace(/\.pdf$/i, '')

      if (cutPoints.length === 0) {
        // No cuts - just apply deletions and rotations to single PDF
        const newPdf = await PDFDocument.create()
        const pageIndices = activePageNums.map(p => p - 1)
        const pages = await newPdf.copyPages(sourcePdf, pageIndices)

        pages.forEach((page, idx) => {
          const originalPageNum = activePageNums[idx]
          const rotation = rotations.get(originalPageNum) || 0
          if (rotation !== 0) {
            page.setRotation(degrees(rotation))
          }
          newPdf.addPage(page)
        })

        const pdfBytes = await newPdf.save()
        const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)

        const link = document.createElement('a')
        link.href = url
        link.download = `${baseName}-trimmed.pdf`
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
        URL.revokeObjectURL(url)
      } else {
        // Has cuts - split into multiple PDFs with deletions/rotations applied
        // Build ranges from cut points (based on active pages only)
        const sortedCuts = [...cutPoints].sort((a, b) => a - b)
        const ranges: number[][] = []
        let currentRange: number[] = []

        for (const pageNum of activePageNums) {
          currentRange.push(pageNum)
          if (sortedCuts.includes(pageNum)) {
            ranges.push([...currentRange])
            currentRange = []
          }
        }
        if (currentRange.length > 0) {
          ranges.push(currentRange)
        }

        for (let i = 0; i < ranges.length; i++) {
          const rangePages = ranges[i]
          if (rangePages.length === 0) continue

          const newPdf = await PDFDocument.create()
          const pageIndices = rangePages.map(p => p - 1)
          const pages = await newPdf.copyPages(sourcePdf, pageIndices)

          pages.forEach((page, idx) => {
            const originalPageNum = rangePages[idx]
            const rotation = rotations.get(originalPageNum) || 0
            if (rotation !== 0) {
              page.setRotation(degrees(rotation))
            }
            newPdf.addPage(page)
          })

          const pdfBytes = await newPdf.save()
          const blob = new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' })
          const url = URL.createObjectURL(blob)

          const link = document.createElement('a')
          link.href = url
          link.download = `${baseName}-part${i + 1}.pdf`
          document.body.appendChild(link)
          link.click()
          document.body.removeChild(link)
          URL.revokeObjectURL(url)

          if (i < ranges.length - 1) {
            await new Promise((resolve) => setTimeout(resolve, 300))
          }
        }
      }

      setTimeout(() => {
        setTrimFile(null)
        setCutPoints([])
        setDeletedPages(new Set())
        setRotations(new Map())
        setIsProcessing(false)
      }, 1000)
    } catch {
      setError('Failed to process PDF. File may be corrupted or encrypted.')
      setIsProcessing(false)
    }
  }, [trimFile, cutPoints, deletedPages, rotations, hasModifications])

  const removeTrimFile = () => {
    setTrimFile(null)
    setCutPoints([])
    setDeletedPages(new Set())
    setRotations(new Map())
    setError(null)
  }

  // Get part number for a page (for visual grouping)
  const getPartForPage = (pageNum: number): number => {
    let part = 1
    for (const cut of cutPoints) {
      if (pageNum > cut) part++
    }
    return part
  }

  // Lightbox keyboard navigation
  useEffect(() => {
    if (viewerPage === null || !trimFile) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setViewerPage(null)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault()
        setViewerPage((prev) =>
          prev !== null && prev < trimFile.pageCount ? prev + 1 : prev
        )
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault()
        setViewerPage((prev) => (prev !== null && prev > 1 ? prev - 1 : prev))
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [viewerPage, trimFile])

  // Scroll thumbnail into view when navigating in lightbox
  useEffect(() => {
    if (viewerPage === null) return
    const thumbnailEl = thumbnailRefs.current.get(viewerPage)
    if (thumbnailEl) {
      thumbnailEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' })
    }
  }, [viewerPage])

  // SHARED DRAG HANDLERS
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current++
    if (e.dataTransfer.types.includes('Files')) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    dragCounterRef.current--
    if (dragCounterRef.current === 0) {
      setIsDragging(false)
    }
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    dragCounterRef.current = 0

    if (mode === 'merge') {
      if (files.length >= MAX_FILES) {
        setError('Maximum 5 files allowed')
        return
      }
      if (e.dataTransfer.files?.length) {
        addFiles(e.dataTransfer.files)
      }
    } else {
      if (trimFile) {
        setError('Remove current file first')
        return
      }
      if (e.dataTransfer.files?.length) {
        addTrimFile(e.dataTransfer.files)
      }
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      if (mode === 'merge') {
        addFiles(e.target.files)
      } else {
        addTrimFile(e.target.files)
      }
    }
    e.target.value = ''
  }

  const totalPages = files.reduce((sum, f) => sum + (f.pageCount || 0), 0)
  const isDropDisabled = mode === 'merge' ? files.length >= MAX_FILES : !!trimFile || isLoadingThumbnails

  return (
    <main className={styles.main}>
      <div className={styles.container}>
        {/* Header */}
        <header className={styles.header}>
          <motion.div
            className={styles.logo}
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          >
            <span className={styles.logoIcon}>&#9638;</span>
            <h1>PAPER MILL</h1>
          </motion.div>
          <motion.p
            className={styles.tagline}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.6 }}
          >
            PDF TOOLS — NO UPLOADS — NO WATERMARKS
          </motion.p>
        </header>

        {/* Mode Toggle */}
        <motion.div
          className={styles.modeToggle}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
        >
          <button
            className={`${styles.modeButton} ${mode === 'merge' ? styles.modeButtonActive : ''}`}
            onClick={() => handleModeChange('merge')}
          >
            <span className={styles.modeIcon}>&#10697;</span>
            MERGE
          </button>
          <button
            className={`${styles.modeButton} ${mode === 'trim' ? styles.modeButtonActive : ''}`}
            onClick={() => handleModeChange('trim')}
          >
            <span className={styles.modeIcon}>&#9986;</span>
            TRIM
          </button>
        </motion.div>

        {/* Drop Zone */}
        <motion.div
          className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ''} ${
            isDropDisabled ? styles.dropZoneFull : ''
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => !isDropDisabled && fileInputRef.current?.click()}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          key={mode}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple={mode === 'merge'}
            onChange={handleFileInput}
            className={styles.fileInput}
            disabled={isDropDisabled}
          />

          <div className={styles.dropContent}>
            <div className={styles.dropIcon}>
              {isLoadingThumbnails ? (
                <span className={styles.dropIconLoading}>&#8987;</span>
              ) : isDropDisabled ? (
                <span>&#10003;</span>
              ) : isDragging ? (
                <span className={styles.dropIconActive}>&#8675;</span>
              ) : mode === 'merge' ? (
                <span>&#9744;</span>
              ) : (
                <span>&#9986;</span>
              )}
            </div>
            <p className={styles.dropText}>
              {isLoadingThumbnails
                ? 'GENERATING PREVIEWS...'
                : isDropDisabled
                ? mode === 'merge' ? 'MAXIMUM FILES REACHED' : 'FILE LOADED'
                : isDragging
                ? 'RELEASE TO ADD'
                : mode === 'merge'
                ? 'DROP PDFs HERE OR CLICK'
                : 'DROP A PDF TO TRIM'}
            </p>
            <p className={styles.dropSubtext}>
              {mode === 'merge'
                ? `${files.length}/${MAX_FILES} FILES — REORDER THEN MERGE`
                : trimFile
                ? `${trimFile.pageCount} PAGES`
                : 'ROTATE • DELETE • SPLIT'}
            </p>
          </div>

          {/* Corner decorations */}
          <div className={`${styles.corner} ${styles.cornerTL}`} />
          <div className={`${styles.corner} ${styles.cornerTR}`} />
          <div className={`${styles.corner} ${styles.cornerBL}`} />
          <div className={`${styles.corner} ${styles.cornerBR}`} />
        </motion.div>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div
              className={styles.error}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
            >
              <span className={styles.errorIcon}>!</span> {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* MERGE MODE: File List */}
        <AnimatePresence>
          {mode === 'merge' && files.length > 0 && (
            <motion.div
              className={styles.fileSection}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className={styles.fileSectionHeader}>
                <span>DOCUMENTS IN QUEUE</span>
                <span className={styles.pageCount}>{totalPages} PAGES TOTAL</span>
              </div>

              <Reorder.Group
                axis="y"
                values={files}
                onReorder={setFiles}
                className={styles.fileList}
              >
                {files.map((pdfFile, index) => (
                  <Reorder.Item
                    key={pdfFile.id}
                    value={pdfFile}
                    className={styles.fileCard}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 20, transition: { duration: 0.2 } }}
                    transition={{ delay: index * 0.05 }}
                    whileDrag={{ scale: 1.02, boxShadow: '0 8px 30px rgba(74, 63, 53, 0.3)' }}
                  >
                    <div className={styles.fileIndex}>
                      {String(index + 1).padStart(2, '0')}
                    </div>
                    <div className={styles.fileInfo}>
                      <span className={styles.fileName}>{pdfFile.name}</span>
                      <span className={styles.filePages}>
                        {pdfFile.pageCount !== null
                          ? `${pdfFile.pageCount} page${pdfFile.pageCount !== 1 ? 's' : ''}`
                          : 'Loading...'}
                      </span>
                    </div>
                    <div className={styles.fileDrag}>&#9776;</div>
                    <button
                      className={styles.fileRemove}
                      onClick={(e) => {
                        e.stopPropagation()
                        removeFile(pdfFile.id)
                      }}
                      aria-label="Remove file"
                    >
                      &times;
                    </button>
                  </Reorder.Item>
                ))}
              </Reorder.Group>

              {files.length >= 2 && (
                <motion.button
                  className={styles.mergeButton}
                  onClick={mergePDFs}
                  disabled={isMerging}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                >
                  <span className={styles.mergeButtonIcon}>&#10697;</span>
                  MERGE {files.length} FILES INTO ONE
                </motion.button>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* TRIM MODE: Contact Sheet with Thumbnails */}
        <AnimatePresence>
          {mode === 'trim' && trimFile && (
            <motion.div
              className={styles.fileSection}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className={styles.fileSectionHeader}>
                <span>{trimFile.name}</span>
                <button className={styles.removeFileBtn} onClick={removeTrimFile}>
                  REMOVE
                </button>
              </div>

              {/* Trim options helper text */}
              <div className={styles.trimHelp}>
                <span className={styles.trimHelpItem}>
                  <span className={styles.trimHelpIcon}>&#8635;</span> ROTATE
                </span>
                <span className={styles.trimHelpItem}>
                  <span className={styles.trimHelpIcon}>&times;</span> DELETE
                </span>
                <span className={styles.trimHelpItem}>
                  <span className={styles.trimHelpIcon}>✂</span> SPLIT
                </span>
              </div>

              {/* Contact Sheet */}
              <div className={styles.contactSheet}>
                <div className={styles.contactSheetHeader}>
                  <span>PROOF SHEET</span>
                  <span>{trimFile.pageCount - deletedPages.size} / {trimFile.pageCount} PAGES</span>
                </div>

                <div className={styles.thumbnailContainer}>
                  {trimFile.thumbnails.map((thumb, idx) => {
                    const partNum = getPartForPage(thumb.pageNum)
                    const isDeleted = deletedPages.has(thumb.pageNum)
                    const rotation = rotations.get(thumb.pageNum) || 0

                    return (
                      <div
                        key={thumb.pageNum}
                        className={`${styles.thumbnailWrapper} ${
                          viewerPage === thumb.pageNum ? styles.thumbnailWrapperActive : ''
                        }`}
                        ref={(el) => {
                          if (el) thumbnailRefs.current.set(thumb.pageNum, el)
                        }}
                      >
                        <motion.div
                          className={`${styles.thumbnail} ${
                            cutPoints.length > 0 && !isDeleted ? styles[`part${partNum}`] || '' : ''
                          } ${isDeleted ? styles.thumbnailDeleted : ''}`}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: idx * 0.03 }}
                          whileHover={{ scale: isDeleted ? 1 : 1.05, zIndex: 10 }}
                          onClick={() => !isDeleted && setViewerPage(thumb.pageNum)}
                          role="button"
                          tabIndex={isDeleted ? -1 : 0}
                          onKeyDown={(e) => e.key === 'Enter' && !isDeleted && setViewerPage(thumb.pageNum)}
                        >
                          <img
                            src={thumb.dataUrl}
                            alt={`Page ${thumb.pageNum}`}
                            className={styles.thumbnailImage}
                            style={{ transform: `rotate(${rotation}deg)` }}
                          />
                          <div className={styles.thumbnailNumber}>{thumb.pageNum}</div>
                          {cutPoints.length > 0 && !isDeleted && (
                            <div className={styles.thumbnailPart}>P{partNum}</div>
                          )}
                          {rotation !== 0 && (
                            <div className={styles.thumbnailRotation}>{rotation}°</div>
                          )}
                          {!isDeleted && <div className={styles.thumbnailZoom}>&#128269;</div>}
                          {isDeleted && <div className={styles.thumbnailDeletedOverlay}>DELETED</div>}

                          {/* Action buttons */}
                          <div className={styles.thumbnailActions}>
                            <button
                              className={styles.thumbnailActionBtn}
                              onClick={(e) => {
                                e.stopPropagation()
                                rotatePage(thumb.pageNum)
                              }}
                              title="Rotate 90°"
                            >
                              &#8635;
                            </button>
                            <button
                              className={`${styles.thumbnailActionBtn} ${styles.thumbnailActionDelete} ${
                                isDeleted ? styles.thumbnailActionDeleteActive : ''
                              }`}
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleDeletePage(thumb.pageNum)
                              }}
                              title={isDeleted ? 'Restore page' : 'Delete page'}
                            >
                              {isDeleted ? '↩' : '×'}
                            </button>
                          </div>
                        </motion.div>

                        {/* Cut line after each page (except last) */}
                        {idx < trimFile.thumbnails.length - 1 && (
                          <button
                            className={`${styles.cutLine} ${
                              cutPoints.includes(thumb.pageNum) ? styles.cutLineActive : ''
                            } ${isDeleted ? styles.cutLineDisabled : ''}`}
                            onClick={() => !isDeleted && toggleCutPoint(thumb.pageNum)}
                            disabled={isDeleted}
                            title={
                              isDeleted
                                ? 'Cannot cut after deleted page'
                                : cutPoints.includes(thumb.pageNum)
                                ? `Remove cut after page ${thumb.pageNum}`
                                : `Cut after page ${thumb.pageNum}`
                            }
                          >
                            <span className={styles.cutLineIcon}>
                              {cutPoints.includes(thumb.pageNum) ? '✂' : '+'}
                            </span>
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Summary and action button */}
              {hasModifications && (
                <motion.div
                  className={styles.splitSummary}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  {/* Modification summary */}
                  <div className={styles.modificationSummary}>
                    {deletedPages.size > 0 && (
                      <span className={styles.modBadge}>
                        {deletedPages.size} PAGE{deletedPages.size > 1 ? 'S' : ''} DELETED
                      </span>
                    )}
                    {rotations.size > 0 && (
                      <span className={styles.modBadge}>
                        {rotations.size} PAGE{rotations.size > 1 ? 'S' : ''} ROTATED
                      </span>
                    )}
                  </div>

                  {/* Split parts preview */}
                  {cutPoints.length > 0 && (
                    <div className={styles.splitParts}>
                      {(() => {
                        const activePages = Array.from({ length: trimFile.pageCount }, (_, i) => i + 1)
                          .filter(p => !deletedPages.has(p))
                        const sortedCuts = [...cutPoints].sort((a, b) => a - b)
                        const ranges: string[] = []
                        let currentRange: number[] = []

                        for (const pageNum of activePages) {
                          currentRange.push(pageNum)
                          if (sortedCuts.includes(pageNum)) {
                            if (currentRange.length > 0) {
                              ranges.push(currentRange.length === 1
                                ? `${currentRange[0]}`
                                : `${currentRange[0]}–${currentRange[currentRange.length - 1]}`)
                            }
                            currentRange = []
                          }
                        }
                        if (currentRange.length > 0) {
                          ranges.push(currentRange.length === 1
                            ? `${currentRange[0]}`
                            : `${currentRange[0]}–${currentRange[currentRange.length - 1]}`)
                        }

                        return ranges.map((range, idx) => (
                          <span key={idx} className={styles.partBadge}>
                            PART {idx + 1}: {range}
                          </span>
                        ))
                      })()}
                    </div>
                  )}

                  <motion.button
                    className={styles.splitButton}
                    onClick={processTrim}
                    disabled={isProcessing}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <span className={styles.splitButtonIcon}>
                      {cutPoints.length > 0 ? '✂' : '↓'}
                    </span>
                    {cutPoints.length > 0
                      ? `SPLIT INTO ${cutPoints.length + 1} FILES`
                      : 'DOWNLOAD TRIMMED PDF'}
                  </motion.button>
                </motion.div>
              )}

              {!hasModifications && (
                <div className={styles.cutHint}>
                  <span>&#9758;</span> HOVER PAGES TO ROTATE OR DELETE • CLICK BETWEEN TO SPLIT
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Processing Status */}
        <AnimatePresence>
          {(isMerging || isProcessing) && (
            <motion.div
              className={styles.merging}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <div className={styles.mergingStamp}>
                <span>{isMerging ? 'MERGING' : 'PROCESSING'}</span>
                <div className={styles.mergingDots}>
                  <span>.</span><span>.</span><span>.</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Light Table Viewer */}
        <AnimatePresence>
          {viewerPage !== null && trimFile && (
            <motion.div
              className={styles.lightbox}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setViewerPage(null)}
            >
              <motion.div
                className={styles.lightboxContent}
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                exit={{ scale: 0.8, opacity: 0 }}
                transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                onClick={(e) => e.stopPropagation()}
              >
                {/* Header */}
                <div className={styles.lightboxHeader}>
                  <div className={styles.lightboxTitle}>
                    <span className={styles.lightboxIcon}>&#9638;</span>
                    LIGHT TABLE
                  </div>
                  <button
                    className={styles.lightboxClose}
                    onClick={() => setViewerPage(null)}
                    aria-label="Close viewer"
                  >
                    &times;
                  </button>
                </div>

                {/* Image Container */}
                <div className={styles.lightboxImageContainer}>
                  <img
                    key={viewerPage}
                    src={trimFile.thumbnails[viewerPage - 1]?.dataUrl}
                    alt={`Page ${viewerPage}`}
                    className={styles.lightboxImage}
                    style={{ transform: `rotate(${rotations.get(viewerPage) || 0}deg)` }}
                  />
                  {deletedPages.has(viewerPage) && (
                    <div className={styles.lightboxDeletedOverlay}>DELETED</div>
                  )}
                </div>

                {/* Page Actions */}
                <div className={styles.lightboxActions}>
                  <button
                    className={styles.lightboxActionBtn}
                    onClick={() => rotatePage(viewerPage)}
                    title="Rotate 90°"
                  >
                    &#8635; ROTATE
                  </button>
                  <button
                    className={`${styles.lightboxActionBtn} ${
                      deletedPages.has(viewerPage) ? styles.lightboxActionBtnActive : ''
                    }`}
                    onClick={() => toggleDeletePage(viewerPage)}
                    title={deletedPages.has(viewerPage) ? 'Restore page' : 'Delete page'}
                  >
                    {deletedPages.has(viewerPage) ? '↩ RESTORE' : '× DELETE'}
                  </button>
                </div>

                {/* Navigation */}
                <div className={styles.lightboxNav}>
                  <button
                    className={styles.lightboxNavBtn}
                    onClick={() => setViewerPage((p) => (p && p > 1 ? p - 1 : p))}
                    disabled={viewerPage <= 1}
                  >
                    &#9664; PREV
                  </button>

                  <div className={styles.lightboxInfo}>
                    <span className={styles.lightboxPage}>
                      PAGE {viewerPage} OF {trimFile.pageCount}
                    </span>
                    {cutPoints.length > 0 && !deletedPages.has(viewerPage) && (
                      <span className={styles.lightboxPart}>
                        PART {getPartForPage(viewerPage)}
                      </span>
                    )}
                  </div>

                  <button
                    className={styles.lightboxNavBtn}
                    onClick={() =>
                      setViewerPage((p) =>
                        p && p < trimFile.pageCount ? p + 1 : p
                      )
                    }
                    disabled={viewerPage >= trimFile.pageCount}
                  >
                    NEXT &#9654;
                  </button>
                </div>

                {/* Cut Controls */}
                <div className={styles.lightboxCuts}>
                  <button
                    className={`${styles.lightboxCutBtn} ${
                      cutPoints.includes(viewerPage - 1) ? styles.lightboxCutBtnActive : ''
                    }`}
                    onClick={() => toggleCutPoint(viewerPage - 1)}
                    disabled={viewerPage <= 1 || deletedPages.has(viewerPage - 1)}
                    title={
                      cutPoints.includes(viewerPage - 1)
                        ? `Remove cut before page ${viewerPage}`
                        : `Add cut before page ${viewerPage}`
                    }
                  >
                    {cutPoints.includes(viewerPage - 1) ? '✂ REMOVE' : '✂ CUT'} BEFORE
                  </button>

                  <span className={styles.lightboxCutDivider}>|</span>

                  <button
                    className={`${styles.lightboxCutBtn} ${
                      cutPoints.includes(viewerPage) ? styles.lightboxCutBtnActive : ''
                    }`}
                    onClick={() => toggleCutPoint(viewerPage)}
                    disabled={viewerPage >= trimFile.pageCount || deletedPages.has(viewerPage)}
                    title={
                      cutPoints.includes(viewerPage)
                        ? `Remove cut after page ${viewerPage}`
                        : `Add cut after page ${viewerPage}`
                    }
                  >
                    {cutPoints.includes(viewerPage) ? '✂ REMOVE' : '✂ CUT'} AFTER
                  </button>
                </div>

                {/* Keyboard hint */}
                <div className={styles.lightboxHint}>
                  ARROWS TO NAVIGATE • ESC TO CLOSE
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Footer */}
        <footer className={styles.footer}>
          <p>ALL PROCESSING HAPPENS IN YOUR BROWSER</p>
          <p className={styles.footerSub}>YOUR FILES NEVER LEAVE YOUR DEVICE</p>
        </footer>
      </div>
    </main>
  )
}
