import React from 'react'
import { Download, Upload } from 'lucide-react'
import { Button } from './custom/Button'
import { CustomDialog } from './custom/CustomDialog'

interface ImportExportControlsProps {
  data?: any 
  onImport?: (importedData: any[]) => Promise<void> | void
  entityName: string
  requiredKeys?: string[]
  showExport?: boolean
  showImport?: boolean
  customStyle?: string
}

export function ImportExportControls({
  data,
  onImport,
  entityName,
  requiredKeys = [],
  showExport = true,
  showImport = true,
  customStyle = ''
}: ImportExportControlsProps) {
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  const [dialog, setDialog] = React.useState<{
    isOpen: boolean
    title: string
    description: string
    variant?: 'info' | 'success' | 'warning' | 'error'
  }>({
    isOpen: false,
    title: '',
    description: '',
  })

  const showAlert = (title: string, desc: string, variant: 'info' | 'success' | 'warning' | 'error' = 'info') => {
    setDialog({
      isOpen: true,
      title,
      description: desc,
      variant
    })
  }
  
  const handleExport = () => {
    try {
      if (!data) return
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url

      
      const suffix = !Array.isArray(data) && data?.name
        ? `${data.name}`
        : 'export'
      link.download = `${entityName.toLowerCase().replace(/\s+/g, '_')}_${suffix}.json`
      
      link.click()
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export failed:', err)
      showAlert('Export Failed', `Failed to export ${entityName} data.`, 'error')
    }
  }

  const handleImport = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!onImport) return
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = async (event) => {
      try {
        let parsed: any
        try {
          parsed = JSON.parse(event.target?.result as string)
        } catch (jsonErr) {
          showAlert('Invalid File', 'File must be a valid JSON file.', 'error')
          return
        }

        const items = Array.isArray(parsed) ? parsed : [parsed]

        // Basic validation
        if (items.length === 0) {
          showAlert('Invalid File', 'JSON array is empty.', 'error')
          return
        }

        
        if (requiredKeys.length > 0) {
          const isValid = items.every((item: any) =>
            requiredKeys.every((key) => key in item)
          )
          if (!isValid) {
            showAlert('Invalid Format', `All items must contain the required fields: ${requiredKeys.join(', ')}`, 'error')
            return
          }
        }

        await onImport(items)
      } catch (err: any) {
        console.error('Import failed:', err)
        const detail = err?.response?.data?.detail || err?.message || 'Check console for details.'
        showAlert('Import Failed', `Failed to import ${entityName}: ${detail}`, 'error')
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  const isExportDisabled = !data || (Array.isArray(data) && data.length === 0)

  return (
    <div className={`flex items-center gap-2 shrink-0 ${customStyle}`}>
      {showExport && (
        <button
          type="button"
          onClick={handleExport}
          disabled={isExportDisabled}
          className="text-slate-400 hover:text-teal-600 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          title={`Export ${entityName}`}
        >
          <Download size={15} />
        </button>
      )}

      {showImport && (
        <>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={handleImport}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            icon={<Upload size={13} />}
            onClick={() => fileInputRef.current?.click()}
            title={`Import ${entityName}s`}
          >
            Import
          </Button>
        </>
      )}

      <CustomDialog
        isOpen={dialog.isOpen}
        title={dialog.title}
        description={dialog.description}
        type="alert"
        variant={dialog.variant}
        onClose={() => setDialog(prev => ({ ...prev, isOpen: false }))}
      />
    </div>
  )
}
