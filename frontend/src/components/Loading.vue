<script setup>
import { loading } from '../loading.js'
</script>

<template>
  <div
    v-if="loading.count > 0"
    class="fixed inset-0 z-[60] flex items-center justify-center bg-black/20"
  >
    <!-- M3 圆形进度指示器（激活态主色） -->
    <div
      class="h-10 w-10 animate-spin rounded-full border-4 border-primary-container border-t-primary"
      role="progressbar"
    />
  </div>
</template>
