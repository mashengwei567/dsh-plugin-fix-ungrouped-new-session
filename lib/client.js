/**
 * 修复原生「未分组」新建会话及输入框锁定缺陷插件 - 客户端（纯插件方案）
 *
 * 缺陷 1：点击「未分组」标题旁的「＋ 新建会话」无反应
 * 缺陷 2：新建未分组会话后，因未关联工作区被宿主判定为 inert 首屏态，
 *        导致输入卡片变为 RlGAzG_cardWorkspaceTrigger 且不可输入打字。
 *
 * 修复逻辑：
 * 1. 拦截未分组新建按钮，调用 sessions.create({}) 分配未分组会话并打开；
 * 2. 识别当前为未分组空白会话时，主动解冻输入框 DOM（激活 contentEditable），
 *    阻止弹出工作区选择菜单，支持敲击 Enter 或点击发送按钮直接发送首条消息；
 * 3. 消息发出后会话自动转为 active 态，宿主原生 Lexical 输入系统全面接管。
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-fix-ungrouped-new-session',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' });

    exports.name = 'fix-ungrouped-new-session';
    exports.using = ['sessions', 'uiWorkspace', 'workspaces'];

    exports.apply = function apply(ctx) {
      // 辅助函数：获取当前主区域打开的会话 ID
      function getActiveSessionId() {
        const sessions = ctx.get('sessions');
        if (!sessions || !sessions.list) return null;
        const list = sessions.list.getSnapshot();
        if (!list || !list.byId) return null;
        for (const [id, item] of Object.entries(list.byId)) {
          if (item && item.retainedBy && (item.retainedBy.mainView || 0) > 0) {
            return id;
          }
        }
        return null;
      }

      // 辅助函数：判断指定会话是否为「未分组空白会话」
      function isUngroupedBlankSession(sessionId) {
        if (!sessionId) return false;
        const sessions = ctx.get('sessions');
        const workspaces = ctx.get('workspaces');
        if (!sessions || !workspaces || !workspaces.list) return false;

        const sessionSnapshot = sessions.list.getSnapshot();
        const item = sessionSnapshot.byId?.[sessionId];
        if (!item || !item.blank) return false;

        const workspaceSnapshot = workspaces.list.getSnapshot();
        const inAnyWorkspace = workspaceSnapshot.items?.some(
          w => w.sessionIds && w.sessionIds.includes(sessionId),
        );
        return !inAnyWorkspace;
      }

      // 辅助函数：发送消息
      async function sendPrompt(sessionId, text) {
        if (!sessionId || !text) return;
        const sessions = ctx.get('sessions');
        if (sessions && sessions.manager && typeof sessions.manager.get === 'function') {
          try {
            const session = sessions.manager.get(sessionId);
            if (session && typeof session.prompt === 'function') {
              await session.prompt([{ type: 'text', text }], 'queue');
              return;
            }
          } catch (e) {
            console.warn('[fix-ungrouped] session.prompt error:', e);
          }
        }
        const remote = ctx.get('remote');
        if (remote && remote.session && typeof remote.session.prompt === 'function') {
          await remote.session.prompt({
            sessionId,
            mode: 'queue',
            content: [{ type: 'text', text }],
          });
        }
      }

      // 辅助函数：解冻输入框卡片
      function unlockComposerCard(card) {
        if (!card) return;
        // 移除 RlGAzG_cardWorkspaceTrigger 等样式类
        const triggerClasses = Array.from(card.classList).filter(c =>
          c.includes('cardWorkspaceTrigger') || c.includes('cardDisabled'),
        );
        triggerClasses.forEach(c => card.classList.remove(c));
        card.style.cursor = 'text';

        const inputEl = card.querySelector('[data-composer-input]');
        if (inputEl) {
          inputEl.contentEditable = 'true';
          inputEl.setAttribute('aria-disabled', 'false');
          inputEl.tabIndex = 0;
          inputEl.style.cursor = 'text';
          inputEl.style.pointerEvents = 'auto';

          const inputDisabledClasses = Array.from(inputEl.classList).filter(c =>
            c.includes('inputDisabled'),
          );
          inputDisabledClasses.forEach(c => inputEl.classList.remove(c));

          const placeholder = '发消息或创建任务，/ 调用指令，@ 文件或对话';
          inputEl.setAttribute('data-placeholder', placeholder);
          inputEl.setAttribute('aria-label', placeholder);
        }

        const placeholderEl = card.querySelector('[data-composer-placeholder]');
        if (placeholderEl) {
          placeholderEl.textContent = '发消息或创建任务，/ 调用指令，@ 文件或对话';
        }

        // 启用主发送按钮
        const primaryBtn = card.querySelector('button[aria-label*="发送"], button[aria-label*="Send"], button[class*="primary"]');
        if (primaryBtn) {
          primaryBtn.removeAttribute('disabled');
        }
      }

      // --- 缺陷 1 拦截处理：点击「未分组」新建会话 ---
      const handleCaptureClick = async (event) => {
        const target = event.target;
        if (!target) return;

        const button = target.closest('button');
        if (!button) return;

        const ungroupedRow = button.closest('[data-row-key="workspace:"]');
        const ariaLabel = button.getAttribute('aria-label') || '';
        const isNewSessionAria =
          ariaLabel.includes('未分组') ||
          ariaLabel.toLowerCase().includes('ungrouped') ||
          ariaLabel.includes('新建会话') ||
          ariaLabel.toLowerCase().includes('new session');

        const isUngroupedAddButton = ungroupedRow !== null && isNewSessionAria;
        if (!isUngroupedAddButton) return;

        event.stopPropagation();
        event.stopImmediatePropagation();
        event.preventDefault();

        try {
          if (ungroupedRow.getAttribute('aria-expanded') !== 'true') {
            const toggleTarget = ungroupedRow.querySelector('[role="treeitem"]') || ungroupedRow;
            toggleTarget.click();
          }

          const sessions = ctx.get('sessions');
          const uiWorkspace = ctx.get('uiWorkspace');

          if (sessions && typeof sessions.create === 'function') {
            const sessionId = await sessions.create({});
            if (uiWorkspace && typeof uiWorkspace.openSession === 'function') {
              uiWorkspace.openSession(sessionId);
            }
          } else if (uiWorkspace && typeof uiWorkspace.startSession === 'function') {
            uiWorkspace.startSession();
          }
        } catch (error) {
          console.error('[fix-ungrouped-new-session] Failed to create ungrouped session:', error);
        }
      };

      // --- 缺陷 2 拦截处理：输入框点击与发送 ---
      const handleComposerPointerDown = (event) => {
        const target = event.target;
        if (!target) return;

        const card = target.closest('[data-composer-card]');
        if (!card) return;

        const activeSessionId = getActiveSessionId();
        if (!isUngroupedBlankSession(activeSessionId)) return;

        // 如果用户点击的是卡片内的常规交互按钮（如模型选择、附件等），不予拦截
        const button = target.closest('button');
        if (button) {
          const isSendBtn =
            button.getAttribute('aria-label')?.includes('发送') ||
            button.getAttribute('aria-label')?.includes('Send') ||
            button.className?.includes('primary');
          if (!isSendBtn) return;
        }

        // 阻止触发宿主默认的 onRequestWorkspace 选择工作区菜单
        event.stopPropagation();
        event.stopImmediatePropagation();

        unlockComposerCard(card);

        const inputEl = card.querySelector('[data-composer-input]');
        if (inputEl && !button) {
          inputEl.focus();
        }
      };

      const handleComposerClick = async (event) => {
        const target = event.target;
        if (!target) return;

        const card = target.closest('[data-composer-card]');
        if (!card) return;

        const activeSessionId = getActiveSessionId();
        if (!isUngroupedBlankSession(activeSessionId)) return;

        const button = target.closest('button');
        const isSendBtn = button && (
          button.getAttribute('aria-label')?.includes('发送') ||
          button.getAttribute('aria-label')?.includes('Send') ||
          button.className?.includes('primary')
        );

        // 如果点击了发送按钮
        if (isSendBtn) {
          event.stopPropagation();
          event.stopImmediatePropagation();
          event.preventDefault();

          const inputEl = card.querySelector('[data-composer-input]');
          const text = (inputEl ? inputEl.innerText : '').trim();
          if (text) {
            if (inputEl) inputEl.innerText = '';
            await sendPrompt(activeSessionId, text);
          }
          return;
        }

        // 其它非按钮点击（例如点击输入区域或卡片），拦截防止弹出选择工作区
        if (!button) {
          event.stopPropagation();
          event.stopImmediatePropagation();
          event.preventDefault();

          unlockComposerCard(card);
          const inputEl = card.querySelector('[data-composer-input]');
          if (inputEl) inputEl.focus();
        }
      };

      const handleComposerKeyDown = async (event) => {
        const target = event.target;
        if (!target) return;

        const card = target.closest('[data-composer-card]');
        if (!card) return;

        const activeSessionId = getActiveSessionId();
        if (!isUngroupedBlankSession(activeSessionId)) return;

        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
          event.stopPropagation();
          event.stopImmediatePropagation();
          event.preventDefault();

          const inputEl = card.querySelector('[data-composer-input]');
          const text = (inputEl ? inputEl.innerText : '').trim();
          if (text) {
            if (inputEl) inputEl.innerText = '';
            const placeholderEl = card.querySelector('[data-composer-placeholder]');
            if (placeholderEl) placeholderEl.style.display = '';
            await sendPrompt(activeSessionId, text);
          }
        }
      };

      const handleComposerInput = (event) => {
        const target = event.target;
        if (!target) return;

        const card = target.closest('[data-composer-card]');
        if (!card) return;

        const activeSessionId = getActiveSessionId();
        if (!isUngroupedBlankSession(activeSessionId)) return;

        const inputEl = card.querySelector('[data-composer-input]');
        const placeholderEl = card.querySelector('[data-composer-placeholder]');
        if (inputEl && placeholderEl) {
          const hasText = inputEl.innerText.trim().length > 0;
          placeholderEl.style.display = hasText ? 'none' : '';
        }
      };

      // 定时或变化检测：主动解冻当前未分组空白会话的卡片
      const observer = new MutationObserver(() => {
        const activeSessionId = getActiveSessionId();
        if (isUngroupedBlankSession(activeSessionId)) {
          const card = document.querySelector('[data-composer-card]');
          if (card && card.className.includes('cardWorkspaceTrigger')) {
            unlockComposerCard(card);
          }
        }
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });

      // 注册捕获阶段事件监听器
      window.addEventListener('click', handleCaptureClick, true);
      window.addEventListener('pointerdown', handleComposerPointerDown, true);
      window.addEventListener('click', handleComposerClick, true);
      window.addEventListener('keydown', handleComposerKeyDown, true);
      window.addEventListener('input', handleComposerInput, true);

      ctx.on('dispose', () => {
        observer.disconnect();
        window.removeEventListener('click', handleCaptureClick, true);
        window.removeEventListener('pointerdown', handleComposerPointerDown, true);
        window.removeEventListener('click', handleComposerClick, true);
        window.removeEventListener('keydown', handleComposerKeyDown, true);
        window.removeEventListener('input', handleComposerInput, true);
      });
    };

    return exports;
  },
});
