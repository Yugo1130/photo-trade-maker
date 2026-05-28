import { useEffect, useMemo, useRef, useState } from 'react'

// ファイルが画像かどうかを判定する関数
const isAllowedFile = (file) => {
  if (!file) {
    return false
  }

  return file.type.startsWith('image/')
}

const modules = import.meta.glob('/src/assets/samples/*', {
  eager: true,
  import: 'default'
})

const images = Object.values(modules)

const emojiOptions = ['💖', '❤', '🩷', '🧡', '💛', '💚', '💙', '🩵', '⭐', '🌟', '✖', '🙏']

function takeFirstGrapheme(text) {
  const normalized = String(text ?? '').trim()
  if (!normalized) {
    return ''
  }

  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' })
    const iterator = segmenter.segment(normalized)[Symbol.iterator]()
    const first = iterator.next()
    return first.value?.segment || ''
  }

  return Array.from(normalized)[0] || ''
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
  const imgPreviewRef = useRef(null)
  const [annotations, setAnnotations] = useState({}) // { [index]: label }
  const [selectedIndex, setSelectedIndex] = useState(null)
  const [activeTool, setActiveTool] = useState('req')
  const [customStampText, setCustomStampText] = useState(null)
  const basePath = import.meta.env.BASE_URL || '/'

  function assetPathForLabel(label) {
    if (label === 'req') return `${basePath}heart_request.png`
    else if (label === 'del') return `${basePath}eraser.png`
    else if (label === '+1') return `${basePath}+1.png`
    else if (label === '−1') return `${basePath}-1.png`
    else if (label === '1') return `${basePath}1.png`
    else if (label === '2') return `${basePath}2.png`
    else if (label === '3') return `${basePath}3.png`
    else if (label === '4') return `${basePath}4.png`
    else if (label === '5') return `${basePath}5.png`
    else if (label === '6') return `${basePath}6.png`
    else if (label === '7') return `${basePath}7.png`
    else if (label === '8') return `${basePath}8.png`
    else if (label === '9') return `${basePath}9.png`
    else if (label === '10') return `${basePath}10.png`
    else if (label === 'download') return `${basePath}download.png`
    else if (label === undefined || label === 0 || label === '') return null
    return null
  }

  function getStampRenderInfo(label) {
    const asset = assetPathForLabel(label)
    if (asset) {
      return { kind: 'image', asset }
    }
    if (label === undefined || label === 0 || label === '') {
      return null
    }
    return { kind: 'text', text: String(label) }
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

  // プレビュー上でラベルを描画するためのスタイルを計算（ピクセルベースで位置とサイズを決定）
  function labelStyleForDetection(detection) {
    const img = imgPreviewRef.current
    if (!img) {
      return { left: '50%', top: '100%', transform: 'translate(-50%,-50%)' }
    }
    const imgW = img.clientWidth
    const imgH = img.clientHeight
    const x = (detection.xPercent / 100) * imgW
    const y = (detection.yPercent / 100) * imgH
    const w = (detection.widthPercent / 100) * imgW
    const h = (detection.heightPercent / 100) * imgH

    const size = Math.round(w * 0.6)
    const cx = Math.round(x + w / 2)
    const half = size / 2
    const drawY = Math.round(y + h - half - 4)

    return {
      left: `${cx}px`,
      top: `${drawY}px`,
      transform: 'translate(-50%,-50%)',
      width: `${size}px`,
      height: `${size}px`,
      fontSize: `${Math.max(16, Math.round(size * 0.8))}px`,
    }
  }

  function incrementLabel(index) {
    setAnnotations((prev) => {
      const cur = prev[index]
      // if current is 'req' (special stamp), + resets to '1'
      if (cur === 'req') {
        return { ...prev, [index]: '1' }
      }
      const num = typeof cur === 'number' ? cur : (cur ? Number(cur) : 0)
      const base = Number.isFinite(num) ? num : 0
      const next = Math.min(10, base + 1)
      return { ...prev, [index]: String(next) }
    })
  }

  function decrementLabel(index) {
    setAnnotations((prev) => {
      const cur = prev[index]
      if (cur === 'req') {
        return prev // no change
      }
      const num = typeof cur === 'number' ? cur : (cur ? Number(cur) : NaN)
      if (!Number.isFinite(num)) {
        return prev
      }
      if (num > 1) {
        return { ...prev, [index]: String(Math.max(1, num - 1)) }
      }
      // num === 1 or 0 の時はラベル削除
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  // 選択中インデックスのラベルを 'req' にセット
  function setSelectedToRequest(index) {
    setAnnotations((prev) => {
      return { ...prev, [index]: 'req' }
    })
  }

  function applyCustomStampToIndex(index) {
    setAnnotations((prev) => {
      return { ...prev, [index]: customStampText }
    })
  }

  // 選択中インデックスのラベルを削除
  function deleteSelectedLabel(index) {
    setAnnotations((prev) => {
      const next = { ...prev }
      delete next[index]
      return next
    })
  }

  async function downloadAnnotatedImage() {
    // Google Analytics イベントトラッキング
    window.gtag?.('event', 'download_image', {
      event_category: 'file',
      event_label: file?.name || 'generated_image',
      value: workerResult?.detections?.length || 0
    })

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
      const stamp = getStampRenderInfo(label)
      if (stamp?.kind === 'image') {
        try {
          const imgIcon = await loadImage(stamp.asset)
          const cx = x + w / 2
          // サイズは枠横幅の60%
          const size = w * 0.6
          const half = size / 2
          // 枠の下端を基準に少し下に置く
          const drawY = y + h - half - 4
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
      } else if (stamp?.kind === 'text') {
        const size = Math.max(18, Math.round(w * 0.6))
        const cx = x + w / 2
        const cy = y + h - size / 2 - 4
        ctx.font = `${size}px sans-serif`
        ctx.fillStyle = 'black'
        ctx.fillText(stamp.text, cx, cy)
        ctx.fillStyle = 'red'
        ctx.font = `${fontSize}px sans-serif`
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

  // 画面が描画された後に実行する処理（依存配列が空なので最初の1回だけ実行される）
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
        setWorkerStatus(null)
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

  // file stateが更新されるたびに実行される処理
  useEffect(() => {
    if (!file) {
      setWorkerResult(null)
      setPreviewUrl('')
      setWorkerStatus(null)
      setAnnotations({})
      setSelectedIndex(null)
      return
    }

    const nextPreviewUrl = URL.createObjectURL(file)
    setPreviewUrl(nextPreviewUrl)
    setWorkerResult(null)
    setAnnotations({})
    setSelectedIndex(null)
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

  // ファイル検証，file state更新
  const updateSelectedFile = (incomingFile) => {
    if (!incomingFile) {
      return
    }

    if (!isAllowedFile(incomingFile)) {
      setError('画像ファイルのみ追加できます')
      return
    }

    // 400×400ピクセル以上の画像のみ許可
    if (incomingFile.type.startsWith('image/')) {
      const img = new Image()
      img.onload = () => {
        if (img.width < 400 || img.height < 400) {
          setError('400×400ピクセル以上の画像をアップロードしてください')
          return
        }
        setFile(incomingFile)
        setError('')
      }
      img.onerror = () => {
        setError('画像の読み込みに失敗しました')
      }
      img.src = URL.createObjectURL(incomingFile)
      return
    }

    setFile(incomingFile)
    setError('')
  }

  // ファイル選択ボタンからの入力変更イベント
  const handleInputChange = (event) => {
    updateSelectedFile(event.target.files?.[0])
    event.target.value = ''
  }

  // ドラッグオーバーイベント
  const handleDragOver = (event) => {
    event.preventDefault()
    setIsDragging(true)
  }

  // ドラッグリーブイベント
  const handleDragLeave = (event) => {
    event.preventDefault()
    setIsDragging(false)
  }

  // ファイルのドラッグ&ドロップイベント
  const handleDrop = (event) => {
    event.preventDefault()
    setIsDragging(false)
    updateSelectedFile(event.dataTransfer.files?.[0])
  }

  return (
    <main className="min-h-screen bg-slate-50 pb-28">
      <header className="w-full bg-[linear-gradient(90deg,#f4b7cf_0%,#f4b7cf_20%,#a9dbe6_40%,#a9dbe6_60%,#f3e19f_80%,#f3e19f_100%)] p-[10px] text-white">
        <div className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-8">
          <h1 className="mt-2 text-2xl md:text-3xl font-bold text-white">トレード画像作成ツール</h1>
        </div>
      </header>
      <section className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-8">
        <h2 className="text-2xl font-bold text-slate-900">ファイルアップロード</h2>
        <p className="mt-2 text-sm text-slate-600">
          ドラッグ&ドロップまたはボタンから選択してください。<br />
          400×400ピクセル以上の画像をアップロードしてください。<br />
        </p>
        <div className="mt-4 rounded-xl border border-slate-200 bg-pink-100 p-4">
          <p className="text-sm mb-4 text-center sm:text-left">
            以下のような背景が白色の画像に対応しています。
          </p>

          <div className="overflow-x-auto pb-2">
            <div className="flex w-max flex-nowrap gap-4">
              {images.map((src, i) => (
                <img
                  key={i}
                  src={src}
                  alt={`sample-${i}`}
                  className="h-48 object-contain rounded-lg border border-slate-200 bg-white p-2 shadow-sm"
                />
              ))}
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
            className="mt-4 inline-flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-400"
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
                  赤枠は検出された領域を示しています。（ダウンロードした画像には表示されません。）<br />
                  ラベルを付けた画像は右下のダウンロードボタンから保存できます。
                </p>
              </div>
              {(workerResult?.detections?.length || 0) === 0
                ? <p className="rounded-full bg-red-50 px-3 py-1 text-xs font-semibold text-red-700">検出失敗</p>
                : <p className="rounded-full bg-green-50 px-3 py-1 text-xs font-semibold text-green-700">検出成功</p>}
            </div>

            <div ref={previewRef} className="relative overflow-hidden rounded-lg border border-slate-300 bg-white">
              <img
                ref={imgPreviewRef}
                src={previewUrl}
                alt="アップロード画像のプレビュー"
                className="block h-auto w-full"
              />

              {/* 検出された領域を表示 */}
              <div className="absolute inset-0">
                {workerResult.detections?.map((detection, index) => (
                  <div
                    key={`${detection.x}-${detection.y}-${index}`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setSelectedIndex(index)
                      if (activeTool === 'inc') {
                        incrementLabel(index)
                        return
                      }
                      if (activeTool === 'dec') {
                        decrementLabel(index)
                        return
                      }
                      if (activeTool === 'req') {
                        setSelectedToRequest(index)
                        return
                      }
                      if (activeTool === 'text') {
                        applyCustomStampToIndex(index)
                        return
                      }
                      if (activeTool === 'del') {
                        deleteSelectedLabel(index)
                        return
                      }
                    }}
                    className={'absolute cursor-pointer z-10 border-2 border-red-500 bg-red-500/10'}
                    style={{
                      left: `${detection.xPercent}%`,
                      top: `${detection.yPercent}%`,
                      width: `${detection.widthPercent}%`,
                      height: `${detection.heightPercent}%`,
                    }}
                  >
                    {/* inline controls removed — use bottom control panel (tool first, then tap image) */}
                  </div>
                ))}
              </div>

              {/* ラベルはプレビュー全体に対してピクセル位置で描画（クリック可能） */}
              <div className="absolute inset-0 pointer-events-none">
                {workerResult.detections?.map((detection, index) => {
                  if (annotations[index] === undefined || annotations[index] === 0) return null
                  const style = labelStyleForDetection(detection)
                  const stamp = getStampRenderInfo(annotations[index])
                  return (
                    <button
                      key={`label-${index}`}
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setSelectedIndex(index) }}
                      className="absolute pointer-events-auto"
                      style={style}
                      aria-pressed={selectedIndex === index}
                    >
                      {stamp?.kind === 'image' ? (
                        <img src={stamp.asset} alt={String(annotations[index])} style={{ width: '100%', height: '100%', display: 'block' }} />
                      ) : stamp?.kind === 'text' ? (
                        <span className="flex h-full w-full items-center justify-center leading-none text-black" style={{ fontSize: style.fontSize }}>
                          {stamp.text}
                        </span>
                      ) : null}
                    </button>
                  )
                })}
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

      </section>

      {/* 固定操作パネル（フッター風） */}
      <div className="fixed bottom-4 left-1/2 z-50 w-full max-w-2xl -translate-x-1/2 px-4">
        <div className="rounded-xl bg-white/95 backdrop-blur-sm border border-slate-200 shadow-md p-3">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setActiveTool('req')}
              className={`rounded-md px-3 py-1 text-sm font-semibold ${activeTool === 'req' ? 'bg-slate-300 text-slate-900' : ''}`}
              aria-label="ツール: 求"
            >
              <img src={assetPathForLabel('req')} alt="求ラベル" className="h-8 w-8 object-contain" />
            </button>

            <button
              type="button"
              onClick={() => setActiveTool('inc')}
              className={`rounded-md px-3 py-1 text-sm font-semibold ${activeTool === 'inc' ? 'bg-slate-300 text-slate-900' : ''}`}
              aria-label="ツール: +1"
            >
              <img src={assetPathForLabel('+1')} alt="+1ラベル" className="h-8 w-8 object-contain" />
            </button>

            <button
              type="button"
              onClick={() => setActiveTool('dec')}
              className={`rounded-md px-3 py-1 text-sm font-semibold ${activeTool === 'dec' ? 'bg-slate-300 text-slate-900' : ''}`}
              aria-label="ツール: −1"
            >
              <img src={assetPathForLabel('−1')} alt="−1ラベル" className="h-8 w-8 object-contain" />
            </button>

            <button
              type="button"
              onClick={() => setActiveTool('del')}
              className={`rounded-md px-3 py-1 text-sm font-semibold ${activeTool === 'del' ? 'bg-slate-200 text-red-800' : ''}`}
              aria-label="ツール: ラベル削除"
            >
              <img src={assetPathForLabel('del')} alt="削除ラベル" className="h-8 w-8 object-contain" />
            </button>

            <button
              onClick={downloadAnnotatedImage}
              className="ml-auto w-auto rounded-md px-3 py-1 text-sm font-semibold text-white text-center hover:bg-blue-400"
            >
              <img src={assetPathForLabel('download')} alt="ダウンロード " className="h-8 w-8 object-contain" />
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
            <div className="flex gap-1 overflow-x-auto">
              {emojiOptions.map((emoji) => (
                <button
                  key={emoji}
                  type="button"
                  onClick={() => {
                    setActiveTool('text')
                    setCustomStampText(emoji)
                  }}
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-lg transition ${customStampText === emoji ? 'border-slate-400 bg-slate-200' : 'border-slate-200 bg-white hover:bg-slate-100'}`}
                  aria-label={`絵文字 ${emoji}`}
                  aria-pressed={customStampText === emoji}
                >
                  {emoji}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </main>
  )
}

export default App
