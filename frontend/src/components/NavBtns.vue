<script setup>
import { activeTab } from '../store.js'
import { tabGo } from '../actions.js'
import Icon from './Icon.vue'

const tab = () => activeTab()
</script>

<template>
  <div class="pointer-events-none fixed right-3 bottom-[calc(env(safe-area-inset-bottom)+16px)] z-40 flex flex-col gap-3">
    <!-- M3 小型 FAB -->
    <button
      class="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary-container text-on-primary-container shadow-[0_3px_6px_rgba(0,0,0,0.15)] transition-opacity disabled:pointer-events-none disabled:opacity-35"
      title="后退"
      :disabled="tab().histIdx <= 0"
      @click="tabGo(-1)"
    >
      <Icon name="arrow_back" />
    </button>
    <button
      class="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-xl bg-primary-container text-on-primary-container shadow-[0_3px_6px_rgba(0,0,0,0.15)] transition-opacity disabled:pointer-events-none disabled:opacity-35"
      title="前进"
      :disabled="tab().histIdx >= tab().history.length - 1"
      @click="tabGo(1)"
    >
      <Icon name="arrow_forward" />
    </button>
  </div>
</template>
