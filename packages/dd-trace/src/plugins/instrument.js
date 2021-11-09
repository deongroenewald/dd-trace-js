'use strict'

const dc = require('diagnostics_channel')
const path = require('path')
const semver = require('semver')
const iitm = require('../iitm')
const ritm = require('../ritm')
const parse = require('module-details-from-path')
const requirePackageJson = require('../require-package-json')

const pathSepExpr = new RegExp(`\\${path.sep}`, 'g')
const channelMap = {}
exports.channel = function channel (name) {
  const maybe = channelMap[name]
  if (maybe) return maybe
  const ch = dc.channel(name)
  channelMap[name] = ch
  return ch
}

exports.addHook = function addHook ({ name, versions, file }, hook) {
  file = filename(name, file)
  const loaderHook = (moduleExports, moduleName, moduleBaseDir) => {
    moduleName = moduleName.replace(pathSepExpr, '/')
    const moduleVersion = getVersion(moduleBaseDir)
    if (moduleName !== file || !matchVersion(moduleVersion, versions)) {
      return
    }
    return hook(moduleExports)
  }
  ritm([name], loaderHook)
  cjsPostLoad({ name, versions, file }, hook)
  iitm([name], loaderHook)
}

function matchVersion (version, ranges) {
  return !version || (ranges && ranges.some(range => semver.satisfies(semver.coerce(version), range)))
}

function getVersion (moduleBaseDir) {
  if (moduleBaseDir) {
    return requirePackageJson(moduleBaseDir, module).version
  }
}

function filename (name, file) {
  return [name, file].filter(val => val).join('/')
}

// TODO this is basically Loader#_getModules + running the hook. DRY up.
// TODO delete all this as a semver major
function cjsPostLoad (instrumentation, hook) {
  const ids = Object.keys(require.cache)

  let pkg

  for (let i = 0, l = ids.length; i < l; i++) {
    if (ids[i] === instrumentation.name) {
      hook(require.cache[ids[i]].exports)
      continue
    }

    const id = ids[i].replace(pathSepExpr, '/')

    if (!id.includes(`/node_modules/${instrumentation.name}/`)) continue

    if (instrumentation.file) {
      if (!id.endsWith(`/node_modules/${filename(instrumentation)}`)) continue

      const basedir = getBasedir(ids[i])

      pkg = requirePackageJson(basedir, module)
    } else {
      const basedir = getBasedir(ids[i])

      pkg = requirePackageJson(basedir, module)

      const mainFile = path.posix.normalize(pkg.main || 'index.js')
      if (!id.endsWith(`/node_modules/${instrumentation.name}/${mainFile}`)) continue
    }

    if (!matchVersion(pkg.version, instrumentation.versions)) continue

    hook(require.cache[ids[i]].exports)
  }
}

function getBasedir (id) {
  return parse(id).basedir.replace(pathSepExpr, '/')
}
