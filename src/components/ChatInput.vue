<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  pending: boolean
}>()

const emit = defineEmits<{
  close: []
  submit: [text: string]
}>()

const text = ref('')
const inputRef = ref<HTMLInputElement | null>(null)

function submitText(): void {
  const value = text.value.trim()
  if (!value || props.pending) return

  emit('submit', value)
  text.value = ''
}

watch(
  () => props.visible,
  async (visible) => {
    if (!visible) return

    await nextTick()
    inputRef.value?.focus()
  },
  { immediate: true }
)
</script>

<template>
  <form v-if="visible" class="chat-input" @submit.prevent="submitText">
    <input
      ref="inputRef"
      v-model="text"
      class="chat-input__field"
      type="text"
      placeholder="和 MeiDou 说点什么"
      maxlength="80"
      autocomplete="off"
      @keydown.enter.prevent="submitText"
    />
    <button class="chat-input__send" type="submit" :disabled="pending">发送</button>
    <button class="chat-input__close" type="button" aria-label="关闭聊天输入框" @click="emit('close')">
      X
    </button>
  </form>
</template>

<style scoped>
.chat-input {
  position: absolute;
  left: 50%;
  bottom: 0;
  z-index: 3;
  display: flex;
  width: calc(100% - 14px);
  max-width: 226px;
  min-height: 34px;
  max-height: 70px;
  align-items: center;
  gap: 4px;
  padding: 4px;
  border: 1px solid rgba(54, 91, 125, 0.28);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.94);
  box-shadow: 0 8px 18px rgba(30, 51, 68, 0.16);
  transform: translateX(-50%);
  -webkit-app-region: no-drag;
}

.chat-input__field {
  min-width: 0;
  flex: 1;
  height: 24px;
  border: 1px solid rgba(61, 52, 84, 0.22);
  border-radius: 5px;
  padding: 0 6px;
  background: rgba(255, 255, 255, 0.96);
  color: #243041;
  font-size: 12px;
  line-height: 24px;
  outline: none;
}

.chat-input__field:focus {
  border-color: rgba(198, 95, 141, 0.62);
  box-shadow: 0 0 0 2px rgba(198, 95, 141, 0.14);
}

.chat-input__field::placeholder {
  color: rgba(36, 48, 65, 0.48);
}

.chat-input__send,
.chat-input__close {
  height: 24px;
  border: 0;
  border-radius: 5px;
  color: #243041;
  font-size: 12px;
  line-height: 24px;
  cursor: pointer;
  flex: 0 0 auto;
}

.chat-input__send {
  min-width: 40px;
  padding: 0 7px;
  background: #ffd6b8;
}

.chat-input__send:hover {
  background: #ffc79f;
}

.chat-input__close {
  width: 24px;
  padding: 0;
  background: rgba(80, 96, 119, 0.12);
}

.chat-input__close:hover {
  background: rgba(80, 96, 119, 0.2);
}
</style>
