import {GlobOptions} from '@actions/glob'
import * as path from 'path'
import * as core from '@actions/core'
import * as glob from '@actions/glob'
import {promises as fs} from 'fs'

import {
  getDeletedFiles,
  getFilesFromSourceFile,
  normalizeSeparators,
  escapeString,
  tempfile
} from './utils'

const DEFAULT_EXCLUDED_FILES = [
  '!node_modules/**',
  '!**/node_modules/**',
  '!.git/**'
]

export async function run(): Promise<void> {
  const files = core.getInput('files', {required: false})
  const filesSeparator = core.getInput('files-separator', {
    required: false,
    trimWhitespace: false
  })
  const excludedFiles = core.getInput('excluded-files', {required: false})
  const excludedFilesSeparator = core.getInput('excluded-files-separator', {
    required: false,
    trimWhitespace: false
  })

  const filesFromSourceFile = core.getInput('files-from-source-file', {
    required: false
  })
  const filesFromSourceFileSeparator = core.getInput(
    'files-from-source-file-separator',
    {required: false, trimWhitespace: false}
  )
  const excludedFilesFromSourceFile = core.getInput(
    'excluded-files-from-source-file',
    {required: false}
  )
  const excludedFilesFromSourceFileSeparator = core.getInput(
    'excluded-files-from-source-file-separator',
    {required: false, trimWhitespace: false}
  )

  const followSymbolicLinks = core.getBooleanInput('follow-symbolic-links', {
    required: false
  })
  const matchDirectories = core.getBooleanInput('match-directories', {
    required: false
  })
  const separator = core.getInput('separator', {
    required: true,
    trimWhitespace: false
  })
  const escapePaths = core.getBooleanInput('escape-paths', {required: false})
  const stripTopLevelDir = core.getBooleanInput('strip-top-level-dir', {
    required: true
  })
  const includeDeletedFiles = core.getBooleanInput('include-deleted-files', {
    required: true
  })

  const sha = core.getInput('sha', {required: includeDeletedFiles})
  const baseSha = core.getInput('base-sha', {required: includeDeletedFiles})

  const workingDirectory = path.resolve(
    process.env.GITHUB_WORKSPACE || process.cwd(),
    core.getInput('working-directory', {required: true})
  )

  let filePatterns = files
    .split(filesSeparator)
    .filter(p => p !== '')
    .join('\n')

  core.debug(`file patterns: ${filePatterns}`)

  if (excludedFiles !== '') {
    const excludedFilePatterns = excludedFiles
      .split(excludedFilesSeparator)
      .filter(p => p !== '')
      .map(p => {
        if (!p.startsWith('!')) {
          p = `!${p}`
        }
        return p
      })
      .join('\n')

    core.debug(`excluded file patterns: ${excludedFilePatterns}`)

    if (!files) {
      filePatterns += `\n**\n${excludedFilePatterns}`
    } else {
      filePatterns += `\n${excludedFilePatterns}`
    }
  }

  if (filesFromSourceFile !== '') {
    const inputFilesFromSourceFile = filesFromSourceFile
      .split(filesFromSourceFileSeparator)
      .filter(p => p !== '')
      .map(p => path.join(workingDirectory, p))

    const filesFromSourceFiles = (
      await getFilesFromSourceFile({filePaths: inputFilesFromSourceFile})
    ).join('\n')

    core.debug(`files from source files patterns: ${filesFromSourceFiles}`)

    filePatterns += `\n${filesFromSourceFiles}`
  }

  if (excludedFilesFromSourceFile !== '') {
    const inputExcludedFilesFromSourceFile = excludedFilesFromSourceFile
      .split(excludedFilesFromSourceFileSeparator)
      .filter(p => p !== '')
      .map(p => path.join(workingDirectory, p))

    const excludedFilesFromSourceFiles = (
      await getFilesFromSourceFile({
        filePaths: inputExcludedFilesFromSourceFile,
        excludedFiles: true
      })
    ).join('\n')

    core.debug(
      `excluded files from source files patterns: ${excludedFilesFromSourceFiles}`
    )

    if (!files && !filesFromSourceFile) {
      filePatterns += `\n**\n${excludedFilesFromSourceFiles}`
    } else {
      filePatterns += `\n${excludedFilesFromSourceFiles}`
    }
  }

  filePatterns += `\n${DEFAULT_EXCLUDED_FILES.join('\n')}`

  filePatterns = [...new Set(filePatterns.split('\n').filter(p => p !== ''))]
    .map(p => {
      if (p.startsWith('!')) {
        return `!${workingDirectory}${path.sep}${p.substring(1)}`
      }
      return path.join(workingDirectory, p)
    })
    .join('\n')

  if (filePatterns.split('\n').filter(p => !p.startsWith('!')).length === 0) {
    filePatterns = `**\n${filePatterns}`
  }

  const globOptions: GlobOptions = {
    followSymbolicLinks,
    matchDirectories
  }
  const globber = await glob.create(filePatterns, globOptions)
  let paths = await globber.glob()

  if (includeDeletedFiles) {
    paths = paths.concat(
      await getDeletedFiles({
        filePatterns,
        baseSha,
        sha,
        cwd: workingDirectory
      })
    )
  }

  if (stripTopLevelDir) {
    paths = paths
      .map((p: string) =>
        normalizeSeparators(p.replace(workingDirectory + path.sep, ''))
      )
      .map((p: string) => normalizeSeparators(p.replace(workingDirectory, '')))
      .filter((p: string) => p !== '')
  }

  if (escapePaths) {
    paths = paths.map((p: string) => escapeString(p))
  }

  const pathsOutput = paths.join(separator)
  core.setOutput('paths', pathsOutput)

  if (pathsOutput) {
    const pathsOutputFile = tempfile('.txt')

    await fs.writeFile(pathsOutputFile, pathsOutput)
    core.setOutput('paths-output-file', pathsOutputFile)
    core.saveState('paths-output-file', pathsOutputFile)
    core.info(`Successfully created paths-output-file: ${pathsOutputFile}`)
  }
}

if (!process.env.TESTING) {
  // eslint-disable-next-line github/no-then
  run().catch(e => {
    core.setFailed(e.message || e)
  })
}
