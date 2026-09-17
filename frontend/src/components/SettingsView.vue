<script setup>
/* SettingsView：底部任务栏的「设置」整页视图。
 *
 * 本期只有「键盘增强」一组：显示方式 + 按键布局文本（二维数组）。
 * 保存在服务端 <root>/.kfm-settings.json，成功后立即生效（终端无需重连）。
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue'
import {
  settings, keyRows, parseKeyText, rowsToText, saveSettings,
  DEFAULT_KEY_TEXT, KEY_BAR_MODES,
} from '../settings.js'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import Icon from './Icon.vue'

const text = ref(rowsToText(keyRows.value))
const error = ref('')
const saving = ref(false)
const mode = ref(settings.keyBarMode)

/* 用「解析成功后的规范化文本」比较，避免缩进/大小写差异造成假脏 */
const baseline = ref(rowsToText(keyRows.value))
const dirty = computed(() => text.value !== baseline.value || mode.value !== settings.keyBarMode)

/* 从服务端拉取完成后（App 启动异步）同步一次编辑器内容与显示方式；
 * 用户已改动时不覆盖。 */
watch(
  () => [settings.keys, settings.keyBarMode],
  () => {
    if (dirty.value) return
    const t = rowsToText(keyRows.value)
    text.value = t
    baseline.value = t
    mode.value = settings.keyBarMode
  },
  { deep: true },
)

/* 预览：解析文本框得到按键（失败则用当前生效的布局） */
const preview = computed(() => {
  const res = parseKeyText(text.value)
  return res.error ? keyRows.value : res.rows
})

const modeHint = computed(() => KEY_BAR_MODES.find((m) => m.value === mode.value)?.hint || '')

/* 未保存时离开页面给一次提示 */
function onBeforeUnload(ev) {
  if (!dirty.value) return
  ev.preventDefault()
  ev.returnValue = '设置尚未保存，确定离开吗？'
  return ev.returnValue
}

onMounted(() => window.addEventListener('beforeunload', onBeforeUnload))
onBeforeUnmount(() => window.removeEventListener('beforeunload', onBeforeUnload))

function onInput() {
  error.value = ''
}

async function onSave() {
  const res = parseKeyText(text.value)
  if (res.error) {
    error.value = res.error
    toast(res.error)
    return
  }
  saving.value = true
  try {
    await saveSettings({
      keys: res.rows.map((row) => row.map((k) => k.name)),
      keyBarMode: mode.value,
    })
    const normalized = rowsToText(res.rows)
    text.value = normalized
    baseline.value = normalized
    error.value = ''
    toast('设置已保存', 'ok')
  } catch (err) {
    error.value = err.message
    toast(err.message)
  } finally {
    saving.value = false
  }
}

async function onReset() {
  const ok = await confirm({
    title: '恢复默认设置',
    message: '将把按键布局恢复为默认的两行（ESC/TAB/CTRL/ALT/-/↑/ENTER 与 INS/END/SHIFT/:/←/↓/→）。',
    okText: '恢复默认',
  })
  if (!ok) return
  text.value = DEFAULT_KEY_TEXT
  mode.value = 'auto'
  error.value = ''
}
</script>

<template>
  <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface-1 px-3 py-4">
    <h1 class="mb-4 px-1 text-xl text-on-surface">设置</h1>

    <!-- 键盘增强 -->
    <section class="m3-elevate rounded-2xl bg-surface-2 p-4">
      <div class="mb-1 flex items-center gap-2">
        <Icon name="keyboard" :size="22" class="text-primary" />
        <h2 class="flex-1 text-base font-medium text-on-surface">键盘增强</h2>
      </div>
      <p class="mb-4 text-[12px] leading-relaxed text-on-surface-variant">
        终端视图下的额外按键栏：点击即向终端发送该键。CTRL / ALT / SHIFT 为粘滞修饰键，
        点亮后再点其他键即组合发送（如 CTRL → C），再点一次自己取消。
      </p>

      <!-- 显示方式 -->
      <div class="mb-1 text-[13px] text-on-surface-variant">显示方式</div>
      <div class="mb-1 flex flex-wrap gap-2">
        <button
          v-for="m in KEY_BAR_MODES"
          :key="m.value"
          class="state-layer flex h-9 flex-none items-center rounded-full px-3.5 text-[13px] transition-colors"
          :class="
            mode === m.value
              ? 'bg-primary-container font-medium text-on-primary-container'
              : 'bg-surface-3 text-on-surface-variant'
          "
          @click="mode = m.value"
        >
          {{ m.label }}
        </button>
      </div>
      <p class="mb-4 text-[12px] text-on-surface-variant/80">{{ modeHint }}</p>

      <!-- 布局文本 -->
      <div class="mb-1 text-[13px] text-on-surface-variant">按键布局</div>
      <p class="mb-2 text-[12px] leading-relaxed text-on-surface-variant/80">
        二维数组，外层每项一行。可用键名（大小写不敏感）：ESC TAB ENTER UP DOWN LEFT RIGHT
        INS DEL HOME END PGUP PGDN BACKSPACE SPACE CTRL ALT SHIFT，以及任意单字符
        （<code>-</code> <code>:</code> <code>a</code> …）。组合键写成 <code>"CTRL+C"</code>。
        未知名字按字面发送，所以 <code>"F1"</code> 会发送 <code>F1</code> 两个字符。
      </p>
      <textarea
        v-model="text"
        spellcheck="false"
        autocomplete="off"
        autocapitalize="off"
        rows="7"
        class="w-full resize-y rounded-xl bg-surface-3 p-3 font-mono text-[12px] leading-relaxed text-on-surface caret-primary outline-none focus:ring-2 focus:ring-primary/60"
        @input="onInput"
      />

      <p v-if="error" class="mt-1.5 text-[12px] text-error">{{ error }}</p>

      <!-- 预览 -->
      <div class="mt-3 mb-1 text-[13px] text-on-surface-variant">预览</div>
      <div class="rounded-xl bg-surface-3/60 p-2">
        <div
          v-for="(row, i) in preview"
          :key="i"
          class="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5"
        >
          <span
            v-for="(k, j) in row"
            :key="k.name + '-' + j"
            class="flex h-8 min-w-10 flex-none items-center justify-center rounded-lg px-2.5 text-[12px] font-medium"
            :class="k.mod ? 'bg-primary/20 text-primary' : 'bg-surface-3 text-on-surface'"
          >{{ k.label }}</span>
        </div>
      </div>

      <div class="mt-4 flex items-center justify-end gap-1">
        <span v-if="dirty" class="mr-auto pl-1 text-[12px] text-tertiary">有未保存的修改</span>
        <button
          class="state-layer flex h-10 flex-none items-center rounded-full px-4 text-sm text-on-surface-variant"
          :disabled="saving"
          @click="onReset"
        >
          恢复默认
        </button>
        <button
          class="state-layer flex h-10 flex-none items-center gap-1.5 rounded-full bg-primary px-4 text-sm font-medium text-on-primary transition-opacity disabled:pointer-events-none disabled:opacity-40"
          :disabled="saving || !dirty"
          @click="onSave"
        >
          <Icon name="save" :size="18" />
          保存
        </button>
      </div>
    </section>

    <p class="mt-3 px-1 text-[12px] leading-relaxed text-on-surface-variant/70">
      设置保存在根目录的 <code>.kfm-settings.json</code>（不会出现在文件列表中）。
    </p>
  </main>
</template>
