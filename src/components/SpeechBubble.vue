<script setup lang="ts">
defineProps<{
  text: string
  visible: boolean
}>()
</script>

<template>
  <Transition name="bubble">
    <p v-if="visible" class="speech-bubble">{{ text }}</p>
  </Transition>
</template>

<style scoped>
.speech-bubble {
  position: absolute;
  left: 50%;
  bottom: 190px;
  z-index: 2;
  display: block;
  width: calc(100% - 20px);
  max-width: 220px;
  min-height: 32px;
  max-height: 96px;
  margin: 0;
  padding: 7px 10px;
  border: 1px solid rgba(54, 91, 125, 0.32);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.94);
  color: #243041;
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-width: thin;
  box-shadow: 0 8px 18px rgba(30, 51, 68, 0.16);
  pointer-events: auto;
  transform: translateX(-50%);
  -webkit-app-region: no-drag;
}

.speech-bubble::-webkit-scrollbar {
  width: 0;
}

.speech-bubble::after {
  position: absolute;
  left: 50%;
  bottom: -6px;
  width: 10px;
  height: 10px;
  border-right: 1px solid rgba(54, 91, 125, 0.32);
  border-bottom: 1px solid rgba(54, 91, 125, 0.32);
  background: rgba(255, 255, 255, 0.94);
  content: "";
  transform: translateX(-50%) rotate(45deg);
}

.bubble-enter-active,
.bubble-leave-active {
  transition:
    opacity 180ms ease,
    transform 180ms ease;
}

.bubble-enter-from,
.bubble-leave-to {
  opacity: 0;
  transform: translateX(-50%) translateY(8px);
}
</style>
