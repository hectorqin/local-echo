const terminal = require('./terminal')
terminal.setCurrentDir(require.main.path)
terminal.initTerminal().listen(9981)