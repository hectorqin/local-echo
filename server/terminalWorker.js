const {
  isMainThread,
  parentPort,
  workerData,
  threadId: workerID,
} = require("worker_threads");
const EventEmitter = require('events');
const { inspect } = require('util');
const { Console } = require('console');

const emitter = new EventEmitter();

emitter.setMaxListeners(10000);
let stopRunning = false;
let inspectDepth = 2;
let showHidden = false;
const myConsole = new Console({ stdout: process.stdout, stderr: process.stderr, inspectOptions: {
    colors: true,
    depth: inspectDepth,
    showHidden: showHidden
}});
['assert', 'clear', 'count', 'countReset', 'debug', 'dir', 'dirxml', 'error', 'group', 'groupCollapsed', 'groupEnd', 'info', 'log', 'table', 'time', 'timeEnd', 'timeLog', 'trace', 'warn', 'profile', 'profileEnd', 'timeStamp'].forEach(k => {
    console[k] = myConsole[k]
})

function listenFromParent() {
  parentPort.on("message", (message) => {
    logToParent("listenFromParent: ", message);
    if (typeof message === "string") {
      message = JSON.parse(message);
    }
    if (typeof message === "object") {
      if (message.replyID) {
        emitter.emit(message.replyID, message);
      }

      if (message.event) {
        emitter.emit(message.event, message);
      }
    }
    emitter.emit("message", message);
  });

  parentPort.on("messageerror", (message) => {
    logToParent(message);
  });

  parentPort.on("online", (message) => {
    logToParent("Parent thread online ", message);
  });
}

function postToParent(event, data, replyID) {
    return new Promise((resolve, reject) => {
      const requestID = 'req-' + new Date().getTime();
      const message = JSON.stringify({
        id: requestID,
        replyID,
        event,
        workerID,
        data,
      });
      logToParent('postToParent: ' + message);
      parentPort.postMessage(message);
      emitter.once(requestID, (ev) => {
        resolve(ev);
      });
      emitter.once('stop', () => {
        reject('');
      })
    });
}

function logToParent(...message) {
    try {
        parentPort.postMessage({
            event: 'log',
            message: '[worker] ' + message.map(v => {return typeof v === 'object' ? JSON.stringify(v) : v }).join(' ')
        });
    } catch (error) {
        console.error(error)
    }
}

function input(prompt) {
    return postToParent('input', {
        prompt
    }).then((ev) => {
        return ev.data.input || ''
    });
}

async function nodeREPL() {
    console.log("Welcome to Node.js");
    while(!stopRunning) {
        const code = await input("> ");
        if (!code) {
            continue;
        }
        logToParent("Running: ", code);
        try {
            const result = eval(code);
            console.log(inspect(result, showHidden, inspectDepth, true))
        } catch (error) {
            console.log(error + '')
        }
    }
}

function main() {
    emitter.on('nodeREPL', function (message) {
        nodeREPL();
    });

    emitter.on('stop', function () {
        stopRunning = true;
    });
    listenFromParent();
}

function throwError(msg) {
    console.error(msg);
    if (typeof msg !== 'string') {
      throw msg;
    }
    throw new Error(msg);
}

try {
    main();
} catch (error) {
    throwError(error)
}