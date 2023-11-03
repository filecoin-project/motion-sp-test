import { PassThrough, Writable } from 'stream'
import { Client } from 'undici'

const clients = {}

function clientKey (url) {
  const u = new URL(url)
  return `${u.protocol}//${u.host}`
}

function claimClientFor (url) {
  const key = clientKey(url)
  if (clients[key] === undefined || clients[key].length === 0) {
    return new Client(key)
  }
  return clients[key].shift()
}

function returnClientFor (url, client) {
  const key = clientKey(url)
  if (clients[key] === undefined) {
    clients[key] = []
  }
  clients[key].push(client)
}

export class PostStream extends Writable {
  constructor (endpointUrl) {
    super()
    this.endpointUrl = endpointUrl
    this.client = claimClientFor(endpointUrl)
    this.path = new URL(endpointUrl).pathname
    this.bytes = 0
  }

  _construct (callback) {
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
            returnClientFor(this.endpointUrl, this.client)
            resolve()
          } catch (error) {
            reject(error)
          }
        }
      })
    })
  }

  _write (chunk, encoding, callback) {
    this.bytes += chunk.length
    this.bodyWriter.write(chunk, callback)
  }

  _final (callback) {
    this.bodyWriter.end()
    this.resolver.then(callback).catch(callback)
  }

  async result () {
    await this.resolver
    const duration = process.hrtime.bigint() - this.startTime
    const bytesPerSecond = Math.round(this.bytes / (Number(duration) / 1e9))
    return {
      response: this.resp,
      bytes: this.bytes,
      milliseconds: Math.round(Number(duration) / 1e6),
      bytesPerSecond
    }
  }
}

export async function getStatus (endpointUrl, id) {
  const url = `${endpointUrl}/${id}/status`
  const client = claimClientFor(url)
  const { body, statusCode } = await client.request({
    path: new URL(url).pathname,
    method: 'GET'
  })
  if (statusCode !== 200) {
    console.error('Got unexpected status code from staus request:', statusCode)
  }
  const data = []
  for await (const chunk of body) {
    data.push(chunk)
  }
  returnClientFor(url, client)
  return JSON.parse(Buffer.concat(data).toString('utf8'))
}
