import cv from '@techstark/opencv-js'

let cvReadyPromise = null

export const ensureOpenCvReady = async () => {
  if (cvReadyPromise) {
    return cvReadyPromise
  }

  cvReadyPromise = new Promise((resolve) => {
    if (cv?.Mat) {
      resolve(cv)
      return
    }

    cv.onRuntimeInitialized = () => {
      resolve(cv)
    }
  })

  return cvReadyPromise
}

export const runBasicOpenCvProcess = async (file) => {
  const bitmap = await createImageBitmap(file)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })

  if (!context) {
    bitmap.close()
    throw new Error('Worker上でCanvasコンテキストを取得できませんでした')
  }

  context.drawImage(bitmap, 0, 0)
  const imageData = context.getImageData(0, 0, bitmap.width, bitmap.height)

  const source = cv.matFromImageData(imageData)
  const gray = new cv.Mat()

  try {
    cv.cvtColor(source, gray, cv.COLOR_RGBA2GRAY)
    const meanScalar = cv.mean(gray)

    return {
      width: bitmap.width,
      height: bitmap.height,
      meanBrightness: Number(meanScalar[0].toFixed(2)),
    }
  } finally {
    source.delete()
    gray.delete()
    bitmap.close()
  }
}
