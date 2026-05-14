
// OpenCV 初期化状態
let cvReady = false
let cvReadyPromise = null
let basePath = '/'
const PHOTO_ASPECT_RATIO = 89 / 127
const ASPECT_TOLERANCE = 0.3

// 白い列や行を連続した範囲にまとめるための関数
function groupContinuousLines(lines) {
  if (lines.length === 0) return []

  const groups = []
  let start = lines[0]
  let prev = lines[0]

  for (let i = 1; i < lines.length; i++) {
    if (lines[i] !== prev + 1) { // 連続していない場合はグループを作成
      groups.push({ start, end: prev })
      start = lines[i]
    }
    prev = lines[i]
  }

  groups.push({ start, end: prev })
  return groups
}


function normalizeRectangle(rect, imageWidth, imageHeight) {
  return {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    xPercent: (rect.x / imageWidth) * 100,
    yPercent: (rect.y / imageHeight) * 100,
    widthPercent: (rect.width / imageWidth) * 100,
    heightPercent: (rect.height / imageHeight) * 100,
  }
}

function isPhotoAspectRatio(width, height) {
  if (!width || !height) {
    return false
  }

  const ratio = width / height
  const portraitDiff = Math.abs(ratio - PHOTO_ASPECT_RATIO)
  const landscapeDiff = Math.abs(ratio - (1 / PHOTO_ASPECT_RATIO))

  return portraitDiff <= ASPECT_TOLERANCE || landscapeDiff <= ASPECT_TOLERANCE
}


async function processImage(file) {
  // 画像を読み込み、ビットマップに変換する
  const bitmap = await createImageBitmap(file)
  // OffscreenCanvasを使って作業領域を作る
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  // ビットマップをキャンバスに描画する
  ctx.drawImage(bitmap, 0, 0)

  // 画像データを取得して、ピクセル単位で処理する
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)
  const data = imageData.data


  console.log('Image dimensions:', bitmap.width, bitmap.height)

  const result = {
    width: bitmap.width,
    height: bitmap.height
  }

  const whilecols = []
  const whilerows = []

  // 縦方向の各列を走査して、白いピクセルの割合が高い列を検出する
  for (let x = 0; x < bitmap.width; x++) {
    let whitePixelCount = 0

    for (let y = 0; y < bitmap.height; y++) {

      const index = (y * bitmap.width + x) * 4
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]

      if (r >= 250 && g >= 250 && b >= 250) {
        whitePixelCount++
      }
    }

    if (whitePixelCount / bitmap.height >= 0.7) {
      whilecols.push(x)
    }
  }

  // 横方向の各行を走査して、白いピクセルの割合が高い行を検出する
  for (let y = 0; y < bitmap.height; y++) {
    let whitePixelCount = 0

    for (let x = 0; x < bitmap.width; x++) {
      const index = (y * bitmap.width + x) * 4
      const r = data[index]
      const g = data[index + 1]
      const b = data[index + 2]

      if (r >= 250 && g >= 250 && b >= 250) {
        whitePixelCount++
      }
    }

    if (whitePixelCount / bitmap.width >= 0.8) {
      whilerows.push(y)
    }
  }

  const colGroups = groupContinuousLines(whilecols)
  const rowGroups = groupContinuousLines(whilerows)

  const detections = []

  for (let i = 0; i < rowGroups.length - 1; i++) {
    for (let j = 0; j < colGroups.length - 1; j++) {

      const top = rowGroups[i].end
      const bottom = rowGroups[i + 1].start

      const left = colGroups[j].end
      const right = colGroups[j + 1].start

      const width = right - left
      const height = bottom - top

      // 小さいノイズ除外
      if (width < 10 || height < 10) continue

      if (!isPhotoAspectRatio(width, height)) continue

      detections.push({
        x: left,
        y: top,
        width,
        height
      })
    }
  }

  result.detections = detections.map(rect =>
    normalizeRectangle(rect, bitmap.width, bitmap.height)
  )
  bitmap.close()
  return result
}


self.onmessage = async (event) => {
  const { type, file, basePath: incomingBasePath } = event.data || {}

  // 初期化メッセージを処理
  if (type === 'init') {
    if (incomingBasePath) {
      basePath = incomingBasePath
    }
    return
  }

  if (type !== 'process-file') {
    return
  }

  try {
    // ① 処理開始を通知する
    self.postMessage({ type: 'processing' })

    if (!(file instanceof File)) {
      throw new Error('有効なファイルが渡されていません')
    }

    // ② まずはファイルのメタデータを作る
    const buffer = await file.arrayBuffer()
    const result = {
      name: file.name,
      mimeType: file.type,
      byteLength: buffer.byteLength,
      width: null,
      height: null,
      meanBrightness: null,
      stdDev: null,
      edgePixelCount: null,
      componentCount: null,
      debugStages: [],
      detections: [],
      processedBy: 'metadata-only',
    }

    if (file.type.startsWith('image/')) {
      // 画像ならプレビューサイズを取得して、必要ならOpenCVで詳細処理する
      const bitmap = await createImageBitmap(file)
      result.width = bitmap.width
      result.height = bitmap.height
      bitmap.close()

      // OpenCV が利用可能な場合は詳細処理を実行
      try {
        // await loadOpenCv()
        // const cvResult = await processImageWithOpenCv(file)
        // result.meanBrightness = cvResult.meanBrightness
        // result.stdDev = cvResult.stdDev
        // result.edgePixelCount = cvResult.edgePixelCount
        // result.componentCount = cvResult.componentCount
        // result.debugStages = cvResult.debugStages
        // result.detections = cvResult.detections
        // result.processedBy = cvResult.processedBy
        const imgProcessResult = await processImage(file)
        result.detections = imgProcessResult.detections
      } catch (cvError) {
        // OpenCV 処理に失敗しても基本メタデータは返す
        console.warn('OpenCV processing failed, using basic metadata', cvError)
      }
    }

    // ④ UIへ結果を返す
    self.postMessage({
      type: 'processed',
      payload: result,
    })
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : 'Workerで不明なエラーが発生しました',
    })
  }
}