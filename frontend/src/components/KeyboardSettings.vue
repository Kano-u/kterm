<script setup>
/* KeyboardSettings：设置 → 键盘增强 的独立页面。
 *
 * 底部「设置」进来的是设置列表页，点「键盘增强」才打开本页。
 * 左上角返回按钮与安卓返回手势等价（都走 history，由 settingsnav.js 统一落实层级）。
 */
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import {
  settings, keyRows, parseKeyText, rowsToText, saveSettings,
  DEFAULT_KEY_TEXT,
} from '../settings.js'
import { backSettings, setSettingsGuard } from '../settingsnav.js'
import { toast } from '../toast.js'
import { confirm } from '../confirm.js'
import Icon from './Icon.vue'

const text = ref(rowsToText(keyRows.value))
const baseText = ref(rowsToText(keyRows.value))
const baseEnabled = ref(settings.keyBarEnabled)
const enabled = ref(settings.keyBarEnabled)
const error = ref('')
const saving = ref(false)

/* 与服务端「校验后的规范化文本」比较，避免缩进/大小写差异造成假脏 */
const dirty = computed(
  () => text.value !== baseText.value || enabled.value !== baseEnabled.value,
)

/* 服务端设置到达后（启动异步）同步编辑器内容；用户已改动时不覆盖 */
watch(
  () => [settings.keys, settings.keyBarEnabled],
  () => {
    if (dirty.value) return
    const t = rowsToText(keyRows.value)
    text.value = t
    baseText.value = t
    enabled.value = settings.keyBarEnabled
    baseEnabled.value = settings.keyBarEnabled
  },
  { deep: true },
)

/* 预览：解析文本框得到按键（失败则用当前生效的布局） */
const preview = computed(() => {
  const res = parseKeyText(text.value)
  return res.error ? keyRows.value : res.rows
})

/* 返回时若有未保存改动，先问一句（返回按钮与返回手势都经过这里） */
async function guardLeave() {
  if (!dirty.value) return true
  return await confirm({
    title: '放弃未保存的修改？',
    message: '键盘增强的设置尚未保存，返回后这些修改将丢失。',
    okText: '放弃修改',
  })
}

/* 刷新/关闭页面时也拦一次 */
function onBeforeUnload(ev) {
  if (!dirty.value) return
  ev.preventDefault()
  ev.returnValue = '设置尚未保存，确定离开吗？'
  return ev.returnValue
}

onMounted(() => {
  setSettingsGuard(guardLeave)
  window.addEventListener('beforeunload', onBeforeUnload)
})
onUnmounted(() => {
  setSettingsGuard(null)
  window.removeEventListener('beforeunload', onBeforeUnload)
})

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
      keyBarEnabled: enabled.value,
    })
    const normalized = rowsToText(res.rows)
    text.value = normalized
    baseText.value = normalized
    baseEnabled.value = enabled.value
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
    title: '恢复默认布局',
    message: '将把按键布局恢复为默认两行：ESC/TAB/CTRL/ALT/-/↑/ENTER 与 INS/END/SHIFT/:/←/↓/→。',
    okText: '恢复默认',
  })
  if (!ok) return
  text.value = DEFAULT_KEY_TEXT
  enabled.value = true
  error.value = ''
}
</script>

<template>
  <main class="flex min-h-0 flex-1 flex-col overflow-hidden bg-surface-1">
    <!-- 顶部栏：返回 + 标题 + 保存 -->
    <header class="flex flex-none items-center gap-1 border-b border-outline-variant/40 px-1.5 py-1">
      <button
        class="state-layer flex h-9 w-9 flex-none items-center justify-center rounded-full text-on-surface"
        title="返回"
        aria-label="返回"
        @click="backSettings"
      >
        <Icon name="arrow_back" :size="20" />
      </button>
      <span class="min-w-0 flex-1 truncate px-1 text-[15px] text-on-surface">键盘增强</span>
      <span v-if="dirty" class="flex-none pr-1 text-[11px] text-tertiary">未保存</span>
      <button
        class="state-layer flex h-9 flex-none items-center gap-1.5 rounded-full bg-primary px-3.5 text-[13px] font-medium text-on-primary transition-opacity disabled:pointer-events-none disabled:opacity-40"
        :disabled="saving || !dirty"
        @click="onSave"
      >
        <Icon name="save" :size="16" />
        保存
      </button>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
      <!-- 总开关 -->
      <div class="flex items-center gap-2 rounded-2xl bg-surface-2 px-3 py-2.5">
        <span class="min-w-0 flex-1">
          <span class="block text-[15px] text-on-surface">启用按键栏</span>
          <span class="mt-0.5 block text-[11px] leading-relaxed text-on-surface-variant">
            终端视图下弹出软键盘时，底部显示按键栏（顶替「文件/终端/设置」）
          </span>
        </span>
        <button
          class="state-layer relative h-7 w-12 flex-none rounded-full transition-colors"
          :class="enabled ? 'bg-primary' : 'bg-surface-3'"
          role="switch"
          :aria-checked="enabled"
          :title="enabled ? '关闭按键栏' : '开启按键栏'"
          @click="enabled = !enabled"
        >
          <span
            class="absolute top-1 h-5 w-5 rounded-full transition-all"
            :class="enabled ? 'left-6 bg-on-primary' : 'left-1 bg-on-surface-variant'"
          />
        </button>
      </div>

      <!-- 布局说明 -->
      <div class="mt-3 rounded-2xl bg-surface-2 px-3 py-3">
        <div class="mb-1.5 text-[13px] text-on-surface">按键布局</div>
        <p class="mb-2.5 text-[11px] leading-relaxed text-on-surface-variant">
          二维数组，外层每项一行。可用键名（大小写不敏感）：ESC TAB ENTER UP DOWN LEFT RIGHT
          INS DEL HOME END PGUP PGDN BACKSPACE SPACE CTRL ALT SHIFT，以及任意单字符
          （<code>-</code> <code>:</code> <code>a</code> …）。组合键写成
          <code>"CTRL+C"</code>；未知名字按字面发送（<code>"F1"</code> 发送
          <code>F1</code> 两个字符）。
        </p>
        <textarea
          v-model="text"
          spellcheck="false"
          autocomplete="off"
          autocapitalize="off"
          rows="7"
          class="w-full resize-y rounded-xl bg-surface-3 p-2.5 font-mono text-[11px] leading-relaxed text-on-surface caret-primary outline-none focus:ring-2 focus:ring-primary/60"
          @input="(error = '')"
        />
        <p v-if="error" class="mt-1.5 text-[12px] text-error">{{ error }}</p>

        <!-- 预览 -->
        <div class="mt-3 mb-1.5 text-[13px] text-on-surface">预览</div>
        <div class="rounded-xl bg-surface-3/60 p-1.5">
          <div v-for="(row, i) in preview" :key="i" class="flex items-stretch gap-0.5 py-0.5">
            <span
              v-for="(k, j) in row"
              :key="k.name + '-' + j"
              class="flex h-7 min-w-0 flex-1 basis-0 items-center justify-center overflow-hidden rounded-md px-0.5 text-[11px] font-medium whitespace-nowrap"
              :class="k.mod ? 'bg-primary/25 text-primary' : 'bg-surface-3 text-on-surface'"
            >
              <span class="truncate">{{ k.label }}</span>
            </span>
          </div>
        </div>
        <p class="mt-2 text-[11px] leading-relaxed text-on-surface-variant/80">
          CTRL / ALT / SHIFT 为粘滞修饰键：点亮后再点其他键即组合发送（如 CTRL → C），再点一次自己取消。
        </p>
      </div>

      <div class="mt-3 flex justify-end">
        <button
          class="state-layer flex h-9 flex-none items-center rounded-full px-3.5 text-[13px] text-on-surface-variant"
          @click="onReset"
        >
          恢复默认布局
        </button>
      </div>

      <p class="px-1 pb-1 text-[11px] leading-relaxed text-on-surface-variant/70">
        设置保存在根目录的 <code>.kfm-settings.json</code>（不会出现在文件列表中）。
      </p>
    </div>
  </main>
</template>
