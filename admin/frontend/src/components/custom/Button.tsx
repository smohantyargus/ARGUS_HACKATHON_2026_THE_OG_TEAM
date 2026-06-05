import { type ButtonHTMLAttributes, type ReactNode } from 'react'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children?: ReactNode
  variant?: 'primary' | 'secondary' | 'outline' | 'danger' | 'success' | 'ghost'
  size?: 'sm' | 'md' | 'lg'
  icon?: ReactNode
  className?: string
  loading?: boolean
}

export function Button({
  children,
  variant = 'primary',
  size = 'md',
  icon,
  className = '',
  loading = false,
  disabled,
  ...props
}: ButtonProps) {
  const baseStyle = 'flex items-center justify-center gap-1.5 font-semibold rounded-lg transition-all active:scale-[0.98] cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed'
  
  const sizeStyles = {
    sm: 'px-3.5 py-2 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-5 py-2.5 text-base',
  }
  
  const variantStyles = {
    primary: 'bg-teal-600 hover:bg-teal-700 text-white shadow-sm border border-transparent',
    secondary: 'bg-teal-50 hover:bg-teal-100 text-teal-700 font-semibold border border-teal-100',
    outline: 'bg-[var(--color-surface)] border border-[var(--color-border)] text-[var(--color-text-muted)] hover:bg-[var(--color-bg)]',
    danger: 'bg-red-600 hover:bg-red-700 text-white shadow-sm border border-transparent',
    success: 'bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm border border-transparent',
    ghost: 'bg-transparent text-slate-500 hover:text-slate-800 hover:bg-slate-50 dark:hover:bg-slate-100/50 dark:text-slate-400 dark:hover:text-slate-200',
  }

  return (
    <button
      className={`${baseStyle} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? (
        <span className="flex items-center justify-center shrink-0 animate-spin">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </span>
      ) : (
        icon && <span className="flex items-center justify-center shrink-0">{icon}</span>
      )}
      {children && <span>{children}</span>}
    </button>
  )
}
