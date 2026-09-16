<script setup>
import { confirmState, closeConfirm } from '../confirm.js'
</script>

<template>
  <Teleport to="body">
    <div
      v-if="confirmState.show"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6"
      @click.self="closeConfirm(false)"
    >
      <div
        role="dialog"
        aria-modal="true"
        class="m3-pop w-full max-w-md rounded-[28px] bg-surface-2 p-6 shadow-[0_8px_32px_rgba(0,0,0,0.35)]"
      >
        <div class="mb-2 text-xl font-normal text-on-surface">{{ confirmState.title }}</div>
        <div class="whitespace-pre-line text-sm leading-relaxed text-on-surface-variant">
          {{ confirmState.message }}
        </div>
        <div class="mt-5 flex flex-wrap justify-end gap-2">
          <button
            class="state-layer flex h-11 flex-none items-center rounded-full px-4 text-sm font-medium text-primary"
            @click="closeConfirm(false)"
          >
            取消
          </button>
          <button
            v-if="confirmState.dangerText"
            class="state-layer flex h-11 flex-none items-center rounded-full bg-error px-4 text-sm font-medium text-on-error"
            @click="closeConfirm('danger')"
          >
            {{ confirmState.dangerText }}
          </button>
          <button
            class="state-layer flex h-11 flex-none items-center rounded-full bg-primary px-4 text-sm font-medium text-on-primary"
            @click="closeConfirm(true)"
          >
            {{ confirmState.okText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>
