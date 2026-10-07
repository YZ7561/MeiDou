<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{
  content: string
}>()

// 给安全的 http(s) 链接统一加 target=_blank + rel，交给主进程用系统浏览器打开
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    const href = node.getAttribute('href') ?? ''
    if (/^https?:\/\//i.test(href)) {
      node.setAttribute('target', '_blank')
      node.setAttribute('rel', 'noopener noreferrer')
    } else {
      node.removeAttribute('target')
      node.removeAttribute('rel')
    }
  }
})

const renderedHtml = computed<string>(() => {
  const raw = props.content ?? ''
  if (!raw.trim()) return ''

  try {
    const html = marked.parse(raw, {
      gfm: true,
      breaks: true
    }) as string

    return DOMPurify.sanitize(html, {
      USE_PROFILES: { html: true }
    })
  } catch {
    return escapeHtml(raw)
  }
})

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
</script>

<template>
  <div class="md-body" v-html="renderedHtml"></div>
</template>
