'use strict'

const pty = require('node-pty')
const { createHash } = require('node:crypto')
const { readFileSync } = require('node:fs')
const { Client } = require('ssh2')

const parentPort = process.parentPort
let terminal = null
let sshClient = null
let terminalKind = null
let closing = false

const send = (message) => {
  try {
    parentPort?.postMessage(message)
  } catch {
    // The Electron parent has already gone away.
  }
}

const closeTerminal = () => {
  if (closing) return
  closing = true
  if (!terminal) {
    if (sshClient) sshClient.end()
    process.exit(0)
    return
  }
  if (terminalKind === 'ssh') {
    try { terminal.close() } catch {}
    try { sshClient?.end() } catch {}
    setTimeout(() => process.exit(0), 100)
    return
  }
  try {
    terminal.kill()
  } catch {
    process.exit(0)
  }
}

parentPort?.on('message', ({ data }) => {
  if (!data || typeof data !== 'object') return
  if (data.type === 'start') {
    if (terminal) return
    if (data.kind === 'ssh') {
      try {
        const connection = data.connection
        sshClient = new Client()
        const config = {
          host: connection.host,
          port: connection.port,
          username: connection.username,
          readyTimeout: 15_000,
          keepaliveInterval: 10_000,
          keepaliveCountMax: 3,
          hostVerifier: (key) => {
            const fingerprint = 'SHA256:' + createHash('sha256')
              .update(key).digest('base64').replace(/=+$/, '')
            return fingerprint === connection.hostFingerprint
          },
        }
        let keyboardPassword = null
        if (connection.authenticationType === 'password') {
          if (!connection.password) throw new Error('No password is stored for this connection.')
          config.password = connection.password
          config.tryKeyboard = true
          keyboardPassword = connection.password
        } else if (connection.authenticationType === 'private-key') {
          if (!connection.privateKeyPath) throw new Error('No private key is configured.')
          config.privateKey = readFileSync(connection.privateKeyPath)
          if (connection.passphrase) config.passphrase = connection.passphrase
        } else {
          if (!connection.agentSocket) throw new Error('No SSH agent socket is available.')
          config.agent = connection.agentSocket
        }
        sshClient.on('keyboard-interactive', (_name, _instructions, _language, prompts, complete) => {
          complete(prompts.map(() => keyboardPassword || ''))
        })
        sshClient.once('ready', () => {
          sshClient.shell({
            term: 'xterm-256color',
            cols: data.cols,
            rows: data.rows,
            width: 0,
            height: 0,
          }, (error, stream) => {
            if (error) {
              send({ type: 'error', message: error.message })
              process.exit(1)
              return
            }
            terminalKind = 'ssh'
            terminal = stream
            stream.on('data', (chunk) => send({ type: 'data', chunk: chunk.toString('utf8') }))
            stream.stderr?.on('data', (chunk) =>
              send({ type: 'data', chunk: chunk.toString('utf8') }))
            stream.once('close', (code) => {
              send({ type: 'exit', exitCode: typeof code === 'number' ? code : 0 })
              sshClient?.end()
              process.exit(0)
            })
            send({ type: 'ready' })
          })
        })
        sshClient.once('error', (error) => {
          send({ type: 'error', message: error.message })
          process.exit(1)
        })
        sshClient.connect(config)
      } catch (error) {
        send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
        process.exit(1)
      }
      return
    }
    try {
      terminalKind = 'local'
      terminal = pty.spawn(data.executable, data.args, {
        name: 'xterm-256color',
        cols: data.cols,
        rows: data.rows,
        cwd: data.cwd,
        env: data.env,
        handleFlowControl: true,
        ...(process.platform === 'win32'
          ? { useConpty: true, useConptyDll: true }
          : {}),
      })
      terminal.onData((chunk) => send({ type: 'data', chunk }))
      terminal.onExit(({ exitCode }) => {
        send({ type: 'exit', exitCode })
        process.exit(0)
      })
      send({ type: 'ready', pid: terminal.pid })
    } catch (error) {
      send({
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
      process.exit(1)
    }
    return
  }
  if (!terminal) return
  if (data.type === 'write' && typeof data.data === 'string') terminal.write(data.data)
  if (data.type === 'resize') {
    if (terminalKind === 'ssh') terminal.setWindow(data.rows, data.cols, 0, 0)
    else terminal.resize(data.cols, data.rows)
  }
  if (data.type === 'kill') closeTerminal()
})

process.on('uncaughtException', (error) => {
  send({ type: 'error', message: error.message })
  process.exit(1)
})

process.on('disconnect', closeTerminal)
