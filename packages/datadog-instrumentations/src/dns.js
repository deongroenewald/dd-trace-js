'use strict'

const { AsyncResource } = require('async_hooks')
const { channel, addHook } = require('../../dd-trace/src/plugins/instrument')

const empty = {}

const rrtypes = {
  resolveAny: 'ANY',
  resolve4: 'A',
  resolve6: 'AAAA',
  resolveCname: 'CNAME',
  resolveMx: 'MX',
  resolveNs: 'NS',
  resolveTxt: 'TXT',
  resolveSrv: 'SRV',
  resolvePtr: 'PTR',
  resolveNaptr: 'NAPTR',
  resolveSoa: 'SOA'
}

const rrtypeMap = new WeakMap()

addHook({ name: 'dns' }, dns => {
  dns.lookup = wrap('apm:dns:lookup', dns.lookup, 2)
  dns.lookupService = wrap('apm:dns:lookup_service', dns.lookupService, 3)
  dns.resolve = wrap('apm:dns:resolve', dns.resolve, 2)
  dns.reverse = wrap('apm:dns:reverse', dns.reverse, 2)

  patchResolveShorthands(dns)

  if (dns.Resolver) {
    dns.Resolver.prototype.resolve = wrap('apm:dns:resolve', dns.Resolver.prototype.resolve, 2)
    dns.Resolver.prototype.reverse = wrap('apm:dns:reverse', dns.Resolver.prototype.reverse, 2)

    patchResolveShorthands(dns.Resolver.prototype)
  }

  return dns
})

function patchResolveShorthands (prototype) {
  Object.keys(rrtypes)
    .filter(method => !!prototype[method])
    .forEach(method => {
      rrtypeMap.set(prototype[method], rrtypes[method])
      prototype[method] = wrap('apm:dns:resolve:' + rrtypes[method], prototype[method], 2)
    })
}

function wrap (prefix, fn, expectedArgs) {
  const startCh = channel(prefix + ':start')
  const endCh = channel(prefix + ':end')
  const asyncEndCh = channel(prefix + ':async-end')
  const errorCh = channel(prefix + ':error')

  const wrapped = function () {
    const cb = AsyncResource.bind(arguments[arguments.length - 1])
    if (!isArgsValid(arguments, expectedArgs)) {
      return fn.apply(this, arguments)
    }

    startCh.publish(arguments)
    if (context.noTrace) {
      return fn.apply(this, arguments)
    }

    arguments[arguments.length - 1] = function (error, result) {
      if (error) {
        errorCh.publish(error)
      } else {
        asyncEndCh.publish(result)
      }
      cb.apply(this, arguments)
    }

    try {
      return fn.apply(this, arguments)
      // TODO deal with promise versions when we support `dns/promises`
    } catch (error) {
      error.stack // trigger getting the stack at the original throwing point
      errorCh.publish(error)

      throw error
    } finally {
      endCh.publish(empty)
    }
  }

  Reflect.ownKeys(fn).forEach(key => {
    Object.defineProperty(wrapped, key, Object.getOwnPropertyDescriptor(fn, key))
  })

  return wrapped
}

function isArgsValid (args, minLength) {
  if (args.length < minLength) return false
  if (typeof args[args.length - 1] !== 'function') return false

  return true
}
