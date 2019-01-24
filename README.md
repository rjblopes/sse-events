sse-events
=========================

SSE event source polyfill wrapped in Node.js like EventEmitter with performance fixes and custom api. Compatible with React/React-Native.

**Motivation**

 - Improved retry algorithm to avoid loops and memory leaks
 - Automatic close of connection upon server error codes (4xx, 5xx, ...)
 - EventEmitter api
 - Singletron pattern
 - Listeners persisting across retries and/or connection close events
 - Dynamic change of headers, path and parameters
 - Random retry interval to reduce server request concurrency
 - Dynamic progressive fallback interval for long lasting connection retries
 - React/React-Native compatible


**Implementation based on:**

 - [EventSource remy/polyfills](https://github.com/remy/polyfills/blob/master/EventSource.js)
 - [jordanbyron/react-native-event-source](https://github.com/jordanbyron/react-native-event-source)
 - [EventSource/eventsource](https://github.com/EventSource/eventsource).

## Installing

Run the following command in your project's directory to grab the latest published version of this code:

```bash
$ npm install sse-events --save
```

or

```bash
$ yarn add sse-events
```

## Using in your project

```js
import EventSource from 'sse-events';
```

Create an instance, providing the configuration options (optional)

```js
const sse = new EventSource({
  url: SSE_BASE_URL,
  path: '/some/path',
  options: {
    headers: {
      'User-Agent': USER_AGENT,
      Authorization: '...'
    }
  },
  reconnectInterval: 500,
  retryOnNetworkError: false
});
```

Bind few event listeners:

```js

const { ON_ERROR, ON_OPEN } = EventSource.types;

sse.addEventListener('init', message => debug('SSE Init: ', message));
sse.addEventListener(ON_OPEN, () => {
  sse.retrying = false;
});

sse.addEventListener(ON_ERROR, (error: ESError) => {
  // refresh login
  if (
    error &&
    !sse.retrying &&
    error.data && error.data.code &&
    (
      (error.data.code >= 200 && error.data.code <= 202) ||
      error.data.code === 204
    )
  ) {
    delete sse.options.headers.Authorization;
    sse.retrying = true;
    store.dispatch(refreshLogin())
      .then(res => (res.data && sse.open()))
      .catch(() => null);
    return;
  }

  sse.retrying = false;
});
```

Now call the `open` method to establish the connection. No matter how may times this method is called, just
one AND ONLY ONE connection is open a time. Some errors can interrupt the SSE retry algorithm and thus further call to this method is required to re-establish the connection. Listeners DON'T CLOSE if this method is called.

```js
sse.open();
```

SSE connection can be suspended calling the `close` method. Instance headers, params or other options don't apply to the on-going connection unless manually closed and open again.

```js
sse.close();
```

To close the connection and remove all listeners call the `destroy` method. Following calls to `open` WILL NOT restore previous event listeners.

```js
sse.destroy();
```

Headers params can be set/updated calling this method.

```js
sse.setHeaders({
  Authorization: '...'
});
```

Url params can be set/updated calling this method.

```js
sse.setParams({
  scope: 'all'
});
```

Connection url and path can be set/updated directly from instance properties.

```js
sse.path = '/path/to/sse/resource';
sse.url = 'example.com'
```

## Connection States

```js
// States
const {
  CONNECTING = 0, // trying to connect. No events.
  OPEN = 1, // connection established and running. Auto-retry enabled and events
  CLOSED = 2 // connection is closed. Auto-retry disabled and no events
} = sse;
```

## Event Types

```js
const {
  ON_OPEN = 'open', // readyState goes from CONNECTING -> OPEN
  ON_ERROR = 'error', // SSE, network or server response errors
  ON_CLOSE = 'close', // readyState goes to CLOSED
  ON_STATE = 'state', // readyState has changed
  ON_TIMEOUT = 'timeout' // server closed connection
} = EventSource.types;
```

## Configuration Options
```js
/**
 * Reference time interval between retry attempts in ms. Actual interval is randomly selected
 * between 100ms and this value to reduce server request blocking. For retry attempts, after
 * network errors, actual interval is randomly selected using a fallback progressive.
 * Default value 1000 ms.
 * @type {Number}
 */
sse.reconnectInterval || 1000;

/**
 * Max fallback retry interval in ms.
 * Default value 15000 ms
 * @type {Number}
 */
sse.maxInterval || 15000;

/**
 * Min fallback retry interval in ms.
 * Default value 1000 ms
 * @type {Number}
 */
sse.minInterval || 1000;

/**
 * Max number of retry attempts before closing the connection. Negative value means unlimited
 * attempts.
 * Default value -1 (no limit).
 * @type {Number}
 */
sse.maxAttempts || -1;

/**
 * Retry to connect on network or other internal errors.
 * Default value true.
 * @type {Boolean}
 */
sse.retryOnNetworkError || true;

/**
 * Retry to connect on server error response.
 * Default value false.
 * @type {Boolean}
 */
sse.retryOnServerError || false;

/**
 * Server error status codes to retry connection.
 * Default value [502, 503, 504]
 * @type {Array}
 */
sse.serverErrorCodes  || [502, 503, 504];

/**
 * Connection URL
 * @type {String}
 */
sse.url

/**
 * SSE Connection Options
 * @type {Object}
 */
sse.options

/**
 * Connection URL params
 * @type {Object}
 */
sse.params

/**
 * Connection URL path
 * @type {Object}
 */
sse.path

/**
 * SSE Connection State
 * @type {CONNECTING|OPENED|CLOSED}
 */
sse.readyState
```

## License

This project is licensed under the MIT License
