import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";

export async function getObjectList(s3, bucket) {
  const listCommand = new ListObjectsV2Command({ Bucket: bucket })
  let isTruncated = true
  let contents = []
  while (isTruncated) {
    const { Contents, IsTruncated, NextContinuationToken } = await s3.send(listCommand)
    contents = contents.concat(Contents.map((c) => c.Key))
    isTruncated = IsTruncated
    listCommand.input.ContinuationToken = NextContinuationToken
  }
  return { contents, isTruncated }
}

export async function getObjectStream(s3, bucket, key) {
  const getCommand = new GetObjectCommand({ Bucket: bucket, Key: key })
  const { Body } = await s3.send(getCommand)
  return Body
}
