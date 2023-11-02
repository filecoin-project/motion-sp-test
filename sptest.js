import { createRequire } from 'node:module'
import { open as fsopen, rename as fsrename } from 'node:fs/promises'
import { S3Client } from '@aws-sdk/client-s3'
import { getObjectList, getObjectStream } from './s3.js'
import { postBlob } from './postblob.js'
import { getStatus } from './motion.js'
import path from 'node:path'

const require = createRequire(import.meta.url)

// Add "accessKeyId" and "secretAccessKey" to config.json under "s3Config" to
// use specific credentials. Otherwise, just add "region" to use default and
// let the IAM role deal with it.
const { statusFile, motionEndpointUrl, bucketName, s3Config } = require('./config.json')

const tickTime = 1000 * 10 // 10 seconds

// Alternatively, create a separate credentials.json file with "accessKeyId"
// and "secretAccessKey" to use specific credentials.
try {
  const { accessKeyId, secretAccessKey } = require('./credentials.json')
  if (typeof accessKeyId === 'string' && typeof secretAccessKey === 'string') {
    s3Config.credentials = { accessKeyId, secretAccessKey }
  }
} catch { }

let fileMeta = {}
let fileMetaDirty = false
// load from statusFile if it exists
try {
  if (path.isAbsolute(statusFile)) {
    fileMeta = require(statusFile)
  } else {
    fileMeta = require(`./${statusFile}`)
  }
} catch { }

const s3 = new S3Client(s3Config)

const { contents: files, isTruncated } = await getObjectList(s3, bucketName)
if (isTruncated) {
  throw new Error('Got truncated list of objects from S3')
}

// Run a loop to check status and update as things change; this isn't done in
// a setInterval to stop us from tripping over ourselves, so we do a full update
// and pause for 5 seconds before trying again.
function updateTick () {
  updateFilesStatus().then(() => {
    setTimeout(updateTick, tickTime) // repeat
  }).catch((error) => {
    console.error('Error:', error)
    process.exit(1)
  })
}
setTimeout(updateTick, tickTime)

// Store all the files (if needed)
await storeFiles()

// storeFiles runs storeFile for each file in the files array, if it hasn't
// already been stored. This is a serial process, one file at a time so we have
// clearer timings to record.
async function storeFiles () {
  for (const fileName of files) {
    let stored = false
    for (const { file } of Object.values(fileMeta)) {
      if (fileName === file) {
        stored = true
        break
      }
    }
    if (stored) {
      continue
    }
    try {
      const response = await storeFile(s3, fileName, bucketName)
      fileMeta[response.id] = response
      fileMetaDirty = true
    } catch (error) {
      console.error('Error:', error)
      process.exit(1)
    }
  }
}

// storeFile stores a file in Motion and returns the response. The data is
// streamed from S3 into Motion, with a SHA2-256 digest calculated along the
// way. Byte count and bandwidth is also calculated and recorded for this
// process.
async function storeFile (s3, key, bucketName) {
  console.error(`Storing ${key}...`)
  const readStream = await getObjectStream(s3, bucketName, key)
  const result = await postBlob(motionEndpointUrl, readStream)
  if (typeof result?.response?.id !== 'string') {
    throw new Error('No id returned')
  }
  const { sha256, response, bytesPerSecond, bytes } = result
  console.error(`Stored  ${key} as ${response.id}`)
  return {
    id: response.id,
    file: key,
    bytes,
    sha256,
    uploadBytesPerSecond: bytesPerSecond,
    uploadedAt: new Date().toISOString()
  }
}

// updateFilesStatus runs checkFileStatus for each file that we've stored, and
// if the status has changed, updates the status and writes the status file to
// disk.
async function updateFilesStatus () {
  let changed = false
  await Promise.all(Object.entries(fileMeta).map(async ([id, data]) => {
    if (await checkFileStatus(data)) {
      changed = true
      console.error(`File ${data.file} status has been updated`)
    }
  }))
  if (changed || fileMetaDirty) {
    fileMetaDirty = false
    await writeStatusFile()
  }
}

// checkFileStatus is a per-file check of the Motion API to see if the status
// has changed since we last checked. If it has, update the status and return
// true, otherwise return false.
//
// Looks more complicated than it is, we're just being very careful to check
// changes and that the API is returning what we expect.
async function checkFileStatus (data) {
  const status = await getStatus(motionEndpointUrl, data.id)
  if (status?.id !== data.id) {
    throw new Error(`Status id does not match: got [${status?.id}], expected [${data.id}]`)
  }
  if (!Array.isArray(status.replicas)) {
    return false // too soon?
  }
  let changed = false
  if (data.replicasAt == null) {
    changed = true
    data.replicasAt = new Date().toISOString()
  }
  if (!Array.isArray(data.pieces)) {
    changed = true
    data.pieces = []
  }
  for (const { provider, pieces } of status.replicas) {
    if (typeof provider !== 'string') {
      throw new Error(`Replica for ${data.id} has no provider`)
    }
    if (!Array.isArray(pieces)) {
      throw new Error(`Replica for ${data.id} has no pieces on ${provider}`)
    }
    for (const { pieceCid, status } of pieces) {
      if (typeof pieceCid !== 'string') {
        throw new Error(`Piece for ${data.id} has no pieceCid on ${provider}`)
      }
      if (typeof status !== 'string') {
        throw new Error(`Piece for ${data.id} has no status on ${provider}`)
      }
      let found = false
      for (const piece of data.pieces) {
        if (piece.provider === provider && piece.cid === pieceCid) {
          found = true
          if (piece.status !== status) {
            changed = true
            if (!Array.isArray(piece.updates)) {
              piece.updates = []
            }
            piece.updates.push([piece.status, status, new Date().toISOString()])
            piece.status = status
          }
        }
      }
      if (!found) {
        changed = true
        data.pieces.push({ provider, cid: pieceCid, status })
      }
    }
  }
  return changed
}

async function writeStatusFile () {
  process.stderr.write('Writing status file to disk...')
  const tmpStatusFile = '.status.json'
  const fd = await fsopen(tmpStatusFile, 'w')
  await fd.write('{\n')
  const keys = Object.keys(fileMeta)
  for (let i = 0; i < keys.length; i++) {
    let line = `"${keys[i]}": ` + JSON.stringify(fileMeta[keys[i]])
    if (i < keys.length - 1) {
      line += ','
    }
    line += '\n'
    await fd.write(line)
  }
  await fd.write('}\n')
  await fd.close()
  await fsrename(tmpStatusFile, statusFile)
  console.error(' Done')
}
