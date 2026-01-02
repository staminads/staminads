import { useState } from 'react'
import { Button, message } from 'antd'
import { CopyOutlined, CheckOutlined } from '@ant-design/icons'

interface CodeSnippetProps {
  code: string
  language?: string
}

export function CodeSnippet({ code }: CodeSnippetProps) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    message.success('Copied to clipboard')
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative">
      <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm font-mono whitespace-pre-wrap">
        <code>{code}</code>
      </pre>
      <Button
        type="text"
        icon={copied ? <CheckOutlined /> : <CopyOutlined />}
        onClick={handleCopy}
        className="absolute top-2 right-2 !text-gray-400 hover:!text-white hover:!bg-gray-700"
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  )
}
