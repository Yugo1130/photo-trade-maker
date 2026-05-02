import { useRef, useState } from 'react'

const isAllowedFile = (file) => {
  if (!file) {
    return false
  }

  return file.type.startsWith('image/')
}

function App() {
  const inputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')

  const updateSelectedFile = (incomingFile) => {
    if (!incomingFile) {
      return
    }

    if (!isAllowedFile(incomingFile)) {
      setError('画像ファイルのみ追加できます')
      return
    }

    setFile(incomingFile)
    setError('')
  }

  const handleInputChange = (event) => {
    updateSelectedFile(event.target.files?.[0])
    event.target.value = ''
  }

  const handleDragOver = (event) => {
    event.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (event) => {
    event.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (event) => {
    event.preventDefault()
    setIsDragging(false)
    updateSelectedFile(event.dataTransfer.files?.[0])
  }

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10">
      <section className="mx-auto w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-6 shadow-sm sm:p-8">
        <h1 className="text-2xl font-bold text-slate-900">ファイルアップロード</h1>
        <p className="mt-2 text-sm text-slate-600">
          ドラッグ&ドロップまたはボタンから選択してください。
        </p>

        <input
          ref={inputRef}
          id="file-input"
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleInputChange}
        />

        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`mt-6 rounded-xl border-2 border-dashed p-8 text-center transition ${
            isDragging
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-slate-300 bg-slate-50 text-slate-700'
          }`}
        >
          <p className="text-sm font-medium">ここに画像ファイルをドラッグ&ドロップ</p>
          <p className="mt-1 text-xs text-slate-500">対応形式: 画像ファイル</p>

          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="mt-4 inline-flex items-center rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-700"
          >
            ファイルを選択
          </button>
        </div>

        {error ? (
          <p className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <div className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
          {file ? (
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-slate-800">{file.name}</p>
                <p className="text-xs text-slate-500">{Math.round(file.size / 1024)} KB</p>
              </div>
              <button
                type="button"
                onClick={() => setFile(null)}
                className="rounded-md px-2 py-1 text-xs font-semibold text-red-600 hover:bg-red-50"
              >
                クリア
              </button>
            </div>
          ) : (
            <p className="text-sm text-slate-500">まだファイルは選択されていません</p>
          )}
        </div>
      </section>
    </main>
  )
}

export default App
