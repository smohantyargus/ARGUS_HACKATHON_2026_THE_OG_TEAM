export default function JsonViewer({ data }: { data: unknown }) {
  return (
    <pre className="bg-gray-900 text-green-400 text-xs p-4 rounded-lg overflow-auto max-h-96">
      {JSON.stringify(data, null, 2)}
    </pre>
  )
}
