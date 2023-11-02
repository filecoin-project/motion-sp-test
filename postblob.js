import { pipeline } from 'node:stream/promises'
import { SHA256Transform } from './sha256stream.js'
import { PostStream } from './motion.js'

export async function postBlob (endpointUrl, readStream) {
  const sha256Transform = new SHA256Transform()
  const postStream = new PostStream(endpointUrl)

  await pipeline(
    readStream,
    sha256Transform,
    postStream
  )
  const { response, bytesPerSecond, bytes } = await postStream.result()
  return {
    sha256: sha256Transform.digest(),
    response,
    bytesPerSecond,
    bytes
  }
}
