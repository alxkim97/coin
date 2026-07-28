const { app, BrowserWindow, ipcMain, dialog, Tray, Menu } = require('electron')
const path = require('path')
const { autoUpdater } = require('electron-updater')

// Without this, Windows can cache the taskbar/Start icon against the shared
// dev electron.exe binary instead of this app's own icon.
app.setAppUserModelId('com.alexkim.coin')

// Prevent duplicate windows from "Start with Windows" plus a manual launch.
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
}

const isDev = process.argv.includes('--dev')
let mainWindow = null
let tray = null
let isQuitting = false

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 600,
    title: 'Coin',
    backgroundColor: '#0f1115',
    show: false,
    autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5183')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, 'dist', 'index.html'))
  }

  // Show once painted to avoid a white flash on launch.
  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.on('closed', () => { mainWindow = null })

  // The X button minimizes to tray instead of quitting, so Coin keeps
  // running in the background — same as Pinboard — and stays reachable for
  // periodic update checks without needing to be reopened by hand.
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow.hide()
  })
}

function rebuildTrayMenu() {
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open Coin', click: () => { mainWindow.show(); mainWindow.focus() } },
    { type: 'separator' },
    updateDownloaded
      ? { label: 'Restart to Install Update', click: () => { isQuitting = true; autoUpdater.quitAndInstall() } }
      : { label: 'Check for Updates', click: () => checkForUpdates(true) },
    { type: 'separator' },
    { label: 'Quit Coin', click: () => { isQuitting = true; app.quit() } },
  ]))
}

function createTray() {
  tray = new Tray(path.join(__dirname, 'assets', 'icon.ico'))
  tray.setToolTip('Coin')
  rebuildTrayMenu()
  tray.on('click', () => { mainWindow.show(); mainWindow.focus() })
}

// Auto-update via electron-updater + GitHub Releases. A manual check (from
// the renderer's Settings page) always reports back — found, not found, or
// error; the periodic background check stays silent unless it actually
// finds something, so it doesn't nag.
let updateDownloaded = false
autoUpdater.autoInstallOnAppQuit = true

autoUpdater.on('update-downloaded', (info) => {
  updateDownloaded = true
  if (tray) rebuildTrayMenu()
  dialog.showMessageBox({
    type: 'info',
    title: 'Coin update ready',
    message: `Coin ${info.version} has been downloaded.`,
    detail: 'Restart now to install it, or it will install automatically the next time Coin quits.',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
  }).then(({ response }) => {
    if (response === 0) { isQuitting = true; autoUpdater.quitAndInstall() }
  })
})

autoUpdater.on('error', (err) => {
  console.error('autoUpdater error:', err)
})

function checkForUpdates(manual) {
  if (isDev) return updateDownloaded ? 'downloaded' : 'skipped-dev'
  if (!manual) {
    autoUpdater.checkForUpdates().catch(() => {})
    return
  }
  if (updateDownloaded) {
    dialog.showMessageBox({ type: 'info', title: 'Coin', message: 'Update already downloaded — restart Coin to install it.' })
    return
  }
  const cleanup = () => {
    autoUpdater.off('update-not-available', onNotAvailable)
    autoUpdater.off('update-available', cleanup)
    autoUpdater.off('error', onError)
  }
  const onNotAvailable = () => {
    cleanup()
    dialog.showMessageBox({ type: 'info', title: 'Coin', message: "You're up to date." })
  }
  const onError = (err) => {
    cleanup()
    dialog.showMessageBox({
      type: 'error',
      title: 'Update check failed',
      message: 'Could not check for updates.',
      detail: String((err && err.message) || err),
    })
  }
  autoUpdater.once('update-not-available', onNotAvailable)
  autoUpdater.once('update-available', cleanup)
  autoUpdater.once('error', onError)
  autoUpdater.checkForUpdates().catch(() => {})
}

ipcMain.handle('updater:check', () => checkForUpdates(true))
ipcMain.handle('app:get-version', () => app.getVersion())

if (gotSingleInstanceLock) {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(() => {
    createWindow()
    createTray()

    if (!isDev) {
      // Delay the first check past startup so it doesn't compete with the
      // dashboard's initial load, then recheck periodically since this is a
      // long-running desktop app that may stay open for days.
      setTimeout(() => checkForUpdates(false), 10_000)
      setInterval(() => checkForUpdates(false), 4 * 60 * 60 * 1000)
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
