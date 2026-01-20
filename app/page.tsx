'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { PDFDocument } from 'pdf-lib'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import * as pdfjsLib from 'pdfjs-dist'
import styles from './page.module.css'

// Set up PDF.js worker
if (typeof window !== 'undefined') {
  pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`
}

type Mode = 'merge' | 'split'

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

interface SplitFile {
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

  // Split mode state
  const [splitFile, setSplitFile] = useState<SplitFile | null>(null)
  const [cutPoints, setCutPoints] = useState<number[]>([])
  const [isSplitting, setIsSplitting] = useState(false)
  const [isLoadingThumbnails, setIsLoadingThumbnails] = useState(false)

  // Shared state
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

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
    setSplitFile(null)
    setCutPoints([])
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

  // SPLIT MODE FUNCTIONS
  const addSplitFile = useCallback(async (newFiles: FileList | File[]) => {
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

    if (pageCount < 2) {
      setError('PDF must have at least 2 pages to split')
      return
    }

    setIsLoadingThumbnails(true)

    try {
      const thumbnails = await generateThumbnails(file)
      setSplitFile({ file, name: file.name, pageCount, thumbnails })
      setCutPoints([])
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

  const splitPDF = useCallback(async () => {
    if (!splitFile || cutPoints.length === 0) return

    setIsSplitting(true)
    setError(null)

    try {
      const arrayBuffer = await splitFile.file.arrayBuffer()
      const sourcePdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })

      const ranges: [number, number][] = []
      let start = 0
      for (const cut of cutPoints) {
        ranges.push([start, cut])
        start = cut
      }
      ranges.push([start, splitFile.pageCount])

      const baseName = splitFile.name.replace(/\.pdf$/i, '')

      for (let i = 0; i < ranges.length; i++) {
        const [rangeStart, rangeEnd] = ranges[i]
        const newPdf = await PDFDocument.create()
        const pageIndices = Array.from(
          { length: rangeEnd - rangeStart },
          (_, idx) => rangeStart + idx
        )
        const pages = await newPdf.copyPages(sourcePdf, pageIndices)
        pages.forEach((page) => newPdf.addPage(page))

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

      setTimeout(() => {
        setSplitFile(null)
        setCutPoints([])
        setIsSplitting(false)
      }, 1000)
    } catch {
      setError('Failed to split PDF. File may be corrupted or encrypted.')
      setIsSplitting(false)
    }
  }, [splitFile, cutPoints])

  const removeSplitFile = () => {
    setSplitFile(null)
    setCutPoints([])
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
      if (splitFile) {
        setError('Remove current file first')
        return
      }
      if (e.dataTransfer.files?.length) {
        addSplitFile(e.dataTransfer.files)
      }
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      if (mode === 'merge') {
        addFiles(e.target.files)
      } else {
        addSplitFile(e.target.files)
      }
    }
    e.target.value = ''
  }

  const totalPages = files.reduce((sum, f) => sum + (f.pageCount || 0), 0)
  const isDropDisabled = mode === 'merge' ? files.length >= MAX_FILES : !!splitFile || isLoadingThumbnails

  // Group thumbnails by rows for cut point insertion
  const getThumbnailRows = () => {
    if (!splitFile) return []
    const rows: PageThumbnail[][] = []
    const perRow = 4
    for (let i = 0; i < splitFile.thumbnails.length; i += perRow) {
      rows.push(splitFile.thumbnails.slice(i, i + perRow))
    }
    return rows
  }

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
            className={`${styles.modeButton} ${mode === 'split' ? styles.modeButtonActive : ''}`}
            onClick={() => handleModeChange('split')}
          >
            <span className={styles.modeIcon}>&#9986;</span>
            SPLIT
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
                : 'DROP A PDF TO SPLIT'}
            </p>
            <p className={styles.dropSubtext}>
              {mode === 'merge'
                ? `${files.length}/${MAX_FILES} FILES — REORDER THEN MERGE`
                : splitFile
                ? `${splitFile.pageCount} PAGES — CLICK BETWEEN PAGES TO CUT`
                : 'SINGLE PDF — UP TO 5 PARTS'}
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

        {/* SPLIT MODE: Contact Sheet with Thumbnails */}
        <AnimatePresence>
          {mode === 'split' && splitFile && (
            <motion.div
              className={styles.fileSection}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <div className={styles.fileSectionHeader}>
                <span>{splitFile.name}</span>
                <button className={styles.removeFileBtn} onClick={removeSplitFile}>
                  REMOVE
                </button>
              </div>

              {/* Contact Sheet */}
              <div className={styles.contactSheet}>
                <div className={styles.contactSheetHeader}>
                  <span>PROOF SHEET</span>
                  <span>{splitFile.pageCount} PAGES</span>
                </div>

                <div className={styles.thumbnailContainer}>
                  {splitFile.thumbnails.map((thumb, idx) => {
                    const isLastInRow = (idx + 1) % 4 === 0 || idx === splitFile.thumbnails.length - 1
                    const rowEndPage = Math.min(Math.ceil((idx + 1) / 4) * 4, splitFile.pageCount)
                    const showCutLine = isLastInRow && rowEndPage < splitFile.pageCount
                    const partNum = getPartForPage(thumb.pageNum)

                    return (
                      <div key={thumb.pageNum} className={styles.thumbnailWrapper}>
                        <motion.div
                          className={`${styles.thumbnail} ${
                            cutPoints.length > 0 ? styles[`part${partNum}`] || '' : ''
                          }`}
                          initial={{ opacity: 0, scale: 0.9 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: idx * 0.03 }}
                          whileHover={{ scale: 1.05, zIndex: 10 }}
                        >
                          <img
                            src={thumb.dataUrl}
                            alt={`Page ${thumb.pageNum}`}
                            className={styles.thumbnailImage}
                          />
                          <div className={styles.thumbnailNumber}>{thumb.pageNum}</div>
                          {cutPoints.length > 0 && (
                            <div className={styles.thumbnailPart}>P{partNum}</div>
                          )}
                        </motion.div>

                        {/* Cut line after each page (except last) */}
                        {idx < splitFile.thumbnails.length - 1 && (
                          <button
                            className={`${styles.cutLine} ${
                              cutPoints.includes(thumb.pageNum) ? styles.cutLineActive : ''
                            }`}
                            onClick={() => toggleCutPoint(thumb.pageNum)}
                            title={
                              cutPoints.includes(thumb.pageNum)
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

              {/* Split summary and button */}
              {cutPoints.length > 0 && (
                <motion.div
                  className={styles.splitSummary}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className={styles.splitParts}>
                    {(() => {
                      const ranges: string[] = []
                      let start = 1
                      for (const cut of cutPoints) {
                        ranges.push(`${start}–${cut}`)
                        start = cut + 1
                      }
                      ranges.push(`${start}–${splitFile.pageCount}`)
                      return ranges.map((range, idx) => (
                        <span key={idx} className={styles.partBadge}>
                          PART {idx + 1}: {range}
                        </span>
                      ))
                    })()}
                  </div>

                  <motion.button
                    className={styles.splitButton}
                    onClick={splitPDF}
                    disabled={isSplitting}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                  >
                    <span className={styles.splitButtonIcon}>&#9986;</span>
                    SPLIT INTO {cutPoints.length + 1} FILES
                  </motion.button>
                </motion.div>
              )}

              {cutPoints.length === 0 && (
                <div className={styles.cutHint}>
                  <span>&#9758;</span> CLICK BETWEEN PAGES TO ADD CUT POINTS
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Processing Status */}
        <AnimatePresence>
          {(isMerging || isSplitting) && (
            <motion.div
              className={styles.merging}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <div className={styles.mergingStamp}>
                <span>{isMerging ? 'MERGING' : 'SPLITTING'}</span>
                <div className={styles.mergingDots}>
                  <span>.</span><span>.</span><span>.</span>
                </div>
              </div>
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
