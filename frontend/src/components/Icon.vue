<script setup>
const props = defineProps({
  name: { type: String, required: true },
  size: { type: [Number, String], default: 24 },
  filled: { type: Boolean, default: false },
})
</script>

<template>
  <span
    class="material-symbols-outlined select-none leading-none"
    :class="{ 'icon-fill': filled || $attrs.class?.includes?.('icon-active') }"
    :style="{ fontSize: typeof size === 'number' ? size + 'px' : size, width: typeof size === 'number' ? size + 'px' : size }"
  >{{ name }}</span>
</template>

<style scoped>
.icon-fill {
  font-variation-settings: 'FILL' 1;
}
</style>
