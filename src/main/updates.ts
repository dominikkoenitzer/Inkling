/**
 * Whether this build fetches and installs its own updates. A Mac only installs an update whose
 * signature matches the running app, which an unsigned build never has, so there it is left to
 * the download page.
 */
export function updatesItself(platform: NodeJS.Platform, packaged: boolean): boolean {
  return packaged && platform !== 'darwin'
}

/** Where a new version is downloaded by hand. Empty keeps the Mac's update notice off. */
export const DOWNLOAD_PAGE = ''

/** Whether this build reads the update feed only to say a new version is out: a packaged Mac with a download page. */
export function noticesUpdates(platform: NodeJS.Platform, packaged: boolean, downloadPage: string): boolean {
  return packaged && platform === 'darwin' && downloadPage !== ''
}

/** The version to tell the user about once: a newer one than this build that was not told before, else null. */
export function versionToNotice(newer: boolean, version: string, noticed: string | null): string | null {
  return newer && version !== noticed ? version : null
}
