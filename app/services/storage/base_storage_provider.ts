import { type Readable } from 'node:stream'

export type UploadOptions = {
  key: string
  fileName: string
  contentType: string
  contentLength: number
}

/**
 * BaseStorageProvider defines the standard interface for all storage backends.
 */
export interface BaseStorageProvider {
  /**
   * Streams a file to the storage provider with bounded memory use.
   */
  upload(file: Readable, options: UploadOptions): Promise<{ key: string }>

  /**
   * Generates a publicly accessible or signed download URL for the given key
   */
  getDownloadUrl(key: string): Promise<string>

  /**
   * Returns a readable stream for the specified key for proxied downloads
   */
  getStream(key: string): Promise<Readable>

  /**
   * Deletes a file from the storage provider
   */
  delete(key: string): Promise<void>
}
