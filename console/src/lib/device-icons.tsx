import { Monitor, Smartphone, Tablet, Globe, HelpCircle } from 'lucide-react'
import type { ReactNode } from 'react'

const BROWSER_ICONS: Record<string, string> = {
  chrome: '/icons/browsers/chrome.svg',
  firefox: '/icons/browsers/firefox.svg',
  safari: '/icons/browsers/safari.svg',
  edge: '/icons/browsers/edge.svg',
  opera: '/icons/browsers/opera.svg',
  brave: '/icons/browsers/brave.png',
  samsung: '/icons/browsers/samsung.svg',
  'samsung browser': '/icons/browsers/samsung.svg',
  'samsung internet': '/icons/browsers/samsung.svg',
  'mobile safari': '/icons/browsers/safari.svg',
  'chrome mobile': '/icons/browsers/chrome.svg',
  'firefox mobile': '/icons/browsers/firefox.svg',
  'edge mobile': '/icons/browsers/edge.svg',
  'opera mobile': '/icons/browsers/opera.svg',
}

const OS_ICONS: Record<string, string> = {
  windows: '/icons/os/windows.svg',
  'mac os': '/icons/os/ios.svg',
  macos: '/icons/os/ios.svg',
  linux: '/icons/os/linux.svg',
  ubuntu: '/icons/os/ubuntu.svg',
  ios: '/icons/os/ios.svg',
  ipados: '/icons/os/ios.svg',
  android: '/icons/os/android.svg',
  'chrome os': '/icons/os/chromeos.svg',
}

interface IconProps {
  className?: string
}

function ImageIcon({ src, className }: { src: string } & IconProps) {
  return (
    <img
      src={src}
      alt=""
      className={className ?? 'w-4 h-4 flex-shrink-0'}
      onError={(e) => {
        e.currentTarget.style.display = 'none'
      }}
    />
  )
}

export function getDeviceIcon(value: string, tabKey: string): ReactNode {
  const iconClass = 'w-4 h-4 text-gray-400 flex-shrink-0'
  const lowerValue = value?.toLowerCase() ?? ''

  if (tabKey === 'devices') {
    if (lowerValue.includes('mobile')) return <Smartphone className={iconClass} />
    if (lowerValue.includes('tablet')) return <Tablet className={iconClass} />
    return <Monitor className={iconClass} />
  }

  if (tabKey === 'browsers') {
    // Check for exact match first
    const exactMatch = BROWSER_ICONS[lowerValue]
    if (exactMatch) return <ImageIcon src={exactMatch} />

    // Check for partial matches
    for (const [key, src] of Object.entries(BROWSER_ICONS)) {
      if (lowerValue.includes(key) || key.includes(lowerValue)) {
        return <ImageIcon src={src} />
      }
    }

    return <Globe className={iconClass} />
  }

  if (tabKey === 'os') {
    // Check for exact match first
    const exactMatch = OS_ICONS[lowerValue]
    if (exactMatch) return <ImageIcon src={exactMatch} />

    // Check for partial matches
    for (const [key, src] of Object.entries(OS_ICONS)) {
      if (lowerValue.includes(key) || key.includes(lowerValue)) {
        return <ImageIcon src={src} />
      }
    }

    return <HelpCircle className={iconClass} />
  }

  return null
}
