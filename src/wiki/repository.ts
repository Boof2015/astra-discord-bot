import { execFile } from 'node:child_process'
import { access, mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface WikiSyncResult {
  changed: boolean
  commit: string
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function git(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    encoding: 'utf8',
    maxBuffer: 2 * 1024 * 1024,
  })
  return stdout.trim()
}

export class WikiRepository {
  constructor(
    readonly directory: string,
    private readonly remoteUrl: string,
    private readonly syncEnabled: boolean,
  ) {}

  async #currentCommit(): Promise<string> {
    if (!await pathExists(join(this.directory, '.git'))) return 'local-files'
    return git(['-C', this.directory, 'rev-parse', 'HEAD'])
  }

  async sync(): Promise<WikiSyncResult> {
    const gitDirectoryExists = await pathExists(join(this.directory, '.git'))

    if (!this.syncEnabled) {
      if (!await pathExists(this.directory)) {
        throw new Error(`Local Wiki directory does not exist: ${this.directory}`)
      }
      return { changed: false, commit: await this.#currentCommit() }
    }

    if (!gitDirectoryExists) {
      if (await pathExists(this.directory)) {
        throw new Error(
          `Wiki sync directory exists but is not a Git clone: ${this.directory}. `
          + 'Choose an empty bot-owned directory or disable Wiki sync.',
        )
      }
      await mkdir(dirname(this.directory), { recursive: true })
      await git(['clone', '--depth=1', this.remoteUrl, this.directory])
      return { changed: true, commit: await this.#currentCommit() }
    }

    const before = await this.#currentCommit()
    await git(['-C', this.directory, 'pull', '--ff-only', '--quiet'])
    const commit = await this.#currentCommit()
    return { changed: before !== commit, commit }
  }
}
