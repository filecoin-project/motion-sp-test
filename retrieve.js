#!/usr/bin/env node

import { createRequire } from 'node:module'
import { isAbsolute, basename } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Writable } from 'stream'
import xbytes from 'xbytes'
import minimist from 'minimist'
import { Client } from 'undici'
import { SHA256Transform } from './sha256stream.js'

const argv = minimist(process.argv.slice(2))

if (argv.help || argv.h || argv._ === 'help') {
  console.log(`Usage: ${basename(process.argv[1])} [options]`)
  console.log(`Options:
    --min <size>        Minimum file size to consider (default 0)
    --max <size>        Maximum file size to consider (default Infinity)
    --duration <time>   Duration to run for (default 5m)`)
  process.exit(0)
}

const require = createRequire(import.meta.url)

const { statusFile, motionEndpointUrl } = require('./config.json')
const fileMeta = require((isAbsolute(statusFile) ? '' : './') + statusFile)

let minBytes = 0
let maxBytes = Infinity
let duration = 5 * 60 * 1000 // 5 minutes

if (argv.min != null) {
  minBytes = xbytes.parseSize(argv.min)
  if (minBytes < 0 || minBytes == null) {
    throw new Error('min must be >= 0, got ' + argv.min)
  }
}

if (argv.max != null) {
  maxBytes = xbytes.parseSize(argv.max)
  if (maxBytes < 0 || maxBytes == null) {
    throw new Error('max must be >= 0, got ' + argv.max)
  }
}

if (argv.duration != null) {
  let ds = String(argv.duration).trim()
  let mul = 1
  if (ds.endsWith('m')) {
    ds = ds.slice(0, -1).trim()
    mul = 60 * 1000
  } else if (ds.endsWith('s')) {
    ds = ds.slice(0, -1).trim()
    mul = 1000
  }
  if (!/^\d+$/.test(ds)) {
    throw new Error('expected a duration integer, got ' + ds)
  }
  duration = parseInt(ds, 10) * mul
  if (duration <= 0) {
    throw new Error('duration must be > 0, got ' + argv.duration)
  }
}

const files = Object.values(fileMeta).filter(({ bytes }) => {
  return bytes >= minBytes && bytes <= maxBytes
})

if (files.length === 0) {
  throw new Error(`No files in range (between ${xbytes(minBytes)} and ${xbytes(maxBytes)})`)
}

console.log(`Testing retrieval using random selection from ${files.length} files between ${xbytes(minBytes)} and ${xbytes(maxBytes)} for ${duration / 1000} seconds`)

const start = Date.now()
const end = start + duration
const stats = []
process.stderr.write('Fetching ')
do {
  const { id, file, bytes, sha256 } = files[Math.floor(Math.random() * files.length)]
  // new client per run, don't cache connections (TODO: check undici isn't being too clever underneath)
  const u = new URL(`${motionEndpointUrl}/${id}`)
  const client = new Client(`${u.protocol}//${u.host}`)
  const sha256Transform = new SHA256Transform()
  const runStart = process.hrtime.bigint()
  let ttfb = null
  await pipeline(
    [], // empty body to send into the HTTP GET
    client.pipeline({ path: u.pathname, method: 'GET' }, ({ statusCode, headers, body }) => {
      if (statusCode !== 200) {
        throw new Error(`Unexpected status code ${statusCode}`)
      }
      return body
    }),
    sha256Transform,
    new Writable({
      write (chunk, encoding, callback) {
        if (ttfb === null) {
          ttfb = process.hrtime.bigint() - runStart
        }
        callback()
      }
    })
  )
  const ttlb = process.hrtime.bigint() - runStart
  const bytesPerSecond = Math.round(bytes / (Number(ttlb) / 1e9))
  if (sha256 !== sha256Transform.digest()) {
    throw new Error(`SHA256 mismatch for ${file}`)
  }
  stats.push({ bytes, bytesPerSecond, ttfb, ttlb })
  process.stderr.write('.')
} while (Date.now() < end)
process.stderr.write('\n')

const averageSize = Math.round(stats.reduce((acc, { bytes }) => acc + bytes, 0) / stats.length)
const averageBytesPerSecond = Math.round(stats.reduce((acc, { bytesPerSecond }) => acc + bytesPerSecond, 0) / stats.length)
const averageTTFB = Math.round(stats.reduce((acc, { ttfb }) => acc + Number(ttfb), 0) / stats.length)
const averageTTLB = Math.round(stats.reduce((acc, { ttlb }) => acc + Number(ttlb), 0) / stats.length)

console.log(`Files fetched: ${stats.length}`)
console.log(`Average size:  ${xbytes(averageSize)}`)
console.log(`Average speed: ${xbytes(averageBytesPerSecond)} / s`)
console.log(`Average TTFB:  ${averageTTFB / 1e6} ms`)
console.log(`Average TTLB:  ${averageTTLB / 1e6} ms`)
