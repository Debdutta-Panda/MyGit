import { useEffect } from 'react'

const dialogSelector = '[role="dialog"], [role="alertdialog"]'
const editableSelector = [
  '[data-autofocus="true"]',
  '[autofocus]',
  'input:not([type="hidden"]):not(:disabled):not([readonly])',
  'textarea:not(:disabled):not([readonly])',
  'select:not(:disabled)',
  '[contenteditable="true"]',
  '[role="combobox"]:not([aria-disabled="true"])',
].join(',')

const visibleEditable = (element: Element): element is HTMLElement =>
  element instanceof HTMLElement
  && element.getClientRects().length > 0
  && element.getAttribute('aria-hidden') !== 'true'
  && !element.closest('[aria-hidden="true"]')

export function useDialogAutofocus(): void {
  useEffect(() => {
    const focusedDialogs = new WeakSet<Element>()
    const frames = new Set<number>()

    const scheduleFocus = (dialog: Element): void => {
      if (focusedDialogs.has(dialog) || dialog.hasAttribute('data-no-dialog-autofocus')) return
      const firstFrame = window.requestAnimationFrame(() => {
        frames.delete(firstFrame)
        const secondFrame = window.requestAnimationFrame(() => {
          frames.delete(secondFrame)
          if (!dialog.isConnected || dialog.getAttribute('aria-hidden') === 'true') return
          const active = document.activeElement
          if (active instanceof HTMLElement && dialog.contains(active) && active.matches(editableSelector)) {
            focusedDialogs.add(dialog)
            return
          }
          const target = Array.from(dialog.querySelectorAll(editableSelector)).find(visibleEditable)
          if (!target) return
          target.focus({ preventScroll: true })
          focusedDialogs.add(dialog)
        })
        frames.add(secondFrame)
      })
      frames.add(firstFrame)
    }

    const inspect = (node: Node): void => {
      if (!(node instanceof Element)) return
      if (node.matches(dialogSelector)) scheduleFocus(node)
      node.querySelectorAll(dialogSelector).forEach(scheduleFocus)
      const containingDialog = node.closest(dialogSelector)
      if (containingDialog) scheduleFocus(containingDialog)
    }

    document.querySelectorAll(dialogSelector).forEach(scheduleFocus)
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.target instanceof Element) {
          const dialog = mutation.target.matches(dialogSelector)
            ? mutation.target
            : mutation.target.closest(dialogSelector)
          if (dialog) {
            if (dialog.getAttribute('aria-hidden') === 'true') focusedDialogs.delete(dialog)
            else scheduleFocus(dialog)
          }
        }
        mutation.addedNodes.forEach(inspect)
      }
    })
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['aria-hidden', 'role'],
    })

    return () => {
      observer.disconnect()
      frames.forEach((frame) => window.cancelAnimationFrame(frame))
    }
  }, [])
}
