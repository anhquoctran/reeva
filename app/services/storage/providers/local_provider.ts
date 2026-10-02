import { type BaseStorageProvider } from '../base_storage_provider.js'
import { promises as fs, constants, createWriteStream } from 'node:fs'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { type Readable } from 'node:stream'
import type { UploadOptions } from '../base_storage_provider.js'

/**
 * LocalProvider handles file storage on the local disk.
 */
export default class LocalProvider implements BaseStorageProvider {
  private rootPath: string

  constructor(protected config: any) {
    this.rootPath = config.root || path.join(process.cwd(), 'storage', 'uploads')
  }

  async upload(file: Readable, options: UploadOptions): Promise<{ key: string }> {
    const { key } = options
    const root = await this.getRealRoot(true)
    const fullPath = this.resolveKey(root, key)
    await this.ensureSafeDirectories(root, path.dirname(fullPath))

    try {
      await pipeline(file, createWriteStream(fullPath, { flags: 'wx', mode: 0o640 }))
    } catch (error) {
      await fs.unlink(fullPath).catch(() => {})
      throw error
    }

    return { key }
  }

  async getDownloadUrl(key: string): Promise<string> {
    return `/storage/files/${key.split('/').map(encodeURIComponent).join('/')}`
  }

  async getStream(key: string): Promise<Readable> {
    const root = await this.getRealRoot(false)
    const fullPath = this.resolveKey(root, key)
    await this.assertNoSymlinkPath(root, fullPath)
    const canonicalPath = await fs.realpath(fullPath)
    this.assertContained(root, canonicalPath)
    const stat = await fs.stat(canonicalPath)
    if (!stat.isFile()) {
      throw new Error('Storage key is not a regular file.')
    }

    const file = await fs.open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW)
    return file.createReadStream({ autoClose: true })
  }

  async delete(key: string): Promise<void> {
    try {
      const root = await this.getRealRoot(false)
      const fullPath = this.resolveKey(root, key)
      await this.assertNoSymlinkPath(root, fullPath)
      const canonicalPath = await fs.realpath(fullPath)
      this.assertContained(root, canonicalPath)
      const stat = await fs.stat(canonicalPath)
      if (!stat.isFile()) {
        return
      }
      await fs.unlink(canonicalPath)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
  }

  private async getRealRoot(create: boolean) {
    const root = path.resolve(this.rootPath)
    if (create) await fs.mkdir(root, { recursive: true })
    const canonicalRoot = await fs.realpath(root)
    const rootStats = await fs.stat(canonicalRoot)
    if (!rootStats.isDirectory()) {
      throw new Error('Local storage root is not a directory.')
    }
    return canonicalRoot
  }

  private resolveKey(root: string, key: string) {
    if (
      !key ||
      key.includes('\0') ||
      key.includes('\\') ||
      path.posix.isAbsolute(key) ||
      key.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')
    ) {
      throw new Error('Invalid storage key.')
    }

    const fullPath = path.resolve(root, ...key.split('/'))
    this.assertContained(root, fullPath)
    return fullPath
  }

  private assertContained(root: string, candidate: string) {
    const relative = path.relative(root, candidate)
    if (
      !relative ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error('Storage key escapes the configured root.')
    }
  }

  private async ensureSafeDirectories(root: string, target: string) {
    const relative = path.relative(root, target)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Storage key escapes the configured root.')
    }

    let current = root
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment)
      try {
        await fs.mkdir(current)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink() || !stat.isDirectory()) {
        throw new Error('Storage path contains a symlink or non-directory component.')
      }
      this.assertContained(root, await fs.realpath(current))
    }
  }

  private async assertNoSymlinkPath(root: string, target: string) {
    const relative = path.relative(root, target)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw new Error('Storage key escapes the configured root.')
    }

    let current = root
    const segments = relative.split(path.sep).filter(Boolean)
    for (const [index, segment] of segments.entries()) {
      current = path.join(current, segment)
      const stat = await fs.lstat(current)
      if (stat.isSymbolicLink()) {
        throw new Error('Storage path contains a symlink.')
      }
      if (index < segments.length - 1 && !stat.isDirectory()) {
        throw new Error('Storage path contains a non-directory component.')
      }
    }
  }
}
