
// OpenCV 初期化状態
let cvReady = false
let cvReadyPromise = null
let basePath = '/'

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

// 画像処理：グレースケール変換と輝度計算
async function processImageWithOpenCv(file) {
  const bitmap = await createImageBitmap(file)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(bitmap, 0, 0)
  const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height)

  try {
    let src = cv.matFromImageData(imageData)
    let gray = new cv.Mat()

    // RGBA → グレースケール変換
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY)

    // 平均輝度を計算
    let mean = cv.mean(gray)
    const meanBrightness = mean[0]

    // 標準偏差を計算
    let meanMat = new cv.Mat()
    let stddevMat = new cv.Mat()
    cv.meanStdDev(gray, meanMat, stddevMat)
    const stdDev = stddevMat.data64F[0]

    src.delete()
    gray.delete()
    meanMat.delete()
    stddevMat.delete()
    bitmap.close()

    return {
      meanBrightness: Math.round(meanBrightness * 100) / 100,
      stdDev: Math.round(stdDev * 100) / 100,
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
    self.postMessage({ type: 'processing' })

    if (!(file instanceof File)) {
      throw new Error('有効なファイルが渡されていません')
    }

    const buffer = await file.arrayBuffer()
    const result = {
      name: file.name,
      mimeType: file.type,
      byteLength: buffer.byteLength,
      width: null,
      height: null,
      meanBrightness: null,
      stdDev: null,
      processedBy: 'metadata-only',
    }

    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file)
      result.width = bitmap.width
      result.height = bitmap.height

      // OpenCV が利用可能な場合は詳細処理を実行
      try {
        await loadOpenCv()
        const cvResult = await processImageWithOpenCv(file)
        result.meanBrightness = cvResult.meanBrightness
        result.stdDev = cvResult.stdDev
        result.processedBy = cvResult.processedBy
      } catch (cvError) {
        // OpenCV 処理に失敗しても基本メタデータは返す
        console.warn('OpenCV processing failed, using basic metadata', cvError)
        result.processedBy = 'basic-bitmap'
        bitmap.close()
      }
    }

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