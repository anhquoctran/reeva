import { BaseStorageProvider } from '../BaseStorageProvider.js'
import { promises as fs } from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
/**
 * LocalProvider handles file storage on the local disk.
 */
export default class LocalProvider implements BaseStorageProvider {
  private rootPath: string

  constructor(protected config: any) {
    this.rootPath = config.root || path.join(process.cwd(), 'storage', 'uploads')
  }

  async upload(file: Buffer, options?: any): Promise<{ key: string }> {
    const key = options?.key || `${crypto.randomUUID()}-${options?.fileName || 'file'}`
    const fullPath = path.join(this.rootPath, key)
    
    // Ensure directory exists
    await fs.mkdir(path.dirname(fullPath), { recursive: true })
    
    // Write file
    await fs.writeFile(fullPath, file)
    
    return { key }
  }

  async getDownloadUrl(key: string): Promise<string> {
    return `/storage/files/${key}`
  }

  async getStream(key: string): Promise<any> {
    const { createReadStream } = await import('node:fs')
    const fullPath = path.join(this.rootPath, key)
    return createReadStream(fullPath)
  }

  async delete(key: string): Promise<void> {
    const fullPath = path.join(this.rootPath, key)
    try {
      const isStat = await fs.stat(fullPath)
      if (!isStat ||!isStat.isFile()) {
        return;
      }
      await fs.unlink(fullPath)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }

  async archive(key: string): Promise<void> {
    const fullPath = path.join(this.rootPath, key)
    const archivePath = path.join(this.rootPath, 'archive', key)
    try {
      await fs.mkdir(path.dirname(archivePath), { recursive: true })
      await fs.rename(fullPath, archivePath)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
}
