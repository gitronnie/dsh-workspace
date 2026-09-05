import { FolderCode, LogOut, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { WorkspaceApi } from './api.ts'
import { getWorkspaceLocale, subscribeWorkspaceLocale, translate, useWorkspaceI18n } from './i18n.tsx'
import { installWorkspaceStyles } from './styles.ts'
import { clearToken, isLoopbackHostname, setToken, useWorkspaceToken } from './token.ts'
import { AdminOverlay, WorkspaceApp } from './workspace.tsx'

interface ClientContext {
  effect(register: () => (() => void) | void, label?: string): void
  slots: {
    inject(name: string, register: () => (() => void)): () => void
    register(options: Record<string, unknown>, component: (props: any) => JSX.Element | null): () => void
  }
}

const OPEN_WORKSPACE_EVENT = 'dsh-workspace:open-workspace'
const OPEN_SETTINGS_EVENT = 'dsh-workspace:open-settings'

function makeApi(token: string): WorkspaceApi {
  return new WorkspaceApi('/dsh-workspace-api/api/v1', '/dsh-workspace-api/manage', token || undefined, token === '')
}

interface AuthState {
  api: WorkspaceApi
  localAdmin: boolean
  deviceMode: boolean
  needsToken: boolean
}

function useAuthState(): AuthState {
  const token = useWorkspaceToken()
  const localAdmin = token === '' && isLoopbackHostname(globalThis.location.hostname)
  const deviceMode = !localAdmin && token !== ''
  return {
    api: useMemo(() => makeApi(token), [token]),
    localAdmin,
    deviceMode,
    needsToken: !localAdmin && token === '',
  }
}

export const inject = ['slots']

export function apply(ctx: ClientContext): void {
  installWorkspaceStyles()
  ctx.effect(() => localizedSlot(ctx, 'conversation.view', {
    name: 'conversation.view', id: 'dsh-workspace-files', order: 80,
  }, FileConversationView), 'dsh workspace conversation view')

  ctx.effect(() => localizedSlot(ctx, 'sidebar.footer.action', {
    name: 'sidebar.footer.action', id: 'dsh-workspace-open', order: 80,
  }, SidebarAction), 'dsh workspace sidebar action')

  ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'dsh-workspace-overlay',
    order: 80,
  }, GlobalOverlay)), 'dsh workspace settings overlay')
}

function FileConversationView(): JSX.Element {
  const { t } = useWorkspaceI18n()
  const { api, localAdmin, deviceMode, needsToken } = useAuthState()
  if (needsToken) {
    return <div className="daw-root" style={{ padding: 16 }}>
      <ConnectForm />
    </div>
  }
  return (<>
    {deviceMode && <div className="daw-root daw-toolbar" style={{ padding: '4px 12px' }}>
      <span className="daw-list-meta">{t('connectDeviceActive')}</span>
      <span className="daw-toolbar-spacer" />
      <button className="daw-icon" title={t('forgetToken')} onClick={clearToken}><LogOut size={14} /></button>
    </div>}
    <WorkspaceApp api={api} compact {...(localAdmin ? { onOpenSettings: openSettings } : {})} />
  </>)
}

function SidebarAction(props: { wide?: boolean }): JSX.Element {
  const { t } = useWorkspaceI18n()
  return <button className={props.wide === true ? 'daw-command' : 'daw-icon'} title={t('openWorkspace')} onClick={openWorkspace}>
    <FolderCode size={17} />{props.wide === true && <span>{t('files')}</span>}
  </button>
}

function GlobalOverlay(): JSX.Element | null {
  const [surface, setSurface] = useState<'closed' | 'workspace' | 'settings'>('closed')
  const [returnToWorkspace, setReturnToWorkspace] = useState(false)
  const { api, localAdmin, needsToken } = useAuthState()
  useEffect(() => {
    const workspaceListener = (): void => {
      setReturnToWorkspace(false)
      setSurface('workspace')
    }
    const settingsListener = (): void => {
      setReturnToWorkspace(false)
      setSurface('settings')
    }
    window.addEventListener(OPEN_WORKSPACE_EVENT, workspaceListener)
    window.addEventListener(OPEN_SETTINGS_EVENT, settingsListener)
    return () => {
      window.removeEventListener(OPEN_WORKSPACE_EVENT, workspaceListener)
      window.removeEventListener(OPEN_SETTINGS_EVENT, settingsListener)
    }
  }, [])
  const closeAll = (): void => {
    setReturnToWorkspace(false)
    setSurface('closed')
  }
  return <>
    {needsToken && surface !== 'closed'
      ? <TokenOverlay onClose={closeAll} />
      : <>
          <WorkspaceOverlay
            api={api}
            mounted={surface === 'workspace' || returnToWorkspace}
            open={surface === 'workspace'}
            localAdmin={localAdmin}
            onClose={closeAll}
            onOpenSettings={() => {
              setReturnToWorkspace(true)
              setSurface('settings')
            }}
          />
          {localAdmin && <AdminOverlay api={api} open={surface === 'settings'} onClose={() => {
            setSurface(returnToWorkspace ? 'workspace' : 'closed')
            setReturnToWorkspace(false)
          }} />}
        </>
    }
  </>
}

function openSettings(): void {
  window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT))
}

function openWorkspace(): void {
  window.dispatchEvent(new Event(OPEN_WORKSPACE_EVENT))
}

function TokenOverlay(props: { onClose(): void }): JSX.Element {
  const { t } = useWorkspaceI18n()
  return <div className="daw-root daw-overlay daw-workspace-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
    <section className="daw-workspace-dialog" role="dialog" aria-modal="true" aria-label={t('connectTitle')}>
      <header className="daw-dialog-head">
        <FolderCode size={17} aria-hidden="true" />
        <h2>{t('connectTitle')}</h2>
        <span className="daw-toolbar-spacer" />
        <button className="daw-icon" title={t('close')} onClick={props.onClose}><X size={17} /></button>
      </header>
      <div className="daw-workspace-dialog-body">
        <ConnectForm />
      </div>
    </section>
  </div>
}

function ConnectForm(): JSX.Element {
  const { t } = useWorkspaceI18n()
  const [draft, setDraft] = useState('')
  return <form className="daw-token" onSubmit={(event) => {
    event.preventDefault()
    const value = draft.trim()
    if (value === '') return
    setToken(value)
  }}>
    <p className="daw-list-meta">{t('connectDescription')}</p>
    <input className="daw-input" type="password" autoComplete="off" style={{ width: '100%' }} value={draft} onChange={event => setDraft(event.target.value)} />
    <div className="daw-modal-actions"><button className="daw-command primary" type="submit">{t('connect')}</button></div>
  </form>
}

function WorkspaceOverlay(props: {
  api: WorkspaceApi
  mounted: boolean
  open: boolean
  localAdmin: boolean
  onClose(): void
  onOpenSettings(): void
}): JSX.Element | null {
  const { t } = useWorkspaceI18n()
  if (!props.mounted) return null
  return <div hidden={!props.open} className="daw-root daw-overlay daw-workspace-overlay" role="presentation" onMouseDown={event => { if (event.target === event.currentTarget) props.onClose() }}>
    <section className="daw-workspace-dialog" role="dialog" aria-modal="true" aria-label={t('appName')}>
      <header className="daw-dialog-head">
        <FolderCode size={17} aria-hidden="true" />
        <h2>{t('appName')}</h2>
        <span className="daw-toolbar-spacer" />
        {!props.localAdmin && <button className="daw-icon" title={t('forgetToken')} onClick={clearToken}><LogOut size={17} /></button>}
        <button className="daw-icon" title={t('close')} onClick={props.onClose}><X size={17} /></button>
      </header>
      <div className="daw-workspace-dialog-body">
        <WorkspaceApp api={props.api} {...(props.localAdmin ? { onOpenSettings: props.onOpenSettings } : {})} />
      </div>
    </section>
  </div>
}

function localizedSlot(
  ctx: ClientContext,
  name: string,
  options: Record<string, unknown>,
  component: (props: any) => JSX.Element | null,
): () => void {
  return ctx.slots.inject(name, () => {
    const register = (): (() => void) => ctx.slots.register({
      ...options,
      label: () => translate(getWorkspaceLocale(), 'files'),
    }, component)
    let dispose = register()
    const unsubscribe = subscribeWorkspaceLocale(() => {
      dispose()
      dispose = register()
    })
    return () => {
      unsubscribe()
      dispose()
    }
  })
}
