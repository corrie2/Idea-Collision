import { useState, useEffect, useRef } from 'react'
import { getMaterials, uploadMaterials, deleteMaterial, previewMaterial } from '../api/client'

export default function MaterialsPage() {
  const [materials, setMaterials] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInputRef = useRef(null)

  useEffect(() => {
    loadMaterials()
  }, [])

  async function loadMaterials() {
    setLoading(true)
    try {
      const data = await getMaterials()
      setMaterials(data.materials || [])
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  async function handleUpload(files) {
    if (!files || files.length === 0) return
    setUploading(true)
    setError('')
    try {
      await uploadMaterials(files)
      await loadMaterials()
    } catch (err) {
      setError(err.message)
    } finally {
      setUploading(false)
    }
  }

  function handleDrop(e) {
    e.preventDefault()
    setDragOver(false)
    const files = Array.from(e.dataTransfer.files)
    handleUpload(files)
  }

  function handleDragOver(e) {
    e.preventDefault()
    setDragOver(true)
  }

  function handleDragLeave(e) {
    e.preventDefault()
    setDragOver(false)
  }

  async function handlePreview(id) {
    try {
      const data = await previewMaterial(id)
      setPreview(data)
    } catch (err) {
      setError(err.message)
    }
  }

  async function handleDelete(id) {
    try {
      await deleteMaterial(id)
      setMaterials(prev => prev.filter(m => m.id !== id))
      setConfirmDelete(null)
    } catch (err) {
      setError(err.message)
    }
  }

  function formatTime(iso) {
    if (!iso) return ''
    const d = new Date(iso)
    return d.toLocaleDateString('zh-CN', {
      month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
    })
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">📦 素材库</h1>
          <p className="text-sm text-gray-500 mt-1">管理你的文件素材，在碰撞时附加参考</p>
        </div>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="px-4 py-2 bg-amber-500 text-white text-sm font-medium rounded-xl
                     hover:bg-amber-600 active:bg-amber-700 disabled:opacity-40
                     transition-all duration-200 cursor-pointer"
        >
          {uploading ? '上传中...' : '上传新文件'}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.md,.doc,.docx"
          className="hidden"
          onChange={(e) => handleUpload(Array.from(e.target.files))}
        />
      </div>

      {/* Drop Zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`
          border-2 border-dashed rounded-2xl p-8 text-center transition-all duration-200
          ${dragOver
            ? 'border-amber-400 bg-amber-50'
            : 'border-gray-200 bg-gray-50/50 hover:border-gray-300'
          }
        `}
      >
        <p className="text-gray-400 text-sm">
          {dragOver ? '松开鼠标上传文件' : '拖拽文件到此处上传'}
        </p>
        <p className="text-gray-300 text-xs mt-1">支持 PDF、TXT、MD、DOC 格式</p>
      </div>

      {error && (
        <p className="text-sm text-red-500 px-1">{error}</p>
      )}

      {/* Materials List */}
      {loading ? (
        <div className="text-center py-12 text-gray-400 text-sm">加载中...</div>
      ) : materials.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-gray-400 text-sm">还没有上传任何文件</p>
          <p className="text-gray-300 text-xs mt-1">上传文件后可在碰撞时作为参考素材</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {materials.map((m) => (
            <div
              key={m.id}
              className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-all duration-200"
            >
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                  <span className="text-lg">📄</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {m.filename}
                  </p>
                  <p className="text-xs text-gray-400 mt-1">
                    {m.pages > 0 && `${m.pages} 页 · `}
                    {m.chunks_stored > 0 && `${m.chunks_stored} 块 · `}
                    {m.text_length > 0 && `${(m.text_length / 1000).toFixed(1)}k 字符`}
                  </p>
                  <p className="text-xs text-gray-300 mt-0.5">
                    {formatTime(m.uploaded_at)}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3 pt-3 border-t border-gray-50">
                <button
                  onClick={() => handlePreview(m.id)}
                  className="flex-1 text-xs text-gray-500 hover:text-amber-600 py-1.5 rounded-lg
                             hover:bg-amber-50 transition-all cursor-pointer"
                >
                  预览
                </button>
                <span className="text-gray-200">|</span>
                <button
                  onClick={() => setConfirmDelete(m.id)}
                  className="flex-1 text-xs text-gray-500 hover:text-red-500 py-1.5 rounded-lg
                             hover:bg-red-50 transition-all cursor-pointer"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      {preview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setPreview(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full mx-4 max-h-[70vh] overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800 truncate">
                📄 {preview.filename}
              </h3>
              <button
                onClick={() => setPreview(null)}
                className="text-gray-400 hover:text-gray-600 cursor-pointer text-lg"
              >
                ✕
              </button>
            </div>
            <div className="px-6 py-4 overflow-y-auto max-h-[55vh]">
              <pre className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed font-mono">
                {preview.text_preview}
              </pre>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirm Modal */}
      {confirmDelete && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setConfirmDelete(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-gray-800 font-medium">确定删除此素材？</p>
            <p className="text-xs text-gray-400 mt-1">删除后不可恢复</p>
            <div className="flex items-center gap-3 mt-4">
              <button
                onClick={() => setConfirmDelete(null)}
                className="flex-1 px-4 py-2 text-sm text-gray-600 bg-gray-100 rounded-xl
                           hover:bg-gray-200 transition-all cursor-pointer"
              >
                取消
              </button>
              <button
                onClick={() => handleDelete(confirmDelete)}
                className="flex-1 px-4 py-2 text-sm text-white bg-red-500 rounded-xl
                           hover:bg-red-600 transition-all cursor-pointer"
              >
                删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
