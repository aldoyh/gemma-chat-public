// Stub of the `electron` module for unit tests. Only the imports actually
// touched by tools.ts at module-load time are provided. The test code never
// invokes any of these — they exist purely so the import graph resolves.
export const app = {
  getPath: () => '/tmp',
  isPackaged: false,
  on: () => {},
  whenReady: () => ({ then: () => {} })
}
export const BrowserWindow = class {}
export const ipcMain = { handle: () => {}, on: () => {} }
export const dialog = { showOpenDialog: () => {} }
export const shell = { openExternal: () => {}, openPath: () => {} }
export const session = { defaultSession: { setPermissionRequestHandler: () => {}, setPermissionCheckHandler: () => {} } }
export const nativeTheme = { themeSource: 'dark' }
export const nativeImage = { createFromPath: () => ({ isEmpty: () => true }) }
export default { app, BrowserWindow, ipcMain, dialog, shell, session, nativeTheme, nativeImage }
