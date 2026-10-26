/**
 * Whether this build fetches and installs its own updates. A Mac only installs an update whose
 * signature matches the running app, which an unsigned build never has, so there it is left to
 * the download page.
 */
export function updatesItself(platform: NodeJS.Platform, packaged: boolean): boolean {
  return packaged && platform !== 'darwin'
}
