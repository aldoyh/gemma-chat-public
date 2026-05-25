export interface HtmlAssetReferences {
  stylesheet?: string
  script?: string
}

export function ensureHtmlAssetReferences(
  html: string,
  refs: HtmlAssetReferences
): string {
  let next = html

  if (refs.stylesheet && !hasHref(next, refs.stylesheet)) {
    const link = `<link rel="stylesheet" href="${refs.stylesheet}">`
    next = insertBeforeClosingTag(next, 'head', link)
  }

  if (refs.script && !hasSrc(next, refs.script)) {
    const script = `<script src="${refs.script}" defer></script>`
    next = insertBeforeClosingTag(next, 'head', script)
  }

  return next
}

function hasHref(html: string, href: string): boolean {
  return new RegExp(`<link\\b[^>]*\\bhref=["']${escapeRegExp(href)}["']`, 'i').test(html)
}

function hasSrc(html: string, src: string): boolean {
  return new RegExp(`<script\\b[^>]*\\bsrc=["']${escapeRegExp(src)}["']`, 'i').test(html)
}

function insertBeforeClosingTag(html: string, tag: 'head' | 'body', line: string): string {
  const closeRe = new RegExp(`\\n?</${tag}>`, 'i')
  if (closeRe.test(html)) {
    return html.replace(closeRe, `\n${line}\n</${tag}>`)
  }
  return `${html.trimEnd()}\n${line}\n`
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
