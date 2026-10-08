export interface Context {
  get(name: string): unknown
  on(event: string, listener: (...args: any[]) => void): () => void
}

export const name = 'fix-ungrouped-new-session'
export const using = ['sessions', 'uiWorkspace']

interface SessionControllerFace {
  create(opts?: { workspaceId?: string; cwd?: string; sessionId?: string }): Promise<string>
}

interface UiWorkspaceFace {
  openSession(target: string): void
  startSession(workspaceId?: string): void
}

/**
 * Cordis Client Plugin: Fix the inert '+' new session button in the 'Ungrouped' (未分组) section.
 *
 * Root Cause in host dsh-client-ui-workspace:
 * In `WorkspaceBrowser.tsx`, `onCreate` is defined as:
 * ```tsx
 * onCreate={() => {
 *   if (group.workspaceId !== undefined) {
 *     setGroupExpanded(group.key, true)
 *     startSession(group.workspaceId)
 *   }
 * }}
 * ```
 * Because the ungrouped bucket has `group.workspaceId === undefined`, clicking the '+' button
 * triggers a no-op.
 *
 * This plugin hooks the DOM click event during the capture phase, detects clicks on the
 * ungrouped group's '+' new session button, creates a loose session (no workspaceId),
 * and navigates to it.
 */
export function apply(ctx: Context) {
  const handleCaptureClick = async (event: MouseEvent) => {
    const target = event.target as HTMLElement | null
    if (!target) return

    // Find the enclosing button if any
    const button = target.closest('button')
    if (!button) return

    // Check if the button is within the ungrouped section row:
    // UNGROUPED_KEY is '', so the container has data-row-key="workspace:"
    const ungroupedRow = button.closest('[data-row-key="workspace:"]')

    // Also check the button's aria-label or title
    const ariaLabel = button.getAttribute('aria-label') || ''
    const isNewSessionAria =
      ariaLabel.includes('未分组') ||
      ariaLabel.toLowerCase().includes('ungrouped') ||
      ariaLabel.includes('新建会话') ||
      ariaLabel.toLowerCase().includes('new session')

    const isUngroupedAddButton = ungroupedRow !== null && isNewSessionAria

    if (!isUngroupedAddButton) return

    // Intercept event before the inert host handler swallows it
    event.stopPropagation()
    event.stopImmediatePropagation()
    event.preventDefault()

    try {
      // 1. Expand the ungrouped group if collapsed
      if (ungroupedRow.getAttribute('aria-expanded') !== 'true') {
        const toggleTarget = ungroupedRow.querySelector<HTMLElement>('[role="treeitem"]') ?? (ungroupedRow as HTMLElement)
        toggleTarget.click()
      }

      // 2. Call sessions.create({}) to allocate a loose session (ungrouped)
      const sessions = ctx.get('sessions') as unknown as SessionControllerFace | undefined
      const uiWorkspace = ctx.get('uiWorkspace') as unknown as UiWorkspaceFace | undefined

      if (sessions && typeof sessions.create === 'function') {
        const sessionId = await sessions.create({})
        if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
          uiWorkspace.openSession(sessionId)
        }
      } else if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
        uiWorkspace.startSession()
      }
    } catch (error) {
      console.error('[fix-ungrouped-new-session] Failed to create ungrouped session:', error)
    }
  }

  // Register capture-phase click listener
  window.addEventListener('click', handleCaptureClick, true)

  ctx.on('dispose', () => {
    window.removeEventListener('click', handleCaptureClick, true)
  })
}
