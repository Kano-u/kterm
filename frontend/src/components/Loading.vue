<script setup>
import { loading } from '../loading.js'
</script>

<template>
  <div
    v-if="loading.count > 0"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/25"
  >
    <div
      class="h-10 w-10 animate-spin rounded-full border-4 border-zinc-300 border-t-indigo-600 dark:border-zinc-600 dark:border-t-indigo-400"
    />
  </div>
</template>
