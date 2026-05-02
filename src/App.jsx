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
  const previewRef = useRef(null)
  const [annotations, setAnnotations] = useState({}) // { [index]: label }
  const basePath = import.meta.env.BASE_URL || '/'

  function assetPathForLabel(label) {
    if (label === '求') return `${basePath}heart_request.png`
    if (label === undefined || label === 0 || label === '') return null
    return `${basePath}${label}.png`
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.crossOrigin = 'anonymous'
      img.onload = () => resolve(img)
      img.onerror = reject
      img.src = src
    })
  }

  function incrementLabel(index) {
    setAnnotations((prev) => {
      const cur = prev[index]
      // if current is '求', + resets to 0
      if (cur === '求') {
        return { ...prev, [index]: 0 }
      }
      const num = typeof cur === 'number' ? cur : (cur ? Number(cur) : 0)
      const next = Math.min(10, (Number.isFinite(num) ? num : 0) + 1)
      return { ...prev, [index]: next }
    })
  }

  function decrementLabel(index) {
    setAnnotations((prev) => {
      const cur = prev[index]
      if (cur === '求') {
        return prev // no change
      }
      const num = typeof cur === 'number' ? cur : (cur ? Number(cur) : 0)
      if (!Number.isFinite(num)) {
        return prev
      }
      if (num > 0) {
        return { ...prev, [index]: Math.max(0, num - 1) }
      }
      // num === 0 and user pressed -, switch to '求'
      return { ...prev, [index]: '求' }
    })
  }

  async function downloadAnnotatedImage() {
    if (!previewUrl || !workerResult) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.src = previewUrl
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej })

    const canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const ctx = canvas.getContext('2d')
    ctx.drawImage(img, 0, 0)

    // 描画スタイル
    ctx.lineWidth = Math.max(2, Math.round(canvas.width / 300))
    ctx.strokeStyle = 'red'
    ctx.fillStyle = 'red'
    const fontSize = Math.max(12, Math.round(canvas.width / 40))
    ctx.font = `${fontSize}px sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    const detections = (workerResult.detections || [])
    for (let index = 0; index < detections.length; index += 1) {
      const d = detections[index]
      const x = (d.xPercent / 100) * canvas.width
      const y = (d.yPercent / 100) * canvas.height
      const w = (d.widthPercent / 100) * canvas.width
      const h = (d.heightPercent / 100) * canvas.height

      // ユーザ注釈があれば枠の下端を基準に画像で描画
      const label = annotations[index]
      const asset = assetPathForLabel(label)
      if (asset) {
        try {
          const imgIcon = await loadImage(asset)
          const cx = x + w / 2
          // サイズは枠横幅の60%
          const size =  w * 0.6
          const half = size / 2
          // 枠の下端を基準に少し下に置く
          const drawY = y + h - half - 4
          // 下にはみ出す場合は上に置く
          // const drawY = (preferredY + half > canvas.height) ? (y - half - 4) : preferredY
          ctx.drawImage(imgIcon, cx - size / 2, drawY - size / 2, size, size)
        } catch (err) {
          // 画像ロード失敗時は文字で代替
          const cx = x + w / 2
          let cy = y + h + Math.max(fontSize, 12) + 4
          if (cy + Math.max(fontSize, 12) > canvas.height) cy = y - Math.max(fontSize, 12) - 4
          ctx.fillStyle = 'red'
          ctx.fillText(String(label), cx, cy)
          ctx.fillStyle = 'red'
        }
      }
    }

    canvas.toBlob((blob) => {
      if (!blob) return
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `annotated-${file?.name || 'image'}`
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
    }, 'image/png')
  }

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
        <div className="mt-4 rounded-xl border border-slate-200 bg-pink-100 p-4">
          <div className="grid gap-4 sm:grid-cols-[1.2fr_0.8fr] sm:items-center">
            <p className="text-center text-sm leading-6 text-slate-600 sm:text-left">
              OFFICIAL SHOPの画像は画質が低く処理できません。<br/>
              NEWSページや公式Xの投稿から取得できる右図のような画像をアップロードしてください。<br/>
              なお，画質が低すぎると正しく処理できない場合があります。
            </p>
            <div className="flex justify-center sm:justify-end h-80">
              <img
                src={`${basePath}upload_sample.jpg`}
                alt="処理例の画像"
                className="block rounded-lg border border-slate-200 bg-white object-contain p-2 shadow-sm sm:h-full"
              />
            </div>
          </div>
        </div>

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
                <p className="text-xs text-slate-500">
                  赤枠は検出された領域を示しています。<br/>
                  枠内に表示された +/- ボタンでラベルを付けることができます。<br/>
                  「-」ボタンで「求」、「+」ボタンで「1」〜「10」を選択できます。<br/>
                  ラベルを付けた画像は「画像をダウンロード」ボタンから保存できます。
                </p>
              </div>
              <div className="flex items-center gap-2">
                <p className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">{workerResult.detections?.length || 0} 枠</p>
                <button onClick={downloadAnnotatedImage} className="rounded-md bg-slate-900 px-3 py-1 text-sm font-semibold text-white">画像をダウンロード</button>
              </div>
            </div>

            <div ref={previewRef} className="relative overflow-hidden rounded-lg border border-slate-300 bg-white">
              <img
                src={previewUrl}
                alt="アップロード画像のプレビュー"
                className="block h-auto w-full"
              />

              <div className="absolute inset-0">
                {workerResult.detections?.map((detection, index) => (
                  <div
                    key={`${detection.x}-${detection.y}-${index}`}
                    className="absolute cursor-pointer border-2 border-red-500 bg-red-500/10 z-10"
                    style={{
                      left: `${detection.xPercent}%`,
                      top: `${detection.yPercent}%`,
                      width: `${detection.widthPercent}%`,
                      height: `${detection.heightPercent}%`,
                    }}
                  >
                    {/* left-top の番号は表示しない */}

                    {/* 選択済みラベルを表示（枠の中心上に） */}
                    {annotations[index] !== undefined && annotations[index] !== 0 && (
                      <div
                        style={{ left: '50%', top: `${detection.yPercent + detection.heightPercent}%`, transform: 'translate(-50%,-50%)' }}
                        className="absolute"
                      >
                        <div className="flex h-6 w-6 items-center justify-center rounded-full">
                          {(() => {
                            const asset = assetPathForLabel(annotations[index])
                            return asset ? (
                              <img
                                src={asset}
                                alt={String(annotations[index])}
                                className="object-contain"
                                style={{ width: `${detection.widthPercent * 0.6}%`, height: `${detection.widthPercent * 0.6}%` }}
                              />
                            ) : null
                          })()}
                        </div>
                      </div>
                    )}

                    {/* -/+ コントロール（枠の右下） */}
                    <div className="absolute right-1 bottom-1 flex flex-col items-center gap-1 bg-white/80 rounded">
                      <button onClick={(e) => { e.stopPropagation(); incrementLabel(index) }} className="text-xs px-2 py-0.5">+</button>
                      <div className="text-xs font-medium px-1">{(() => {
                        const asset = assetPathForLabel(annotations[index])
                        return asset ? <img src={asset} alt={String(annotations[index])} className="h-4 w-4 object-contain" /> : ''
                      })()}</div>
                      <button onClick={(e) => { e.stopPropagation(); decrementLabel(index) }} className="text-xs px-2 py-0.5">−</button>
                    </div>
                  </div>
                ))}
              </div>
              {/* 背景クリック（何もしない） */}
              <div className="absolute inset-0 z-0" />
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
