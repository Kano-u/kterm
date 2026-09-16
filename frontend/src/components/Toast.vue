<script setup>
import { toastState } from '../toast.js'
</script>

<template>
  <div
    v-if="toastState.show"
    class="toast-anim fixed left-1/2 z-[70] max-w-[90vw] -translate-x-1/2 rounded-xl px-4 py-2.5 text-sm text-white shadow-lg"
    :class="toastState.type === 'ok' ? 'bg-emerald-600' : 'bg-zinc-800 dark:bg-zinc-700'"
    :style="{ bottom: 'calc(24px + env(safe-area-inset-bottom))' }"
    role="status"
  >
    {{ toastState.msg }}
  </div>
</template>
