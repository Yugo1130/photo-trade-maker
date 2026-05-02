self.onmessage = async (event) => {
  const { type, file } = event.data || {}

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
    }

    if (file.type.startsWith('image/')) {
      const bitmap = await createImageBitmap(file)
      result.width = bitmap.width
      result.height = bitmap.height
      bitmap.close()
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