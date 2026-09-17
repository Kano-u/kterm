<script setup>
import { toastState } from '../toast.js'
import Icon from './Icon.vue'
</script>

<template>
  <div
    v-if="toastState.show"
    class="m3-elevate fixed left-1/2 z-[70] flex max-w-[90vw] -translate-x-1/2 items-center gap-2 rounded-lg px-3.5 py-2.5 text-[13px] shadow-[0_3px_10px_rgba(0,0,0,0.2)]"
    :class="
      toastState.type === 'ok'
        ? 'bg-inverse-surface text-inverse-on-surface'
        : 'bg-error-container text-on-error-container'
    "
    :style="{ bottom: 'calc(24px + env(safe-area-inset-bottom))' }"
    role="status"
  >
    <Icon :name="toastState.type === 'ok' ? 'check_circle' : 'error'" :size="20" />
    <span class="min-w-0 break-all">{{ toastState.msg }}</span>
  </div>
</template>
