import { useEffect } from 'react'
import { useOutletContext } from 'react-router-dom'
import type { ReactNode } from 'react'

export default function PageHeader({ title, children }: { title: string; children?: ReactNode }) {
  const context = useOutletContext<{ setHeaderTitle?: (title: string | null) => void }>()

  useEffect(() => {
    if (context?.setHeaderTitle) {
      context.setHeaderTitle(title)
    }
    return () => {
      if (context?.setHeaderTitle) {
        context.setHeaderTitle(null)
      }
    }
  }, [title, context])

  if (!children) return null

  return (
    <div className="flex items-center justify-end mb-6">
      {children}
    </div>
  )
}
