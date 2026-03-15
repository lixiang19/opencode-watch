#!/usr/bin/env node

import fs from 'node:fs'
import http from 'node:http'
import crypto from 'node:crypto'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const distRoot = path.join(projectRoot, 'dist')

const host = process.env.OPCHAT_BACKEND_HOST ?? '127.0.0.1'
const port = parsePort(process.env.OPCHAT_BACKEND_PORT, 9001)
const staticMode = (process.env.OPCHAT_STATIC_MODE ?? 'off').toLowerCase() === 'on'
const statusCacheTtlMs = 3000
const sessionTtlMs = 1000 * 60 * 60 * 24 * 7
const loginWindowMs = 1000 * 60 * 10
const maxLoginAttempts = 10
const sessionCookieName = 'opchat_admin_session'
const csrfHeaderName = 'x-opchat-csrf'
const defaultAdminUsername = process.env.OPCHAT_ADMIN_USERNAME?.trim() || 'admin'
const configuredAdminPassword = process.env.OPCHAT_ADMIN_PASSWORD?.trim() || ''
const generatedAdminPassword = configuredAdminPassword ? '' : crypto.randomBytes(18).toString('base64url')
const effectiveAdminPassword = configuredAdminPassword || generatedAdminPassword

const statusCache = new Map()
const pendingStatusRequests = new Map()
const adminSessions = new Map()
const loginAttempts = new Map()

const server = http.createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || '/', `http://${host}:${port}`)

    if (requestUrl.pathname.startsWith('/api/auth/')) {
      await handleAuthRequest(request, response, requestUrl)
      return
    }

    if (requestUrl.pathname.startsWith('/api/admin/')) {
      await handleAdminApiRequest(request, response, requestUrl)
      return
    }

    if (staticMode) {
      await handleStaticRequest(response, requestUrl)
      return
    }

    sendJson(response, 404, { error: 'Not found' })
  } catch (error) {
    sendJson(response, 500, { error: error instanceof Error ? error.message : String(error) })
  }
})

server.listen(port, host, () => {
  console.log(`[local-backend] listening on http://${host}:${port}`)
  if (generatedAdminPassword) {
    console.log(`[local-backend] OPCHAT_ADMIN_PASSWORD 未设置，已生成临时管理密码：${generatedAdminPassword}`)
  }
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0))
  })
}

async function handleAuthRequest(request, response, requestUrl) {
  cleanupExpiredAdminSessions()

  if (request.method === 'GET' && requestUrl.pathname === '/api/auth/session') {
    const session = getAdminSession(request)
    if (!session) {
      clearAdminSessionCookie(response, request)
      sendJson(response, 200, { authenticated: false })
      return
    }

    touchAdminSession(session.id)
    sendJson(response, 200, {
      authenticated: true,
      username: defaultAdminUsername,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString()
    })
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/auth/login') {
    const remoteAddress = getRemoteAddress(request)
    if (!canAttemptLogin(remoteAddress)) {
      sendJson(response, 429, { error: '登录尝试过于频繁，请稍后再试。' })
      return
    }

    const body = await readJsonBody(request)
    const password = requireString(body.password, 'password')

    if (!safeEquals(password, effectiveAdminPassword)) {
      recordFailedLoginAttempt(remoteAddress)
      sendJson(response, 401, { error: '管理密码错误。' })
      return
    }

    clearFailedLoginAttempts(remoteAddress)
    const session = createAdminSession(request, response)
    sendJson(response, 200, {
      ok: true,
      username: defaultAdminUsername,
      csrfToken: session.csrfToken,
      expiresAt: new Date(session.expiresAt).toISOString()
    })
    return
  }

  if (request.method === 'POST' && requestUrl.pathname === '/api/auth/logout') {
    const session = getAdminSession(request)
    if (session) {
      const csrfError = validateCsrf(request, session)
      if (csrfError) {
        sendJson(response, 403, { error: csrfError })
        return
      }

      adminSessions.delete(session.id)
    }

    clearAdminSessionCookie(response, request)
    sendJson(response, 200, { ok: true })
    return
  }

  sendJson(response, 404, { error: 'Not found' })
}

async function handleAdminApiRequest(request, response, requestUrl) {
  if (!request.method) {
    sendJson(response, 405, { error: 'Method not allowed' })
    return
  }

  const session = requireAdminSession(request, response)
  if (!session) {
    return
  }

  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' })
    return
  }

  const csrfError = validateCsrf(request, session)
  if (csrfError) {
    sendJson(response, 403, { error: csrfError })
    return
  }

  const body = await readJsonBody(request)

  switch (requestUrl.pathname) {
    case '/api/admin/git/status': {
      const directory = requireString(body.directory, 'directory')
      const status = await getGitStatus(directory)
      sendJson(response, 200, status)
      return
    }
    case '/api/admin/git/commit': {
      const directory = requireString(body.directory, 'directory')
      const message = requireString(body.message, 'message')
      const status = await getGitStatus(directory)
      if (!status.dirty) {
        sendJson(response, 409, { error: '当前 worktree 没有可提交的改动。' })
        return
      }

      await runGit(['-C', directory, 'add', '-A'])
      await runGit(['-C', directory, 'commit', '-m', message])
      clearStatusCache([directory])
      sendJson(response, 200, { ok: true })
      return
    }
    case '/api/admin/git/merge': {
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
      clearStatusCache([directory])
      sendJson(response, 200, { ok: true })
      return
    }
    case '/api/admin/git/worktree/remove': {
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
      clearStatusCache([rootDirectory, worktreeDirectory])
      sendJson(response, 200, { ok: true })
      return
    }
    default:
      sendJson(response, 404, { error: 'Not found' })
  }
}

async function handleStaticRequest(response, requestUrl) {
  const pathname = decodeURIComponent(requestUrl.pathname)
  const filePath = resolveStaticPath(pathname)

  if (!filePath) {
    sendJson(response, 403, { error: 'Forbidden' })
    return
  }

  const existingPath = await resolveExistingStaticPath(filePath)
  const finalPath = existingPath ?? path.join(distRoot, 'index.html')

  if (!fs.existsSync(finalPath)) {
    sendJson(response, 500, { error: '前端构建产物不存在，请先运行 `npm run build`。' })
    return
  }

  sendFile(response, finalPath)
}

function requireAdminSession(request, response) {
  cleanupExpiredAdminSessions()

  const session = getAdminSession(request)
  if (!session) {
    clearAdminSessionCookie(response, request)
    sendJson(response, 401, { error: '请先完成管理端登录。' })
    return null
  }

  touchAdminSession(session.id)
  return session
}

function createAdminSession(request, response) {
  const id = crypto.randomUUID()
  const csrfToken = crypto.randomBytes(18).toString('base64url')
  const session = {
    id,
    csrfToken,
    createdAt: Date.now(),
    expiresAt: Date.now() + sessionTtlMs,
    remoteAddress: getRemoteAddress(request)
  }

  adminSessions.set(id, session)
  setAdminSessionCookie(response, request, id)
  return session
}

function getAdminSession(request) {
  const cookies = parseCookieHeader(request.headers.cookie)
  const sessionId = cookies[sessionCookieName]
  if (!sessionId) {
    return null
  }

  const session = adminSessions.get(sessionId)
  if (!session || session.expiresAt <= Date.now()) {
    adminSessions.delete(sessionId)
    return null
  }

  return session
}

function touchAdminSession(sessionId) {
  const session = adminSessions.get(sessionId)
  if (!session) {
    return
  }

  session.expiresAt = Date.now() + sessionTtlMs
}

function validateCsrf(request, session) {
  const csrfToken = request.headers[csrfHeaderName]
  if (typeof csrfToken !== 'string' || !csrfToken || !safeEquals(csrfToken, session.csrfToken)) {
    return 'CSRF 校验失败。'
  }

  return ''
}

function cleanupExpiredAdminSessions() {
  const now = Date.now()
  for (const [sessionId, session] of adminSessions.entries()) {
    if (session.expiresAt <= now) {
      adminSessions.delete(sessionId)
    }
  }
}

function setAdminSessionCookie(response, request, sessionId) {
  response.setHeader('Set-Cookie', buildSessionCookieValue(request, sessionId, sessionTtlMs))
}

function clearAdminSessionCookie(response, request) {
  response.setHeader('Set-Cookie', buildSessionCookieValue(request, '', 0))
}

function buildSessionCookieValue(request, sessionId, maxAgeMs) {
  const parts = [
    `${sessionCookieName}=${encodeURIComponent(sessionId)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Strict',
    `Max-Age=${Math.max(0, Math.floor(maxAgeMs / 1000))}`
  ]

  if (shouldUseSecureCookie(request)) {
    parts.push('Secure')
  }

  return parts.join('; ')
}

function shouldUseSecureCookie(request) {
  const forwardedProto = request.headers['x-forwarded-proto']
  if (typeof forwardedProto === 'string') {
    return forwardedProto.split(',')[0]?.trim() === 'https'
  }

  return false
}

function parseCookieHeader(rawCookieHeader = '') {
  return rawCookieHeader.split(';').reduce((cookies, part) => {
    const [rawName, ...rawValueParts] = part.split('=')
    const name = rawName?.trim()
    if (!name) {
      return cookies
    }

    cookies[name] = decodeURIComponent(rawValueParts.join('=').trim())
    return cookies
  }, {})
}

function canAttemptLogin(remoteAddress) {
  const attempts = loginAttempts.get(remoteAddress)
  if (!attempts) {
    return true
  }

  const recentAttempts = attempts.filter((timestamp) => timestamp > Date.now() - loginWindowMs)
  loginAttempts.set(remoteAddress, recentAttempts)
  return recentAttempts.length < maxLoginAttempts
}

function recordFailedLoginAttempt(remoteAddress) {
  const attempts = loginAttempts.get(remoteAddress) ?? []
  attempts.push(Date.now())
  loginAttempts.set(remoteAddress, attempts.filter((timestamp) => timestamp > Date.now() - loginWindowMs))
}

function clearFailedLoginAttempts(remoteAddress) {
  loginAttempts.delete(remoteAddress)
}

function getRemoteAddress(request) {
  const forwardedFor = request.headers['x-forwarded-for']
  if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
    return forwardedFor.split(',')[0]?.trim() || 'unknown'
  }

  return request.socket.remoteAddress || 'unknown'
}

function safeEquals(left, right) {
  const leftBuffer = Buffer.from(left)
  const rightBuffer = Buffer.from(right)
  if (leftBuffer.length !== rightBuffer.length) {
    return false
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function resolveStaticPath(pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname
  const relativePath = requestedPath.replace(/^\/+/, '')
  const resolvedPath = path.resolve(distRoot, relativePath)

  if (!resolvedPath.startsWith(distRoot)) {
    return null
  }

  return resolvedPath
}

async function resolveExistingStaticPath(filePath) {
  try {
    const stats = await fs.promises.stat(filePath)
    if (stats.isFile()) {
      return filePath
    }
  } catch {
    return null
  }

  return null
}

function sendFile(response, filePath) {
  const extension = path.extname(filePath).toLowerCase()
  const contentType = contentTypeByExtension(extension)

  response.writeHead(200, {
    'Content-Type': contentType,
    'Cache-Control': extension === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable'
  })

  const stream = fs.createReadStream(filePath)
  stream.on('error', (error) => {
    response.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ error: error.message }))
  })
  stream.pipe(response)
}

function contentTypeByExtension(extension) {
  switch (extension) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'application/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.webp':
      return 'image/webp'
    case '.ico':
      return 'image/x-icon'
    default:
      return 'application/octet-stream'
  }
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

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8'
  })
  response.end(JSON.stringify(payload))
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
  const cached = statusCache.get(directory)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value
  }

  const pending = pendingStatusRequests.get(directory)
  if (pending) {
    return pending
  }

  const request = runGit(['-C', directory, 'status', '--porcelain=v1', '--branch'])
    .then(async (result) => {
      const repositoryInfo = await getGitRepositoryInfo(directory)
      const lines = result.stdout.split(/\r?\n/).filter(Boolean)
      const branchLine = lines[0] ?? ''
      const branch = parseBranchName(branchLine)
      const changedLines = branchLine.startsWith('## ') ? lines.slice(1) : lines

      const nextStatus = {
        branch,
        dirty: changedLines.length > 0,
        changedCount: changedLines.length,
        worktreeRoot: repositoryInfo.worktreeRoot,
        mainWorktreeRoot: repositoryInfo.mainWorktreeRoot,
        isWorktreeRoot: repositoryInfo.isWorktreeRoot,
        isLinkedWorktree: repositoryInfo.isLinkedWorktree
      }

      statusCache.set(directory, {
        value: nextStatus,
        expiresAt: Date.now() + statusCacheTtlMs
      })

      return nextStatus
    })
    .finally(() => {
      pendingStatusRequests.delete(directory)
    })

  pendingStatusRequests.set(directory, request)
  return request
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

async function getGitRepositoryInfo(directory) {
  const result = await runGit(['-C', directory, 'rev-parse', '--show-toplevel', '--git-dir', '--git-common-dir'])
  const [worktreeRootRaw = '', gitDirRaw = '', commonDirRaw = ''] = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const requestedDirectory = path.resolve(directory)
  const worktreeRoot = path.resolve(worktreeRootRaw)
  const gitDir = resolveGitPath(directory, gitDirRaw)
  const commonDir = resolveGitPath(directory, commonDirRaw)
  const mainWorktreeRoot = path.basename(commonDir) === '.git' ? path.dirname(commonDir) : worktreeRoot

  return {
    worktreeRoot,
    mainWorktreeRoot,
    isWorktreeRoot: requestedDirectory === worktreeRoot,
    isLinkedWorktree: gitDir !== commonDir
  }
}

function resolveGitPath(directory, rawPath) {
  if (!rawPath) {
    return ''
  }

  return path.isAbsolute(rawPath) ? path.resolve(rawPath) : path.resolve(directory, rawPath)
}

function clearStatusCache(directories) {
  for (const directory of directories) {
    if (!directory) {
      continue
    }

    statusCache.delete(directory)
    pendingStatusRequests.delete(directory)
  }
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10)
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : fallback
}
