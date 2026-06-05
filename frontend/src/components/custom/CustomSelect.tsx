import { useState, useEffect, useRef } from 'react'
import { ChevronDown, Check } from 'lucide-react'

export interface SelectOption {
  value: string
  label: string
  subLabel?: string
}

interface CustomSelectProps {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  placeholder?: string
  className?: string
}

export function CustomSelect({ value, onChange, options, placeholder = 'Select option', className = '' }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const selectedOption = options.find(o => o.value === value)

  return (
    <div className={`relative ${className.includes('w-') ? '' : 'w-full'} ${className}`} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between bg-white dark:bg-[var(--color-surface)] border border-slate-200 dark:border-[var(--color-border)] rounded-lg px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500 shadow-sm cursor-pointer transition-all duration-200 text-slate-800 dark:text-[var(--color-text-main)]"
      >
        <span className={selectedOption ? 'text-slate-800 dark:text-[var(--color-text-main)]' : 'text-slate-400 dark:text-[var(--color-text-muted)]'}>
          {selectedOption ? selectedOption.label : placeholder}
        </span>
        <ChevronDown size={16} className={`text-slate-400 dark:text-[var(--color-text-muted)] transition-transform duration-200 shrink-0 ml-2 ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute right-0 z-50 w-full mt-1.5 bg-white dark:bg-[var(--color-surface)] border border-slate-200 dark:border-[var(--color-border)] rounded-xl shadow-xl overflow-hidden py-1 animate-scale-in">
          <div className="max-h-60 overflow-y-auto custom-scrollbar">
            {options.map(opt => {
              const isSelected = opt.value === value
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value)
                    setIsOpen(false)
                  }}
                  className={`w-full flex items-center justify-between px-3 py-2 text-sm text-left transition-colors cursor-pointer ${
                    isSelected 
                      ? 'bg-teal-50/80 dark:bg-teal-950/40 text-teal-800 dark:text-teal-400 font-semibold' 
                      : 'text-slate-600 dark:text-[var(--color-text-muted)] hover:bg-slate-50 dark:hover:bg-slate-100 hover:text-slate-900 dark:hover:text-[var(--color-text-main)]'
                  }`}
                >
                  <div className="flex flex-col">
                    <span>{opt.label}</span>
                    {opt.subLabel && <span className="text-[10px] text-slate-400 dark:text-[var(--color-text-muted)] font-normal">{opt.subLabel}</span>}
                  </div>
                  {isSelected && <Check size={14} className="text-teal-600 dark:text-teal-400 shrink-0 ml-2" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
