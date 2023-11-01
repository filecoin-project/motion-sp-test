import { PassThrough, Writable } from 'stream'
import { Client } from 'undici'

const clients = {}

function clientFor(url) {
  // cache the Client per host connection
  const u = new URL(url)
  const clientUrl = `${u.protocol}//${u.host}`
  if (clients[clientUrl] === undefined) {
    clients[clientUrl] = new Client(clientUrl)
  }
  return clients[clientUrl]
}

export class PostStream extends Writable {
  constructor(endpointUrl) {
    super()
    this.client = clientFor(endpointUrl)
    this.path = new URL(endpointUrl).pathname
    this.bytes = 0
  }

  _construct(callback) {
    this.bodyWriter = new PassThrough()
    this.resolver = new Promise((resolve, reject) => {
      const requestOptions = {
        path: this.path,
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: this.bodyWriter
      }

      const data = []
      this.client.dispatch(requestOptions, {
        onHeaders: () => {},
        onConnect: () => {
          this.startTime = process.hrtime.bigint()
          callback()
        },
        onError: callback,
        onData: (chunk) => data.push(chunk),
        onComplete: () => {
          try {
            this.resp = JSON.parse(Buffer.concat(data).toString('utf8'))
            resolve()
          } catch (error) {
            reject(error)
          }
        }
      })
    })
  }

  _write(chunk, encoding, callback) {
    this.bytes += chunk.length
    this.bodyWriter.write(chunk, callback)
  }

  _final(callback) {
    this.bodyWriter.end()
    this.resolver.then(callback).catch(callback)
  }
  
  async result() {
    await this.resolver
    const duration = process.hrtime.bigint() - this.startTime
    const bytesPerSecond = Math.round(this.bytes / (Number(duration) / 1e9))
    return {
      response: this.resp,
      bytes: this.bytes,
      milliseconds: Math.round(Number(duration) / 1e6),
      bytesPerSecond: bytesPerSecond
    }
  }
}

export async function getStatus(endpointUrl, id) {
  const url = `${endpointUrl}/${id}/status`
  const client = clientFor(url)
  const { body, headers, statusCode, trailers } = await client.request({
    path: new URL(url).pathname,
    method: 'GET'
  })
  const data = []
  for await (const chunk of body) {
    data.push(chunk)
  }
  return JSON.parse(Buffer.concat(data).toString('utf8'))
}