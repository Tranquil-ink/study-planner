import { useSyncExternalStore } from 'react'
import { pages } from './navigation'

function subscribe(onChange: () => void) {
  window.addEventListener('hashchange', onChange)
  return () => window.removeEventListener('hashchange', onChange)
}

function getCurrentPage() {
  // 原生 hash 链接支持刷新和浏览器前进／后退；未知地址回到日历。
  return pages.find((page) => `#${page.id}` === window.location.hash) ?? pages[0]
}

export function useCurrentPage() {
  return useSyncExternalStore(subscribe, getCurrentPage)
}
