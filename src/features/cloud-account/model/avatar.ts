// 上传前统一为小尺寸 PNG，服务端仍会独立校验并移除图片元数据。
export async function prepareAvatar(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg'].includes(file.type)) throw new Error('avatar_invalid')
  if (file.size > 2 * 1024 * 1024) throw new Error('avatar_file_size')
  const source = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('avatar_invalid'))
    reader.onerror = () => reject(new Error('avatar_invalid'))
    reader.readAsDataURL(file)
  })
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const value = new Image()
    value.onload = () => resolve(value)
    value.onerror = () => reject(new Error('avatar_invalid'))
    value.src = source
  })
  if (!image.naturalWidth || !image.naturalHeight || image.naturalWidth > 8192 || image.naturalHeight > 8192) throw new Error('avatar_invalid')
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 256
  const context = canvas.getContext('2d')
  if (!context) throw new Error('avatar_invalid')
  const size = Math.min(image.naturalWidth, image.naturalHeight)
  context.drawImage(image, (image.naturalWidth - size) / 2, (image.naturalHeight - size) / 2, size, size, 0, 0, 256, 256)
  const result = canvas.toDataURL('image/png')
  if (!result.startsWith('data:image/png;base64,') || result.length > 349550) throw new Error('avatar_invalid')
  return result
}
