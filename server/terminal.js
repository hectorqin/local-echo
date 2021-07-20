const { parseArgsStringToArgv } = require('string-argv');
const { Worker } = require('worker_threads');
const os = require('os');
const path = require('path');

let currentDir;

const runningWorker = {};

const sendToWorker = function(worker, event, data, replyID) {
    worker.postMessage(
        JSON.stringify({
            event, data, replyID
        })
    );
}

const commandList = {
    async node(context, args, data) {
        if (!args.length) {
            // node 交互式
            const subWorker = new Worker(path.resolve(currentDir, 'terminalWorker.js'), {
                env: Object.assign({}, process.env, {
                    HOME: os.homedir(),
                    TMPDIR: os.tmpdir(),
                }),
                stdout: true,
                stderr: true,
            });

            subWorker.stderr.setEncoding('utf8');
            subWorker.stderr.on('data', function (message) {
              console.log('[stderr]', message.replace(/\n$/g, ""));
              context.output(message);
            });

            subWorker.stdout.setEncoding('utf8');
            subWorker.stdout.on('data', function (message) {
              console.log('[stdout]', message.replace(/\n$/g, ""));
              context.output(message);
            });
            subWorker.on('exit', function (exitCode) {
              context.lastExitCode = exitCode;
              context.end("Exit with code " + exitCode);
            });
            subWorker.on('message', async function (message) {
                if (typeof message === "string") {
                    message = JSON.parse(message);
                }
                if (message.event === 'input') {
                    setTimeout(async () => {
                        let input = await context.input(message.data.prompt);
                        sendToWorker(subWorker, undefined, { input }, message.id);
                    }, 100);
                } else if (message.event === 'log') {
                    console.log(message.message);
                }
            });

            sendToWorker(subWorker, 'nodeREPL');

            runningWorker[context.client.id] = runningWorker[context.client.id] || [];
            runningWorker[context.client.id].push(subWorker);
            context.frontWorker = subWorker;
        } else {
            context.output("running node command " + JSON.stringify(args));
            let count = await context.input("Please input count: ");
            count = parseInt(count) || 3;
            let timerId = setInterval(() => {
                context.output(new Date().getTime());
                count--;
                if (count <= 0 || context.stopLastCommand) {
                    clearInterval(timerId);
                    context.end("end");
                }
            }, 300);
        }
    },
    pwd(context) {
        context.end(process.cwd())
    },
    echo(context, args) {
        context.end(args.join(' '))
    }
};

function defaultServer() {
    const http = require('http');
    const serveStatic = require('serve-static');

    const staticHandler = serveStatic(currentDir, {index: ['index.html']});
    const server = http.createServer(function (req, res) {
      if (
        req.url === '/' ||
        req.url.startsWith('/libs') ||
        req.url.startsWith('/terminal')
      ) {
        staticHandler(req, res, () => {
          res.statusCode = 404;
          res.end();
        });
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    return server;
}

function initTerminal(server)
{
    server = server || defaultServer();
    const io = require('socket.io')(server, {
        cors: {
            origin: "*"
        }
    });
    io.on('connection', client => {
        runningWorker[client.id] = [];
        const context = {
            client,
            lastExitCode: 0,
            inputing: false,
            emit(event, ...args) {
                client.emit(event, ...args);
            },
            input(prompt) {
                if (this.inputing) {
                    return new Promise((resolve, reject) => {
                        setTimeout(() => {
                            this.input(prompt).then(resolve).catch(reject)
                        }, 300);
                    });
                }
                this.inputing = true;
                return new Promise((resolve, reject) => {
                    client.emit('input', prompt, (data) => {
                        this.inputing = false;
                        resolve(data);
                    });
                });
            },
            output(data) {
                if (context.commandId === client.commandId) {
                    client.emit('output', data);
                }
            },
            stopCommand() {
                client.commandId = new Date().getTime();
                context.stopLastCommand = true;
                if (context.end) {
                    context.end("^C");
                } else {
                    context.emit("stopCommand");
                }
            }
        }
        client.on('command', async (data, cb) => {
            try {
                const parsed = parseArgsStringToArgv(data);
                console.log('[command]', parsed);
                if (!commandList[parsed[0]]) {
                    cb("command " + data + " not found");
                    return;
                }
                const command = parsed.shift();
                const commandId = new Date().getTime();
                context.end = cb;
                client.commandId = commandId;
                context.commandId = commandId;
                context.stopLastCommand = false;
                commandList[command](context, parsed, data);
            } catch (error) {
                cb(error.message)
            }
        });
        client.on('stopCommand', () => {
            context.inputing = false;
            if (context.frontWorker) {
                context.frontWorker.terminate();
                context.frontWorker = null;
                setTimeout(() => {
                    context.stopCommand()
                }, 2000);
            } else {
                context.stopCommand()
            }
        });
        client.on('disconnect', () => {
            for (let i = 0; i < runningWorker[client.id].length; i++) {
                const worker = runningWorker[client.id][i];
                if (worker) {
                    worker.terminate();
                }
            }
        });
    });
    return server;
}

function addCommand(command, handler) {
    commandList[command] = handler;
}

function setCurrentDir(cwd) {
    currentDir = cwd;
    return module
}

module.exports = {
    setCurrentDir,
    initTerminal,
    addCommand
}