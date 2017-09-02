import test from 'tape'
import {newChannel, go} from '../src/index'


test('go needs a generator', function(t) {
  t.plan(2)
  t.throws(() => go('25'), 'Need a generator')
  t.throws(() => go(function() { return 35 }), 'Need an iterator')
})

test('basic go usage', function(t) {
  t.plan(1)
  const ch = newChannel()
  go(function*() {
    yield ch.put('hello')
  })
  go(function*() {
    const msg = yield ch.take()
    t.equal(msg, 'hello')
  })
})

test('go with multiple puts', function(t) {
  t.plan(2)
  const ch = newChannel()
  go(function*() {
    yield ch.put('hello')
    yield ch.put('world')
  })
  go(function*() {
    const msg1 = yield ch.take()
    t.equal(msg1, 'hello')
    const msg2 = yield ch.take()
    t.equal(msg2, 'world')
  })
})

test('go with two channels', function(t) {
  t.plan(2)
  const ch1 = newChannel()
  const ch2 = newChannel()
  go(function*() {
    yield ch1.put('hello')
  })
  go(function*() {
    yield ch2.put('world')
  })
  go(function*() {
    const msg1 = yield ch1.take()
    t.equal(msg1, 'hello')
    const msg2 = yield ch2.take()
    t.equal(msg2, 'world')
  })
})

test('go with multiple puts and delayed takes', function(t) {
  t.plan(2)
  const ch = newChannel()
  go(function*() {
    yield ch.put('hello')
  })
  go(function*() {
    yield ch.put('world')
  })
  go(function*() {
    const msg1 = yield ch.take()
    t.equal(msg1, 'hello')
  })
  go(function*() {
    const msg2 = yield ch.take()
    t.equal(msg2, 'world')
  })
})

test('asyncPut works before the go routine', function(t) {
  t.plan(1)
  const ch = newChannel()
  ch.asyncPut('before')
  go(function*() {
    const msg = yield ch.take()
    t.equal(msg, 'before')
  })
})

test('asyncPut works after the go routine', function(t) {
  t.plan(1)
  const ch = newChannel()
  const ch2 = newChannel()
  go(function*() {
    const msg = yield ch.take()
    t.equal(msg, 'after')
  })
  ch.asyncPut('after')
})

test('go handles errors', function(t) {
  t.plan(1)
  const ch = newChannel()
  t.throws(
    () => go(function*() {
      yield ch.put('hola')
      throw new Error('good')
    }),
    'good'
  )
})
