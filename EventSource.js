// EventSource.js
// Original implementation from
// https://github.com/remy/polyfills/blob/master/EventSource.js
// https://github.com/jordanbyron/react-native-event-source
// https://github.com/EventSource/eventsource
//


const EventEmitter = require('eventemitter3');
const url = require('url');

const reTrim = /^(\s|\u00A0)+|(\s|\u00A0)+$/g;

const types = {
  ON_OPEN: 'open', // readyState goes from CONNECTING -> OPEN
  ON_ERROR: 'error', // SSE, network or server response errors
  ON_CLOSE: 'close', // readyState goes to CLOSED
  ON_STATE: 'state', // readyState has changed
  ON_TIMEOUT: 'timeout' // server closed connection
};

const MessageEvent = (data = null, origin = '', lastEventId = '') => ({
  type: 'message',
  data,
  lastEventId,
  origin
});

// Interval calculation

const randomInterval = (max, min = 0) => Math.floor((Math.random() * (max + 1 - min) + min));
const backoffInterval = (attempt, delay = 100, maxDelay = 120000) => {
  let current = 1;
  let prev;
  if (attempt > current) {
    prev = 1;
    current = 2;
    for (let index = 2; index < attempt; index++) {
        const next = prev + current;
        prev = current;
        current = next;
        if (delay + (current * 100) > maxDelay) break;
    }
  }

  return delay + randomInterval(current * 100)
};


class EventSource extends EventEmitter {
  constructor({
    url,
    options = {},
    params = {},
    path = '',
    reconnectInterval,
    maxInterval,
    minInterval,
    maxAttempts,
    retryOnNetworkError,
    retryOnServerError,
    serverErrorCodes
  } = {}) {
    super();

    // States
    this.CONNECTING = 0;
    this.OPEN = 1;
    this.CLOSED = 2;

    // Configuration
    /**
     * Reference time interval between re-connection attempts in ms. Actual interval is randomly selected
     * between 100ms and this value to reduce server request blocking. For retry attempts, following
     * network errors, actual interval is randomly selected using a progressiver random algorithm with this value
     * as the min interval. Default to 1000 ms.
     * @type {Number}
     */
    this.RECONNECT_INTERVAL = reconnectInterval || 1000;
    /**
     * Max retry time interval in ms. Default to 15000 ms
     * @type {Number}
     */
    this.MAX_INTERVAL = maxInterval || 15000;
    /**
     * Min retry time interval in ms. Default to 1000 ms
     * @type {Number}
     */
    this.MIN_INTERVAL = minInterval || 1000;
    /**
     * Max number of retry attempts before closing the connection. Negative value means unlimited
     * attempts. Default to -1 (no limit).
     * @type {Number}
     */
    this.MAX_ATTEMPTS = maxAttempts || -1;
    /**
     * Retry to connect on network or other internal errors. Default to true.
     * @type {Boolean}
     */
    this.RETRY_ON_NETWORK_ERROR = retryOnNetworkError || true;
    /**
     * Retry to connect on server error response. Default to false.
     * @type {Boolean}
     */
    this.RETRY_ON_SERVER_ERROR = retryOnServerError || false;
    /**
     * Server error status codes to retry connection. Default to [502, 503, 504]
     * @type {Array}
     */
    this.SERVER_ERROR_CODES = serverErrorCodes  || [502, 503, 504];

    /**
     * Connection URL
     * @type {String}
     */
    this.url = url;
    /**
     * SSE Connection Options
     * @type {Object}
     */
    this.options = options;
    /**
     * Connection URL params
     * @type {Object}
     */
    this.params = params;
    this.path = path;
    /**
     * SSE Connection State
     * @type {CONNECTING|OPENED|CLOSED}
     */
    this.readyState = undefined;
    this.lastEventId = null;
    this._pollTimer = null;
    this._xhr = null;
    this._attempts = 0;
  }

  /**
   * Adds or edits request headers parameters
   * @param {Object} [headers={}] Headers params
   */
  setHeaders(headers = {}) {
    this.options.headers = {
      ...this.options.headers,
      ...headers
    };
  }

  /**
   * Adds or edits request query parameters
   * @param {Object} [params={}] Query parameters
   */
  setParams(params = {}) {
    this.params = {
      ...this.params,
      ...params
    };
  }

  /**
   * Opens SSE connection to the server, if not opened yet. Only one connection
   * is open a time, regardeless of how many times this method is called.
   * @return {this}
   */
  open() {
    if (
      (!this._xhr || this._xhr.readyState === 4 || this._xhr.readyState === 0)
      && !this._pollTimer
    ) {
      this._setReadyState(this.CONNECTING);
      this._poll();
    }
    return this;
  }

  /**
   * Closes SSE connection with the server, if not closed yet. Also used internally.
   * @param  {Boolean} [error=false] Flag to indicate closing after an error
   * @return {this}
   */
  close(error = false) {
    if (this.readyState === this.CLOSED) return;

    // closes the connection - disabling the polling
    this._setReadyState(this.CLOSED);
    clearInterval(this._pollTimer);
    this._pollTimer = null;
    this._xhr && this._xhr.abort();
    this._attempts = 0;
    this.emit(types.ON_CLOSE, {
      type: types.ON_CLOSE,
      error
    });

    return this;
  }

  /**
   * Close SSE connection (if not closed yet) and remove all event listeners
   */
  destroy() {
    this.close();
    this.removeAllListeners();
  }

  /**
   * Adds event listener. Listners persist after connection is closed.
   * @param {String} type    Event type
   * @param {Function} handler Event handler
   */
  addEventListener(type, handler) {
    if (typeof handler === 'function') {
      handler._handler = handler;
      return this.on(type, handler);
    }
  }

  /**
   * Remove event listener
   * @param {String} type    Event type
   * @param {Function} handler Event handler
   */
  removeEventListener(type, handler) {
    return this.removeListener(type, handler);
  }

  /**
   * Initiates an XHR object and attach event handlers
   * @private
   */
  _poll() {
    const {
      CONNECTING, OPEN, CLOSED, options, params
    } = this;

    const self = this;
    try { // force hiding of the error message... insane?
      if (this.readyState === CLOSED) return;

      const href = url.parse(`${this.url}${this.path}`, true);
      href.search = null;
      href.query = { ...href.query, ...params };

      // NOTE: IE7 and upwards support
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url.format(href), true);
      if (options && options.headers) {
        Object.keys(options.headers).forEach(key => {
          xhr.setRequestHeader(key, options.headers[key]);
        });
      }
      xhr.setRequestHeader('Accept', 'text/event-stream');
      xhr.setRequestHeader('Cache-Control', 'no-cache');
      // we must make use of this on the server side if we're working with Android - because they don't trigger
      // readychange until the server connection is closed
      xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');

      if (this.lastEventId) xhr.setRequestHeader('Last-Event-ID', this.lastEventId);

      let cache = '';
      xhr.onreadystatechange = function () {
        if (
          this.readyState === 3 ||
          (this.readyState === 4 && this.status === 200)
        ) {
          // on success
          if (self.readyState === CONNECTING && this.status === 200) {
            // on open
            self._setReadyState(OPEN);
            self.emit(types.ON_OPEN, {
              type: types.ON_OPEN,
              url: self.url,
              options: self.options
            });
            // reset retries attempts
            self._attempts = 0;
          }

          // process this.responseText
          const responseText = this.responseText || '';
          let data = [];
          let parts = responseText.substr(cache.length).split("\n");
          let i = 0;
          let line = '';
          let eventType;

          cache = responseText;

          // TODO handle 'event' (for buffer name), retry
          for (; i < parts.length; i++) {
            line = parts[i].replace(reTrim, '');
            if (line.indexOf('event') === 0) {
              eventType = line.replace(/event:?\s*/, '');
            } else if (line.indexOf('retry') === 0) {
              retry = parseInt(line.replace(/retry:?\s*/, ''));
              if(!isNaN(retry)) { interval = retry; }
            } else if (line.indexOf('data') === 0) {
              data.push(line.replace(/data:?\s*/, ''));
            } else if (line.indexOf('id:') === 0) {
              self.lastEventId = line.replace(/id:?\s*/, '');
            } else if (line.indexOf('id') === 0) { // this resets the id
              self.lastEventId = null;
            } else if (line == '') {
              if (data.length) {
                self._emitMessage(
                  eventType || 'message',
                  MessageEvent(data.join('\n'), `${self.url}${self.path}`, self.lastEventId)
                );
                data = [];
                eventType = undefined;
              }
            }
          }

          if (this.readyState === 4) {
            // on server close
            self.emit(types.ON_TIMEOUT, { type: types.ON_TIMEOUT });
            // reconnect ASAP
            const interval = randomInterval(self.RECONNECT_INTERVAL, 100);
            self._pollAgain(interval);
          }
        } else if (this.readyState === 4) {
          if (this.status !== 0) {
            // Server error responses
            self._emitError(this.status, this.responseText);

            // Reconnect if required
            if (
              self.RETRY_ON_SERVER_ERROR &&
              self.SERVER_ERROR_CODES.includes(this.status) &&
              (self.MAX_ATTEMPTS < 0 || self._attempts < self.MAX_ATTEMPTS)
            ) {
              // Attempt to reconnect
              self._setReadyState(CONNECTING);
              self._retry();
              return;
            }

            // Close connection
            self.close(true);
          }
        }
      };

      xhr.onerror = function(e) {
        // Select network errors
        if (this.status === 0) {
          // Discard errors on retries
          if (self._attempts === 0) {
            self._emitError(this.status, this.responseText);
          }

          if (
            self.RETRY_ON_NETWORK_ERROR &&
            (self.MAX_ATTEMPTS < 0 || self._attempts < self.MAX_ATTEMPTS)
          ) {
            // Attempt to reconnect
            self._setReadyState(CONNECTING);
            self._retry();
            return;
          }

          self.close(true);
        }
      }

      xhr.send();

      this._xhr = xhr;

    } catch (e) { // in an attempt to silence the errors
      self._emitError(0, this.responseText);
      this.close(true);
    }
  }

  /**
   * Schedules a _poll() call
   * @private
   */
  _pollAgain(interval) {
    this._pollTimer = setTimeout(() => {
      this._poll();
    }, interval);
  }

  /**
   * Schedules a _poll() call with longer and progressive interval
   * @private
   */
  _retry() {
    this._attempts += 1;
    const interval = backoffInterval(this._attempts, this.MIN_INTERVAL, this.MAX_INTERVAL);
    this._pollAgain(interval);
  }

  /**
   * Sets this readyState property and emits state change event
   * @private
   */
  _setReadyState(state) {
    const prevState = this.readyState;
    if (prevState !== state) {
      this.readyState = state;
      this.emit(types.ON_STATE, {
        type: types.ON_STATE,
        state,
        prevState
      });
    }
  }

  /**
   * Tries to parse error message and emits it
   * @param  {Number} status  Reponse status
   * @param  {String} message Error message
   */
  _emitError(status, message) {
    let data = {};
    if (status !== 0) {
      try {
        data = JSON.parse(message)
      } catch (e) {};
    }

    this.emit(types.ON_ERROR, {
      type: types.ON_ERROR,
      status,
      message,
      data
    });
  }

  /**
   * Tries to decode message payload and emits it
   * @param  {String} type    Message type
   * @param  {Object} message Message content
   */
  _emitMessage(type, message = {}) {
    let decodedData = message.data;
    if (message.data) {
      try {
        decodedData = JSON.parse(message.data);
      } catch (e) {}
    }

    this.emit(type, { ...message, data: decodedData });
  }
}

EventSource.types = types;
module.exports = EventSource;
