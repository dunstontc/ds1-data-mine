/*
 * decaffeinate suggestions:
 * DS101: Remove unnecessary use of Array.from
 * DS102: Remove unnecessary code created because of implicit returns
 * DS207: Consider shorter variations of null checks
 * DS208: Avoid top-level this
 * Full docs: https://github.com/decaffeinate/decaffeinate/blob/master/docs/suggestions.md
 */
// this whole thing is ugly as fuck... but at least it's not a batch file

const Promise = require('any-promise');
const path = require('path').win32;
const fs = require('fs-extra');
const fsp = require('fs-promise');
const glob = require('glob');
const globp = require('glob-promise');
const { spawn } = require('child_process');
const assert = require('assert');

const vendorPath = path.join(__dirname, 'vendor');
const outputPath = path.join(__dirname, 'output');
const ds3GamePath = path.join.apply(this, [
  process.env['ProgramFiles(x86)'],
  'Steam',
  'steamapps',
  'common',
  'DARK SOULS III',
  'Game',
]);

const dataFiles = glob.sync('*.bdt', {cwd: ds3GamePath, nocase: true});
const dataDirs = dataFiles.map(file => path.basename(file, '.bdt'));

const binderTool = path.join(vendorPath, 'BinderTool', 'BinderTool.exe');
const bigHat = path.join(vendorPath, 'BigHat', 'BigHat.exe');
const texConv = path.join(vendorPath, 'texconv.exe');


const logAndExit = function(msg) {
  console.error(msg);
  return process.exit(1);
};

const progressMessage = function(msg) {
  assert(msg);
  return new Promise(function(resolve, reject) {
    console.info(msg);
    return resolve();
  });
};

const ensureExecutable = function(path) {
  assert(path);
  return new Promise(function(resolve, reject) {
    return fs.access(path, fs.X_OK, function(err) {
      if (err != null) { reject(err.toLocaleString()); }
      console.log(`${path} is executable`);
      return resolve();
    });
  });
};

const ensureReadable = function(path) {
  assert(path);
  return new Promise(function(resolve, reject) {
    return fs.access(path, fs.R_OK, function(err) {
      if (err != null) { reject(err.toLocaleString()); }
      console.log(`${path} is readable`);
      return resolve();
    });
  });
};

const cleanupOutputDirectory = () =>
  new Promise(function(resolve, reject) {
    console.warn(`clearing out ${outputPath}`);
    fs.emptyDirSync(outputPath);
    return resolve();
  })
;

const performSanityChecks = function() {
  return progressMessage('performing sanity checks')
  .then(ensureExecutable.bind(this, binderTool), logAndExit)
  .then(ensureExecutable.bind(this, texConv), logAndExit)
  .then(ensureExecutable.bind(this, bigHat), logAndExit)
  .then(ensureReadable.bind(this, ds3GamePath), logAndExit)
  .then(cleanupOutputDirectory, logAndExit);
};

const runBinderTool = function(inputFile, outputDir) {
  assert(inputFile);
  assert(outputDir);
  return new Promise(function(resolve, reject) {
    console.log(`unpacking ${path.basename(inputFile)} to ${outputDir}`);
    const child = spawn(binderTool, [inputFile, outputDir], {
      cwd: outputPath,
      stdio: ['ignore', process.stdout, process.stderr]
    });
    const hasEncounteredError = false;
    child.on('error', err => reject(err));
    return child.on('exit', (code, signal) => {
      if (hasEncounteredError) { return; } // exit can be called after error
      if (code === 0) {
        return resolve();
      } else {
        return reject(`Error code: ${code}; Signal: ${signal}`);
      }
    });
  });
};

const runTexConv = function(inputFile, outputDir) {
  assert(inputFile);
  assert(outputDir);
  return new Promise(function(resolve, reject) {
    console.log(`converting ${path.basename(inputFile)} to PNG`);
    const child = spawn(texConv, ['-ft', 'PNG', inputFile, '-o', outputDir], {
      cwd: outputPath,
      stdio: ['ignore', process.stdout, process.stderr]
    });
    const hasEncounteredError = false;
    child.on('error', err => reject(err));
    return child.on('exit', (code, signal) => {
      if (hasEncounteredError) { return; } // exit can be called after error
      if (code === 0) {
        return resolve();
      } else {
        return reject(`Error code: ${code}; Signal: ${signal}`);
      }
    });
  });
};

const removeFile = function(file) {
  assert(file);
  return new Promise(function(resolve, reject) {
    return fs.unlink(file, function(err) {
      if (err != null) {
        return reject(err);
      } else {
        return resolve();
      }
    });
  });
};

const unpackMainDataFiles = function() {
  let promise = progressMessage('unpacking main data files');
  for (let bdtFile of Array.from(dataFiles)) {
    const fullpath = path.join(ds3GamePath, bdtFile);
    const out = path.basename(bdtFile, path.extname(bdtFile));
    promise = promise.then(runBinderTool.bind(this, fullpath, out), logAndExit);
  }
  return promise;
};

const unpackFilesWithGlob = function(pattern, msg) {
  assert(pattern);
  if (msg == null) { msg = `unpacking files with glob ${pattern}`; }
  let promise = progressMessage(msg);
  for (let dataDir of Array.from(dataDirs)) {
    const files = glob.sync(`${dataDir}/${pattern}`, {cwd: outputPath, nocase: true});
    for (let file of Array.from(files)) {
      const fullpath = path.join(outputPath, file);
      const out = path.dirname(file);
      promise = promise.then(runBinderTool.bind(this, fullpath, out), logAndExit)
      .then(removeFile.bind(this, fullpath), logAndExit);
    }
  }
  return promise;
};

const unpackFiles = function() {
  return progressMessage('unpacking internal files')
  .then(unpackFilesWithGlob.bind(this,
    '**/*.*bdt', 'unpacking additional BDT files'), logAndExit)
  .then(unpackFilesWithGlob.bind(this,
    '**/*.*bnd', 'unpacking BND files'), logAndExit)
  .then(unpackFilesWithGlob.bind(this,
    '**/*.*tpf', 'unpacking TPF files'), logAndExit)
  .then(unpackFilesWithGlob.bind(this,
    '**/*.*bnd', 'unpacking additional BND files'), logAndExit)
  .then(unpackFilesWithGlob.bind(this,
    '**/*.*bdle', 'unpacking weird BND files'), logAndExit);
};

const convertDDS = function() {
  let promise = progressMessage('converting DDS files to PNG');
  for (let dataDir of Array.from(dataDirs)) {
    const files = glob.sync(`${dataDir}/**/*.dds`, {cwd: outputPath, nocase: true});
    for (let file of Array.from(files)) {
      const fullpath = path.join(outputPath, file);
      const out = path.dirname(file);
      promise = promise.then(runTexConv.bind(this, fullpath, out), logAndExit);
    }
  }
  return promise;
};

performSanityChecks().catch(logAndExit)
.then(unpackMainDataFiles, logAndExit)
.then(unpackFiles, logAndExit)
.then(convertDDS, logAndExit)
.then(() => console.log('done!'));
