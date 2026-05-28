// src/main/html-assets.ts
function ensureHtmlAssetReferences(html, refs) {
  let next = html;
  if (refs.stylesheet && !hasHref(next, refs.stylesheet)) {
    const link = `<link rel="stylesheet" href="${refs.stylesheet}">`;
    next = insertBeforeClosingTag(next, "head", link);
  }
  if (refs.script && !hasSrc(next, refs.script)) {
    const script = `<script src="${refs.script}" defer></script>`;
    next = insertBeforeClosingTag(next, "head", script);
  }
  return next;
}
function hasHref(html, href) {
  return new RegExp(`<link\\b[^>]*\\bhref=["']${escapeRegExp(href)}["']`, "i").test(html);
}
function hasSrc(html, src) {
  return new RegExp(`<script\\b[^>]*\\bsrc=["']${escapeRegExp(src)}["']`, "i").test(html);
}
function insertBeforeClosingTag(html, tag, line) {
  const closeRe = new RegExp(`\\n?</${tag}>`, "i");
  if (closeRe.test(html)) {
    return html.replace(closeRe, `
${line}
</${tag}>`);
  }
  return `${html.trimEnd()}
${line}
`;
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export {
  ensureHtmlAssetReferences
};
