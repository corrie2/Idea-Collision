import { useState, useRef, useCallback } from 'react'
import { uploadPdfs } from '../api/client'

export default function PdfUploader({ onSessionCreated }) {
  const [dragOver, setDragOver] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null) // { session_id, files: [...] }
  const fileInputRef = useRef(null)

  const handleFiles = useCallback(async (fileList) => {
    const pdfFiles = Array.from(fileList).filter(f => f.type === 'application/pdf')
    if (pdfFiles.length === 0) {
      setError('请选择 PDF 文件')
      return
    }

    setUploading(true)
    setError('')

    try {
      const data = await uploadPdfs(pdfFiles)
      setResult(data)
      onSessionCreated?.(data.session_id, data.files)
    } catch (err) {
      setError(err.message || '上传失败')
    } finally {
      setUploading(false)
    }
  }, [onSessionCreated])

  const onDrop = useCallback((e) => {
    e.preventDefault()
    setDragOver(false)
    handleFiles(e.dataTransfer.files)
  }, [handleFiles])

  const onDragOver = useCallback((e) => {
    e.preventDefault()
    setDragOver(true)
  }, [])

  const onDragLeave = useCallback(() => {
    setDragOver(false)
  }, [])

  const handleInputChange = useCallback((e) => {
    if (e.target.files.length > 0) {
      handleFiles(e.target.files)
    }
  }, [handleFiles])

  const handleReset = useCallback(() => {
    setResult(null)
    setError('')
    if (fileInputRef.current) fileInputRef.current.value = ''
    onSessionCreated?.(null, null)
  }, [onSessionCreated])

  return (
    <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-gray-800">
           PDF 知识注入
          <span className="ml-2 text-xs font-normal text-gray-400">可选</span>
        </h2>
        {result && (
          <button
            onClick={handleReset}
            className="text-xs text-gray-400 hover:text-gray-600 cursor-pointer transition-colors"
          >
            清除
          </button>
        )}
      </div>

      {!result ? (
        <>
          {/* Drop zone */}
          <div
            onDrop={onDrop}
            onDragOver={onDragOver}
            onDragLeave={onDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`
              relative rounded-xl border-2 border-dashed p-8 text-center cursor-pointer transition-all duration-200
              ${dragOver
                ? 'border-amber-400 bg-amber-50'
                : 'border-gray-200 hover:border-amber-300 hover:bg-gray-50'
              }
            `}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf"
              multiple
              onChange={handleInputChange}
              className="hidden"
            />
            {uploading ? (
              <div className="flex flex-col items-center gap-2">
                <div className="w-8 h-8 border-2 border-amber-200 border-t-amber-500 rounded-full animate-spin" />
                <p className="text-sm text-gray-500">正在解析 PDF...</p>
              </div>
            ) : (
              <>
                <p className="text-2xl mb-2"></p>
                <p className="text-sm text-gray-600 font-medium">
                  拖拽 PDF 到此处，或点击选择文件
                </p>
                <p className="text-xs text-gray-400 mt-1">
                  支持同时上传多个 PDF 文件
                </p>
              </>
            )}
          </div>

          {error && (
            <p className="mt-2 text-sm text-red-500">{error}</p>
          )}
        </>
      ) : (
        /* Upload results */
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-50 rounded-lg px-3 py-2">
            <span></span>
            <span>{result.files.length} 个文件已解析，共 {result.files.reduce((s, f) => s + f.pages, 0)} 页</span>
          </div>

          <div className="space-y-2">
            {result.files.map((file, idx) => (
              <div
                key={idx}
                className="rounded-lg border border-gray-100 bg-gray-50 p-3"
              >
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-gray-800 truncate">
                     {file.filename}
                  </p>
                  <span className="text-xs text-gray-400 shrink-0 ml-2">
                    {file.pages} 页 · {file.chunks_stored} 块
                  </span>
                </div>
                {file.text_preview && (
                  <p className="text-xs text-gray-400 mt-1.5 line-clamp-2 leading-relaxed">
                    {file.text_preview}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
