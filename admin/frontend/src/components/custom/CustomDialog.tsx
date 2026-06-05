import { useEffect, useRef, useState } from 'react'
import { X, Loader2 } from 'lucide-react'
import { Button } from './Button'

export interface CustomDialogProps {
  isOpen: boolean
  onClose: () => void
  onConfirm?: () => void | Promise<void>
  title?: string
  description?: string
  confirmText?: string
  cancelText?: string
  isProcessing?: boolean
  isDeleting?: boolean 
  itemName?: string   
  type?: 'alert' | 'confirm' | 'delete' | 'prompt'
  variant?: 'info' | 'success' | 'warning' | 'error'
  promptValue?: string
  onPromptConfirm?: (val: string) => void | Promise<void>
}

export function CustomDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  description = '',
  confirmText,
  cancelText = 'Cancel',
  isProcessing = false,
  isDeleting = false,
  type = 'confirm',
  promptValue = '',
  onPromptConfirm
}: CustomDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const activeProcessing = isProcessing || isDeleting
  const [inputValue, setInputValue] = useState('')

  
  useEffect(() => {
    if (isOpen && type === 'prompt') {
      setInputValue(promptValue)
    }
  }, [isOpen, type, promptValue])

  
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && isOpen && !activeProcessing) {
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, activeProcessing])

  if (!isOpen) return null

  
  const displayTitle = title || (type === 'delete' ? 'Delete' : type === 'confirm' ? 'Confirm Action' : 'Notification')
  const displayConfirmText = confirmText || (type === 'delete' ? 'Delete' : type === 'confirm' ? 'Confirm' : 'OK')

  const handleConfirmClick = async () => {
    if (type === 'prompt') {
      if (onPromptConfirm) {
        await onPromptConfirm(inputValue)
      }
    } else if (onConfirm) {
      await onConfirm()
    }
    if (type === 'alert') {
      onClose()
    }
  }

  return (
    <div 
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-[1px] animate-in fade-in duration-200"
      onClick={(e) => {
        
        if (dialogRef.current && !dialogRef.current.contains(e.target as Node) && !activeProcessing) {
          onClose()
        }
      }}
    >
      <div
        ref={dialogRef}
        className="bg-[var(--color-surface)] rounded-2xl shadow-2xl border border-[var(--color-border)] w-full max-w-md overflow-hidden transform transition-all animate-in zoom-in-95 duration-200"
      >
        
        <div className="p-6">
          
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-[var(--color-text-main)] tracking-tight">
              {displayTitle}
            </h3>
            <button
              onClick={onClose}
              disabled={activeProcessing}
              className="p-1.5 rounded-lg text-[var(--color-text-muted)] hover:text-[var(--color-text-main)] hover:bg-[var(--color-bg)] transition-colors disabled:opacity-50"
              aria-label="Close dialog"
            >
              <X size={18} />
            </button>
          </div>

          
          <div className="space-y-3">
            <p className="text-sm text-[var(--color-text-muted)] leading-relaxed font-medium">
              {description}
            </p>

            {type === 'prompt' && (
              <input
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                className="w-full border border-[var(--color-border)] rounded-xl px-4 py-2.5 text-xs text-[var(--color-text-main)] bg-[var(--color-bg)] focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 shadow-sm mt-2"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !activeProcessing) {
                    handleConfirmClick()
                  }
                }}
              />
            )}
          </div>
        </div>

        
        <div className="px-6 py-4 border-t border-[var(--color-border)] flex items-center justify-end gap-3 bg-[var(--color-surface)]">
          {type !== 'alert' && (
            <Button
              variant="outline"
              onClick={onClose}
              disabled={activeProcessing}
              size="md"
            >
              {cancelText}
            </Button>
          )}
          
          <Button
            variant={type === 'delete' ? 'danger' : 'primary'}
            onClick={handleConfirmClick}
            disabled={activeProcessing}
            size="md"
            icon={activeProcessing ? <Loader2 size={16} className="animate-spin" /> : undefined}
          >
            {activeProcessing 
              ? (type === 'delete' ? 'Deleting...' : 'Processing...') 
              : displayConfirmText
            }
          </Button>
        </div>
      </div>
    </div>
  )
}
