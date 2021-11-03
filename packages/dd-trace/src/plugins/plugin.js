'use strict'

const dc = require('diagnostics_channel')
const { storage } = require('../../../datadog-core')

class Subscription {
  #channel
  #handler

  constructor (event, handler) {
    this.#channel = dc.channel(event)
    this.#handler = handler
  }

  enable () {
    this.#channel.subscribe(this.#handler)
  }

  disable () {
    this.#channel.unsubscribe(this.#handler)
  }
}

module.exports = class Plugin {
  #subscriptions
  #enabled

  constructor () {
    this.#subscriptions = []
    this.#enabled = false
  }

  addWrappedSubscriptions(prefix, name, hooks = {}) {
    hooks = Object.assign({
      // TODO more hooks will eventually be needed
      tags: () => ({}),
      asyncEnd: () => {}
    }, hooks)
    this.addSubscription(prefix + ':start', ({ context, args }) => {
      context.started = true
      let tags = hooks.tags.call(this, { context, args })
      if (context.noTrace) return
      const childOf = tracer().scope().active()
      tags = Object.assign({
        'service.name': this.config.service || tracer()._service
      }, tags)
      if (this.constructor.kind) {
        tags['span.kind'] = this.constructor.kind
      }
      const span = tracer().startSpan(name, { childOf, tags })
      const store = storage.getStore()
      storage.enterWith({ ...store, span })
      context.span = span
      context.original = store
    })
    this.addSubscription(prefix + ':end', ({ context }) => {
      if (context.noTrace || !context.started) return
      storage.enterWith(context.original)
    })
    this.addSubscription(prefix + ':async-end', ({ context, result }) => {
      if (context.noTrace || !context.started) return
      hooks.asyncEnd.call(this, { context, result })
      context.span.finish()
    })
    this.addSubscription(prefix + ':error', ({ context, error }) => {
      if (context.noTrace || !context.started) return
      context.span.addError(error)
      context.span.finish()
    })
  }

  addSubscription (channelName, handler) {
    this.#subscriptions.push(new Subscription(channelName, handler))
  }

  configure (config) {
    this.config = config
    if (config.enabled && !this.#enabled) {
      this.#enabled = true
      this.#subscriptions.forEach(sub => sub.enable())
    } else if (!config.enabled && this.#enabled) {
      this.#enabled = false
      this.#subscriptions.forEach(sub => sub.disable())
    }
  }
}

function tracer () {
  return global._ddtrace._tracer
}
