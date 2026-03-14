#!/usr/bin/env node

import http from 'node:http'
import { spawn } from 'node:child_process'

const host = process.env.OPCHAT_GIT_BRIDGE_HOST ?? '127.0.0.1'
const port = Number.parseInt(process.env.OPCHAT_GIT_BRIDGE_PORT ?? '9001', 10)

const server = http.createServer(async (request, response) => {
  setCors(response)

  if (request.method === 'OPTIONS') {
    response.writeHead(204)
    response.end()
    return
  }

  if (request.method !== 'POST' || !request.url) {
    sendJson(response, 404, { error: 'Not found' })
    return
  }

  try {
    const body = await readJsonBody(request)

    switch (request.url) {
      case '/status': {
        const directory = requireString(body.directory, 'directory')
        const status = await getGitStatus(directory)
        sendJson(response, 200, status)
        return
      }
      case '/commit': {
        const directory = requireString(body.directory, 'directory')
        const message = requireString(body.message, 'message')
        const status = await getGitStatus(directory)
        if (!status.dirty) {
          sendJson(response, 409, { error: '当前 worktree 没有可提交的改动。' })
          return
        }

        await runGit(['-C', directory, 'add', '-A'])
        await runGit(['-C', directory, 'commit', '-m', message])
        sendJson(response, 200, { ok: true })
        return
      }
      case '/merge': {
        const directory = requireString(body.directory, 'directory')
        const branch = requireString(body.branch, 'branch')
        const compare = await runGit(['-C', directory, 'rev-list', '--left-right', '--count', `HEAD...${branch}`])
        const [, aheadCountRaw] = compare.stdout.trim().split(/\s+/)
        const aheadCount = Number.parseInt(aheadCountRaw ?? '0', 10)
        if (!aheadCount) {
          sendJson(response, 409, { error: '当前 worktree 分支没有可合并提交，请先提交改动。' })
          return
        }

        await runGit(['-C', directory, 'merge', branch])
        sendJson(response, 200, { ok: true })
        return
      }
      case '/worktree/remove': {
        const rootDirectory = requireString(body.rootDirectory, 'rootDirectory')
        const worktreeDirectory = requireString(body.worktreeDirectory, 'worktreeDirectory')
        const branch = requireString(body.branch, 'branch')
        const worktreeStatus = await getGitStatus(worktreeDirectory)
        if (worktreeStatus.dirty) {
          sendJson(response, 409, { error: '当前 worktree 还有未提交改动，不能直接删除。' })
          return
        }

        await runGit(['-C', rootDirectory, 'worktree', 'remove', worktreeDirectory])
        await runGit(['-C', rootDirectory, 'branch', '-d', branch])
        sendJson(response, 200, { ok: true })
        return
      }
      default:
        sendJson(response, 404, { error: 'Not found' })
    }
  } catch (error) {
    sendJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(port, host, () => {
  console.log(`[git-bridge] listening on http://${host}:${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}

function setCors(response) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  })
  response.end(JSON.stringify(payload))
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = ''

    request.on('data', (chunk) => {
      raw += String(chunk)
    })
    request.on('end', () => {
      if (!raw.trim()) {
        resolve({})
        return
      }

      try {
        resolve(JSON.parse(raw))
      } catch {
        reject(new Error('请求体不是合法 JSON。'))
      }
    })
    request.on('error', reject)
  })
}

function requireString(value, fieldName) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`缺少字段：${fieldName}`)
  }

  return value.trim()
}

function runGit(args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
    })
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk)
    })
    child.on('error', (error) => {
      reject(new Error(`Git 启动失败：${error.message}`))
    })
    child.on('exit', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr })
        return
      }

      reject(new Error((stderr || stdout || `Git 退出码 ${code ?? 1}`).trim()))
    })
  })
}

async function getGitStatus(directory) {
  const result = await runGit(['-C', directory, 'status', '--porcelain=v1', '--branch'])
  const lines = result.stdout.split(/\r?\n/).filter(Boolean)
  const branchLine = lines[0] ?? ''
  const branch = parseBranchName(branchLine)
  const changedLines = branchLine.startsWith('## ') ? lines.slice(1) : lines

  return {
    branch,
    dirty: changedLines.length > 0,
    changedCount: changedLines.length
  }
}

function parseBranchName(branchLine) {
  if (!branchLine.startsWith('## ')) {
    return ''
  }

  const raw = branchLine.slice(3)
  if (raw.startsWith('HEAD')) {
    return 'HEAD'
  }

  return raw.split('...')[0]?.trim() || raw.trim()
}
