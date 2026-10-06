import { useEffect } from 'react'

interface SEOMetaProps {
  title: string
  description: string
  ogTitle?: string
  ogDescription?: string
  ogUrl?: string
}

function upsertMeta(selector: string, attr: string, value: string): HTMLMetaElement {
  let el = document.querySelector<HTMLMetaElement>(selector)
  if (!el) {
    el = document.createElement('meta')
    const [attrName, attrValue] = attr.split('=')
    el.setAttribute(attrName, attrValue.replace(/"/g, ''))
    document.head.appendChild(el)
  }
  el.setAttribute('content', value)
  return el
}

export function SEOMeta({
  title,
  description,
  ogTitle,
  ogDescription,
  ogUrl,
}: SEOMetaProps) {
  useEffect(() => {
    const prevTitle = document.title
    const prevDescription =
      document.querySelector<HTMLMetaElement>('meta[name="description"]')?.getAttribute('content') ?? null

    document.title = title

    upsertMeta('meta[name="description"]', 'name=description', description)

    if (ogTitle !== undefined) {
      upsertMeta('meta[property="og:title"]', 'property=og:title', ogTitle)
    }
    if (ogDescription !== undefined) {
      upsertMeta('meta[property="og:description"]', 'property=og:description', ogDescription)
    }
    if (ogUrl !== undefined) {
      upsertMeta('meta[property="og:url"]', 'property=og:url', ogUrl)
    }

    return () => {
      document.title = prevTitle
      const descEl = document.querySelector<HTMLMetaElement>('meta[name="description"]')
      if (descEl) {
        if (prevDescription !== null) {
          descEl.setAttribute('content', prevDescription)
        } else {
          descEl.remove()
        }
      }
    }
  }, [title, description, ogTitle, ogDescription, ogUrl])

  return null
}
