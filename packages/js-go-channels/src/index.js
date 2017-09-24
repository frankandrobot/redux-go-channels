import {LinkedListBuffer, uuid, checkGenerator} from './utils'


export const initialStateFn = () => ({
  /**
   * map of active channels
   */
  channels: {},
  dataProducers: {},
  dataConsumers: {},
  /**
   * array of range requests
   */
  rangeRequests: [],
})

const state = initialStateFn()

const cTakeRequest = 'take'
const cPutRequest = 'put'
const cCloseRequest = 'close'
const cSelectRequest = 'select'

const putCloseError = new Error('Cannot put on a closed channel')

const dummyIterator = {
  next: () => ({value: undefined, done: true}),
  throw: () => ({value: undefined, done: true}),
  return: () => ({value: undefined, done: true}),
}

function scheduler(
  {
    state: {
      dataProducers,
      dataConsumers,
      channels,
    },
    generator: {
      iterator,
      request,
    },
    stopScheduler
  },
) {
  // Give the iterator the iteratorMessage and pass the result to the
  // scheduler
  const nextTick = (iterator, iteratorMessage) => {
    const {
      value: request,
      done: stopScheduler,
    } = iterator.next(iteratorMessage)
    setTimeout(
n      () => scheduler({
        state: {dataProducers, dataConsumers, channels},
        generator: {
          iterator,
          request,
        },
        stopScheduler,
      }),
      0
    )
  }
  // Give the iterator the error and pass the result to the scheduler
  const nextTickThrow = (iterator, error) => {
    const {
      value: request,
      done: stopScheduler,
    } = iterator.throw(error)
    setTimeout(
      () => scheduler({
        state: {dataProducers, dataConsumers, channels},
        generator: {
          iterator,
          request,
        },
        stopScheduler,
      }),
      0
    )
  }
  // if no request, then at start of generator, so get one
  if (!request && !stopScheduler) {
    return nextTick(iterator)
  }
  // if this generator is done, then goodbye
  if (stopScheduler) {
    return
  }
  const {type: requestType, chanId, payload} = request
  switch(requestType) {
  case cTakeRequest: {
    // check if the channel is closed
    if (!channels[chanId]) {
      // if the channel is closed (buffer doesn't exist), then pass
      // back undefined, done = true to the iterator.
      return nextTick(iterator, {value: undefined, done: true})
    }
    // do we have any sleeping data producers?
    const producer = dataProducers[chanId].pop()
    if (producer) {
      const {iterator: producerIterator, payload: {msg}} = producer
      // give this iterator the msg
      nextTick(iterator, {value: msg, done: false})
      // also wake up the data producer
      nextTick(producerIterator)
    } else {
      // add ourselves to the waiting list and hopefully we'll be
      // woken up in the future
      dataConsumers[chanId].add({iterator, type: requestType})
    }
    return
  }
    // select returns the first data producer that fires. Sends back
    // an array to the iterator. Just fire the first channel that
    // receives a message: go thru the selected channels and try to
    // get values. stop at the first that has a value.
  case cSelectRequest: {
    const {chanIds} = payload
    let chanData = null
    let producer = null
    // do we have any sleeping producers?
    for(let i=0; i<chanIds.length; i++) {
      const _chanId = chanIds[i]
      if (!channels[_chanId]) {
        // if channel was closed then send undefined
        chanData = {value: undefined, done: true, chanNum: i}
        break
      } 
      producer = dataProducers[_chanId].pop()
      if (producer) {
        const {payload: {msg}} = producer
        chanData = {value: msg, done: false, chanNum: i}
        break
      }
    }
    if (chanData) {
      // wake up the producer
      producer && nextTick(producer.iterator)
      const response = new Array(chanIds.length)
      response[chanData.chanNum] = {value: chanData.value, done: chanData.done}
      nextTick(iterator, response)
    } else {
      // there were no sleeping producers
      for(let i=0; i<chanIds.length; i++) {
        dataConsumers[chanIds[i]].add({
          iterator,
          type: requestType,
          payload,
        })
      }
    }
    return
  }
  case cPutRequest: {
    // First check if the channel is closed.
    if (!channels[chanId]) {
      nextTickThrow(iterator, putCloseError)
      return
    }
    const {msg} = payload
    // do we have any takers?
    const consumer = dataConsumers[chanId].pop()
    if (consumer) {
      const {iterator: consumerIterator, requestType, payload} = consumer
      nextTick(iterator)
      // wake up the consumer iterator with the msg
      if (requestType === cSelectRequest) {
        const {chanIds} = payload
        const i = chanIds.indexOf(chanId)
        const response = new Array(chanIds.length)
        response[i] = {value: msg, done: false}
        nextTick(consumerIterator, response)
      } else {
        nextTick(consumerIterator, {value: msg, done: false})
      }
    } else {
      // let's wait for a data consumer
      dataProducers[chanId].add({iterator, payload})
    }
    return
  }
  case cCloseRequest: {
    if (!channels[chanId]) {
      nextTickThrow(iterator, new Error('Channel is already closed'))
      return
    }
    // turn off channel
    delete channels[chanId]
    // tell any pending consumers the channel is closed
    const consumers = dataConsumers[chanId]
    let consumer = consumers.pop()
    while(consumer) {
      const {iterator: consumerIterator} = consumer
      nextTick(consumerIterator, {value: undefined, done: true})
      consumer = consumers.pop()
    }
    delete dataConsumers[chanId]
    // hope we don't have pending producers
    const producers = dataProducers[chanId]
    let producer = producers.pop()
    while(producer) {
      const {iterator: producerIterator} = producer
      nextTickThrow(
        producerIterator,
        putCloseError,
      producer = producers.pop()
    }
    delete dataProducers[chanId]
    nextTick(iterator)
    return
  }
  }
}

export function go(generator) {
  const iterator = checkGenerator(generator)
  // so `go` kicks off the scheduler
  scheduler({
    state,
    generator: {
      iterator,
      request: undefined,
      done: false,
    }
  })
}

export function newChannel() {
  const {channels, dataProducers, dataConsumers} = state
  const chanId = uuid()
  channels[chanId] = true
  dataProducers[chanId] = new LinkedListBuffer()
  dataConsumers[chanId] = new LinkedListBuffer()
  const channel = {
    get _id() {
      return chanId
    },
    take(_msgId) {
      return {
        chanId,
        type: cTakeRequest,
        payload: {}
      }
    },
    put(msg) {
      return {
        chanId,
        type: cPutRequest,
        payload: {msg},
      }
    },
    asyncPut(msg) {
      if (!channels[chanId]) {
        throw putCloseError
      }
      scheduler({
        state,
        generator: {
          // pass a dummyIterator. We don't care about any errors that
          // may happen down the road, nor do we need any messages
          // from the scheduler
          iterator: dummyIterator,
          request: channel.put(msg)
        },
        stopScheduler: false
      })
    },
  }
  return channel
}

export function close(channel, _msgId) {
  return {
    _msgId,
    chanId: channel._id,
    type: cCloseRequest,
    payload: {channel},
  }
}

export function select(...channels) {
  return {
    type: cSelectRequest,
    payload: {chanIds: channels.map(x => x._id) || []},
  }
}
