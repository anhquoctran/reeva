import { Readable } from 'node:stream'

/**
 * BaseStorageProvider defines the standard interface for all storage backends.
 */
export interface BaseStorageProvider {
  /**
   * Uploads a file buffer to the storage provider
   */
  upload(file: Buffer, options?: any): Promise<{ key: string }>

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

  /**
   * Moves a file to an archive location or marks it as archived in the storage
   */
  archive(key: string): Promise<void>
}
