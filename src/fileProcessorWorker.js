
// OpenCV 初期化状態
let cvReady = false
let cvReadyPromise = null
let basePath = '/'
const PHOTO_ASPECT_RATIO = 89 / 127
const ASPECT_TOLERANCE = 0.1

// OpenCV をローカルからロード
function loadOpenCv() {
  if (cvReadyPromise) return cvReadyPromise

  cvReadyPromise = new Promise((resolve, reject) => {
    if (typeof cv !== 'undefined' && cv.getBuildInformation) {
      cvReady = true
      resolve()
      return
    }

    // ローカルの OpenCV.js をロード（base パスを考慮）
    const cvPath = basePath.endsWith('/') 
      ? `${basePath}opencv.js`
      : `${basePath}/opencv.js`

    fetch(cvPath)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch OpenCV from ${cvPath}: ${response.status} ${response.statusText}`)
        }
        return response.text()
      })
      .then(code => {
        // Worker 環境で eval を実行
        eval(code)

        // 初期化完了を待つ
        const checkInterval = setInterval(() => {
          if (typeof cv !== 'undefined' && cv.getBuildInformation) {
            clearInterval(checkInterval)
            cvReady = true
            resolve()
          }
        }, 100)

        // タイムアウト設定
        setTimeout(() => {
          clearInterval(checkInterval)
          reject(new Error('OpenCV initialization timeout'))
        }, 30000)
      })
      .catch(reject)
  })

  return cvReadyPromise
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

function arrayBufferToBase64(arrayBuffer) {
  let binary = ''
  const bytes = new Uint8Array(arrayBuffer)
  const chunkSize = 0x8000

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }

  return btoa(binary)
}

async function matToDebugStage(mat, name) {
  let rgba = new cv.Mat()

  if (mat.type() === cv.CV_8UC1) {
    cv.cvtColor(mat, rgba, cv.COLOR_GRAY2RGBA)
  } else if (mat.type() === cv.CV_8UC3) {
    cv.cvtColor(mat, rgba, cv.COLOR_RGB2RGBA)
  } else if (mat.type() === cv.CV_8UC4) {
    rgba = mat.clone()
  } else {
    throw new Error(`Unsupported Mat type for debug export: ${mat.type()}`)
  }

  const pixels = new Uint8ClampedArray(rgba.data.length)
  pixels.set(rgba.data)
  const imageData = new ImageData(pixels, rgba.cols, rgba.rows)
  const canvas = new OffscreenCanvas(rgba.cols, rgba.rows)
  const context = canvas.getContext('2d')
  context.putImageData(imageData, 0, 0)

  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const dataUrl = `data:image/png;base64,${arrayBufferToBase64(await blob.arrayBuffer())}`
  rgba.delete()

  return {
    name,
    width: mat.cols,
    height: mat.rows,
    dataUrl,
  }
}

function dedupeDetections(detections) {
  const sortedDetections = [...detections].sort((first, second) => second.width * second.height - first.width * first.height)
  const pickedDetections = []

  for (const detection of sortedDetections) {
    const overlapsPicked = pickedDetections.some((pickedDetection) => {
      const left = Math.max(detection.x, pickedDetection.x)
      const top = Math.max(detection.y, pickedDetection.y)
      const right = Math.min(detection.x + detection.width, pickedDetection.x + pickedDetection.width)
      const bottom = Math.min(detection.y + detection.height, pickedDetection.y + pickedDetection.height)
      const intersectionWidth = Math.max(0, right - left)
      const intersectionHeight = Math.max(0, bottom - top)
      const intersectionArea = intersectionWidth * intersectionHeight
      const detectionArea = detection.width * detection.height
      const pickedArea = pickedDetection.width * pickedDetection.height
      const unionArea = detectionArea + pickedArea - intersectionArea

      return unionArea > 0 && intersectionArea / unionArea > 0.5
    })

    if (!overlapsPicked) {
      pickedDetections.push(detection)
    }
  }

  return pickedDetections.sort((first, second) => first.y - second.y || first.x - second.x)
}

function detectRectsFromMask(mask, imageWidth, imageHeight) {
  const labels = new cv.Mat()
  const stats = new cv.Mat()
  const centroids = new cv.Mat()
  const componentCount = cv.connectedComponentsWithStats(mask, labels, stats, centroids, 8, cv.CV_32S)
  const imageArea = imageWidth * imageHeight
  const detections = []

  for (let label = 1; label < componentCount; label += 1) {
    const statOffset = label * stats.cols
    const left = stats.data32S[statOffset + cv.CC_STAT_LEFT]
    const top = stats.data32S[statOffset + cv.CC_STAT_TOP]
    const width = stats.data32S[statOffset + cv.CC_STAT_WIDTH]
    const height = stats.data32S[statOffset + cv.CC_STAT_HEIGHT]
    const area = stats.data32S[statOffset + cv.CC_STAT_AREA]

    const aspectRatio = height > 0 ? width / height : 0
    const rectangleArea = width * height

    if (area < imageArea * 0.001) {
      continue
    }

    if (rectangleArea < imageArea * 0.005 || rectangleArea > imageArea * 0.2) {
      continue
    }

    if (!isPhotoAspectRatio(width, height)) {
      continue
    }

    detections.push(
      normalizeRectangle(
        {
          x: left,
          y: top,
          width,
          height,
        },
        imageWidth,
        imageHeight,
      ),
    )
  }

  labels.delete()
  stats.delete()
  centroids.delete()

  return {
    componentCount,
    detections: dedupeDetections(detections),
  }
}

// 画像処理：グレースケール変換と輝度計算
async function processImageWithOpenCv(file) {
  // ① 画像を読み込み、OpenCVで扱える形に変換する
  const bitmap = await createImageBitmap(file)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

  try {
    // ② グレースケール化 → ぼかし → エッジ検出 → 膨張/クローズでマスクを作る
    let src = cv.matFromImageData(imageData)
    let gray = new cv.Mat()
    let blurred = new cv.Mat()
    let edges = new cv.Mat()
    const debugStages = []

    // RGBA → グレースケール変換
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)
    debugStages.push(await matToDebugStage(src, '01-original-rgba'))
    debugStages.push(await matToDebugStage(gray, '02-grayscale'))

    // cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT)
    // debugStages.push(await matToDebugStage(blurred, '03-gaussian-blur'))

    // cv.Canny(blurred, edges, 30, 100)
    cv.Canny(gray, edges, 30, 100)
    debugStages.push(await matToDebugStage(edges, '04-canny-edges'))

    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(7, 7))
    if (bitmap.width * bitmap.height > 400 * 400) {
        cv.dilate(edges, edges, kernel)
        debugStages.push(await matToDebugStage(edges, '05-dilate'))
    }
    if (bitmap.width * bitmap.height > 1000 * 1000) {
        cv.morphologyEx(edges, edges, cv.MORPH_CLOSE, kernel)
        debugStages.push(await matToDebugStage(edges, '06-close-mask'))
    }

    kernel.delete()

    // ③ 画像の基本指標を計算する
    let mean = cv.mean(gray)
    const meanBrightness = mean[0]

    // ④ 連結成分から候補枠を抽出する
    let meanMat = new cv.Mat()
    let stddevMat = new cv.Mat()
    cv.meanStdDev(gray, meanMat, stddevMat)
    const stdDev = stddevMat.data64F[0]
    const edgePixelCount = cv.countNonZero(edges)
    const detectionResult = detectRectsFromMask(edges, bitmap.width, bitmap.height)

    src.delete()
    gray.delete()
    blurred.delete()
    edges.delete()
    meanMat.delete()
    stddevMat.delete()
    bitmap.close()

    // ⑤ 結果をまとめて返す
    return {
      meanBrightness: Math.round(meanBrightness * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
      edgePixelCount,
      componentCount: detectionResult.componentCount,
      detections: detectionResult.detections,
      debugStages,
      processedBy: 'opencv-advanced',
    }
  } catch (error) {
    bitmap.close()
    throw error
  }
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
      // ③ 画像ならプレビューサイズを取得して、必要ならOpenCVで詳細処理する
      const bitmap = await createImageBitmap(file)
      result.width = bitmap.width
      result.height = bitmap.height
      bitmap.close()

      // OpenCV が利用可能な場合は詳細処理を実行
      try {
        await loadOpenCv()
        const cvResult = await processImageWithOpenCv(file)
        result.meanBrightness = cvResult.meanBrightness
        result.stdDev = cvResult.stdDev
        result.edgePixelCount = cvResult.edgePixelCount
        result.componentCount = cvResult.componentCount
        result.debugStages = cvResult.debugStages
        result.detections = cvResult.detections
        result.processedBy = cvResult.processedBy
      } catch (cvError) {
        // OpenCV 処理に失敗しても基本メタデータは返す
        console.warn('OpenCV processing failed, using basic metadata', cvError)
        result.processedBy = 'basic-bitmap'
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