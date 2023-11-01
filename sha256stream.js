import { Transform } from 'stream'
import crypto from 'node:crypto'

export class SHA256Transform extends Transform {
  constructor() {
    super()
    this.sha256Hash = crypto.createHash('sha256')
  }

  _transform(chunk, encoding, callback) {
    this.sha256Hash.update(chunk)
    this.push(chunk)
    callback()
  }

  digest () {
    return this.sha256Hash.digest('hex')
  }
}
