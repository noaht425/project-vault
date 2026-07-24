import { ipcMain } from 'electron'
import type { CloudSession } from '../cloud/cloudSession'

export function registerCloudIpc(cloud: CloudSession): void {
  ipcMain.handle(
    'cloud:signIn',
    async (_event, args: { email: string; password: string }): Promise<{ userId: string }> =>
      cloud.signIn(args.email, args.password)
  )

  ipcMain.handle(
    'cloud:createNote',
    async (_event, args: { name: string; frontmatter?: Record<string, unknown>; body?: string }): Promise<unknown> =>
      cloud.createNote(args)
  )
}
