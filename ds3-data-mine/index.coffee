# this whole thing is ugly as fuck... but at least it's not a batch file

Promise = require 'any-promise'
path = require('path').win32
fs = require 'fs-extra'
fsp = require 'fs-promise'
glob = require 'glob'
globp = require 'glob-promise'
spawn = require('child_process').spawn
assert = require('assert')

vendorPath = path.join __dirname, 'vendor'
outputPath = path.join __dirname, 'output'
ds3GamePath = path.join.apply @, [
  process.env['ProgramFiles(x86)'],
  'Steam', 'steamapps', 'common',
  'DARK SOULS III', 'Game']

dataFiles = glob.sync('*.bdt', {cwd: ds3GamePath, nocase: true})
dataDirs = dataFiles.map (file) -> path.basename file, '.bdt'

binderTool = path.join vendorPath, 'BinderTool', 'BinderTool.exe'
bigHat = path.join vendorPath, 'BigHat', 'BigHat.exe'
texConv = path.join vendorPath, 'texconv.exe'


logAndExit = (msg) ->
  console.error msg
  process.exit(1)

progressMessage = (msg) ->
  assert msg
  new Promise (resolve, reject) ->
    console.info msg
    resolve()

ensureExecutable = (path) ->
  assert path
  new Promise (resolve, reject) ->
    fs.access path, fs.X_OK, (err) ->
      reject err.toLocaleString() if err?
      console.log "#{path} is executable"
      resolve()

ensureReadable = (path) ->
  assert path
  new Promise (resolve, reject) ->
    fs.access path, fs.R_OK, (err) ->
      reject err.toLocaleString() if err?
      console.log "#{path} is readable"
      resolve()

cleanupOutputDirectory = ->
  new Promise (resolve, reject) ->
    console.warn "clearing out #{outputPath}"
    fs.emptyDirSync outputPath
    resolve()

performSanityChecks = ->
  progressMessage 'performing sanity checks'
  .then(ensureExecutable.bind(@, binderTool), logAndExit)
  .then(ensureExecutable.bind(@, texConv), logAndExit)
  .then(ensureExecutable.bind(@, bigHat), logAndExit)
  .then(ensureReadable.bind(@, ds3GamePath), logAndExit)
  .then(cleanupOutputDirectory, logAndExit)

runBinderTool = (inputFile, outputDir) ->
  assert inputFile
  assert outputDir
  new Promise (resolve, reject) ->
    console.log("unpacking #{path.basename inputFile} to #{outputDir}")
    child = spawn binderTool, [inputFile, outputDir], {
      cwd: outputPath
      stdio: ['ignore', process.stdout, process.stderr]
    }
    hasEncounteredError = false
    child.on 'error', (err) => reject(err)
    child.on 'exit', (code, signal) =>
      return if hasEncounteredError # exit can be called after error
      if code == 0
        resolve()
      else
        reject("Error code: #{code}; Signal: #{signal}")

runTexConv = (inputFile, outputDir) ->
  assert inputFile
  assert outputDir
  new Promise (resolve, reject) ->
    console.log("converting #{path.basename inputFile} to PNG")
    child = spawn texConv, ['-ft', 'PNG', inputFile, '-o', outputDir], {
      cwd: outputPath
      stdio: ['ignore', process.stdout, process.stderr]
    }
    hasEncounteredError = false
    child.on 'error', (err) => reject(err)
    child.on 'exit', (code, signal) =>
      return if hasEncounteredError # exit can be called after error
      if code == 0
        resolve()
      else
        reject("Error code: #{code}; Signal: #{signal}")

removeFile = (file) ->
  assert file
  new Promise (resolve, reject) ->
    fs.unlink file, (err) ->
      if err?
        reject(err)
      else
        resolve()

unpackMainDataFiles = ->
  promise = progressMessage 'unpacking main data files'
  for bdtFile in dataFiles
    fullpath = path.join ds3GamePath, bdtFile
    out = path.basename bdtFile, path.extname bdtFile
    promise = promise.then(runBinderTool.bind(@, fullpath, out), logAndExit)
  return promise

unpackFilesWithGlob = (pattern, msg) ->
  assert pattern
  msg ?= "unpacking files with glob #{pattern}"
  promise = progressMessage msg
  for dataDir in dataDirs
    files = glob.sync("#{dataDir}/#{pattern}", {cwd: outputPath, nocase: true})
    for file in files
      fullpath = path.join outputPath, file
      out = path.dirname file
      promise = promise.then(runBinderTool.bind(@, fullpath, out), logAndExit)
      .then(removeFile.bind(@, fullpath), logAndExit)
  return promise

unpackFiles = ->
  progressMessage 'unpacking internal files'
  .then(unpackFilesWithGlob.bind(@,
    '**/*.*bdt', 'unpacking additional BDT files'), logAndExit)
  .then(unpackFilesWithGlob.bind(@,
    '**/*.*bnd', 'unpacking BND files'), logAndExit)
  .then(unpackFilesWithGlob.bind(@,
    '**/*.*tpf', 'unpacking TPF files'), logAndExit)
  .then(unpackFilesWithGlob.bind(@,
    '**/*.*bnd', 'unpacking additional BND files'), logAndExit)
  .then(unpackFilesWithGlob.bind(@,
    '**/*.*bdle', 'unpacking weird BND files'), logAndExit)

convertDDS = ->
  promise = progressMessage 'converting DDS files to PNG'
  for dataDir in dataDirs
    files = glob.sync("#{dataDir}/**/*.dds", {cwd: outputPath, nocase: true})
    for file in files
      fullpath = path.join outputPath, file
      out = path.dirname file
      promise = promise.then(runTexConv.bind(@, fullpath, out), logAndExit)
  return promise

performSanityChecks().catch(logAndExit)
.then(unpackMainDataFiles, logAndExit)
.then(unpackFiles, logAndExit)
.then(convertDDS, logAndExit)
.then -> console.log 'done!'
