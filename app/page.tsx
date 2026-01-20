'use client'

import { useState, useCallback, useRef, useEffect } from 'react'
import { PDFDocument } from 'pdf-lib'
import { motion, AnimatePresence, Reorder } from 'framer-motion'
import styles from './page.module.css'

interface PDFFile {
  id: string
  file: File
  name: string
  pageCount: number | null
}

export default function Home() {
  const [files, setFiles] = useState<PDFFile[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isMerging, setIsMerging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragCounterRef = useRef(0)

  const MAX_FILES = 5

  const getPageCount = async (file: File): Promise<number | null> => {
    try {
      const arrayBuffer = await file.arrayBuffer()
      const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })
      return pdf.getPageCount()
    } catch {
      return null
    }
  }

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

      // Reset after successful merge
      setTimeout(() => {
        setFiles([])
        setIsMerging(false)
      }, 1000)
    } catch (err) {
      setError('Failed to merge PDFs. Some files may be corrupted or encrypted.')
      setIsMerging(false)
    }
  }, [files])

  // Auto-merge when we have 2+ files
  useEffect(() => {
    if (files.length >= 2 && !isMerging) {
      const timer = setTimeout(() => {
        mergePDFs()
      }, 800)
      return () => clearTimeout(timer)
    }
  }, [files, isMerging, mergePDFs])

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

    if (files.length >= MAX_FILES) {
      setError('Maximum 5 files allowed')
      return
    }

    if (e.dataTransfer.files?.length) {
      addFiles(e.dataTransfer.files)
    }
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) {
      addFiles(e.target.files)
    }
    e.target.value = ''
  }

  const totalPages = files.reduce((sum, f) => sum + (f.pageCount || 0), 0)

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
            PDF MERGER — NO UPLOADS — NO WATERMARKS
          </motion.p>
        </header>

        {/* Drop Zone */}
        <motion.div
          className={`${styles.dropZone} ${isDragging ? styles.dropZoneActive : ''} ${
            files.length >= MAX_FILES ? styles.dropZoneFull : ''
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => files.length < MAX_FILES && fileInputRef.current?.click()}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.2, duration: 0.5 }}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,application/pdf"
            multiple
            onChange={handleFileInput}
            className={styles.fileInput}
            disabled={files.length >= MAX_FILES}
          />

          <div className={styles.dropContent}>
            <div className={styles.dropIcon}>
              {files.length >= MAX_FILES ? (
                <span>&#10003;</span>
              ) : isDragging ? (
                <span className={styles.dropIconActive}>&#8675;</span>
              ) : (
                <span>&#9744;</span>
              )}
            </div>
            <p className={styles.dropText}>
              {files.length >= MAX_FILES
                ? 'MAXIMUM FILES REACHED'
                : isDragging
                ? 'RELEASE TO ADD'
                : 'DROP PDFs HERE OR CLICK'}
            </p>
            <p className={styles.dropSubtext}>
              {files.length}/{MAX_FILES} FILES — AUTO-MERGES AT 2+
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

        {/* File List */}
        <AnimatePresence>
          {files.length > 0 && (
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
            </motion.div>
          )}
        </AnimatePresence>

        {/* Merging Status */}
        <AnimatePresence>
          {isMerging && (
            <motion.div
              className={styles.merging}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
            >
              <div className={styles.mergingStamp}>
                <span>MERGING</span>
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
