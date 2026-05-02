import { useEffect, useMemo, useRef, useState } from 'react'

const isAllowedFile = (file) => {
  if (!file) {
    return false
  }

  return file.type.startsWith('image/')
}

function App() {
  const inputRef = useRef(null)
  const workerRef = useRef(null)
  const [file, setFile] = useState(null)
  const [previewUrl, setPreviewUrl] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [error, setError] = useState('')
  const [workerStatus, setWorkerStatus] = useState(null)
  const [workerResult, setWorkerResult] = useState(null)

  // 画面が描画された後に実行する処理
  useEffect(() => {
    // worker作成
    const worker = new Worker(new URL('./fileProcessorWorker.js', import.meta.url))

    // base パスを取得して Worker に送信
    const basePath = import.meta.env.BASE_URL || '/'
    worker.postMessage({ type: 'init', basePath })

    // workerからのメッセージを受け取る
    worker.onmessage = (event) => {
      const { type, payload, message } = event.data || {}

      if (type === 'processing') {
        setWorkerStatus('processing')
        return
      }

      if (type === 'processed') {
        setWorkerResult(payload)
        return
      }

      if (type === 'error') {
        setWorkerStatus('error')
        setError(message || '処理に失敗しました')
      }
    }

    workerRef.current = worker

    return () => {
      worker.terminate()
    }
  }, [])

  useEffect(() => {
    if (!file) {
      setWorkerResult(null)
      setPreviewUrl('')
      return
    }

    const nextPreviewUrl = URL.createObjectURL(file)
    setPreviewUrl(nextPreviewUrl)
    setWorkerResult(null)
    // workerにファイルを送信して処理を開始
    workerRef.current?.postMessage({ type: 'process-file', file })

    return () => {
      URL.revokeObjectURL(nextPreviewUrl)
    }
  }, [file])

  const formattedSize = useMemo(() => {
    if (!file) {
      return ''
    }

    return `${Math.round(file.size / 1024)} KB`
  }, [file])

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
          className={`mt-6 rounded-xl border-2 border-dashed p-8 text-center transition ${isDragging
              ? 'border-blue-500 bg-blue-50 text-blue-700'
              : 'border-slate-300 bg-slate-50 text-slate-700'
            }`}
        >
          <p className="text-sm font-medium">ここに画像ファイルをドラッグ&ドロップ</p>

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
                <p className="text-xs text-slate-500">{formattedSize}</p>
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

        {previewUrl && workerResult?.width && workerResult?.height ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-950/5 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-900">検出プレビュー</p>
                <p className="text-xs text-slate-500">
                  赤枠が検出結果です。番号を振っているので、後で個別入力に使えます。
                </p>
              </div>
              <p className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">
                {workerResult.detections?.length || 0} 枠
              </p>
            </div>

            <div className="relative overflow-hidden rounded-lg border border-slate-300 bg-white">
              <img
                src={previewUrl}
                alt="アップロード画像のプレビュー"
                className="block h-auto w-full"
              />

              <div className="pointer-events-none absolute inset-0">
                {workerResult.detections?.map((detection, index) => (
                  <div
                    key={`${detection.x}-${detection.y}-${index}`}
                    className="absolute border-2 border-red-500 bg-red-500/10"
                    style={{
                      left: `${detection.xPercent}%`,
                      top: `${detection.yPercent}%`,
                      width: `${detection.widthPercent}%`,
                      height: `${detection.heightPercent}%`,
                    }}
                  >
                    <span className="absolute left-0 top-0 flex min-w-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-red-600 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm">
                      {index + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) :
          <p className="mt-6 flex items-center gap-2 text-sm text-slate-800">
            {workerStatus === 'processing' && (
              <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-400 border-t-transparent" />
            )}
            {workerStatus === 'processing' ? '画像を処理しています...' : null}
          </p>

        }

        {/* {workerResult?.debugStages?.length ? (
          <div className="mt-4 rounded-xl border border-slate-200 bg-white p-3">
            <p className="text-sm font-semibold text-slate-900">画像処理デバッグ</p>
            <p className="mt-1 text-xs text-slate-500">
              どの段階で画像がどう変化したかを確認できます。
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {workerResult.debugStages.map((stage) => (
                <div
                  key={stage.name}
                  className="overflow-hidden rounded-lg border border-slate-200 bg-slate-50"
                >
                  <p className="border-b border-slate-200 bg-white px-2 py-1 text-[11px] font-semibold text-slate-700">
                    {stage.name}
                  </p>
                  <img
                    src={stage.dataUrl}
                    alt={stage.name}
                    className="block h-auto w-full"
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null} */}
      </section>
    </main>
  )
}

export default App
