<script setup>
/* SettingsView：底部任务栏「设置」进入的设置列表页。
 *
 * 这里只列出设置项（每项一行），点进去才是该设置项的独立页面，
 * 例如「键盘增强」→ KeyboardSettings.vue。返回由返回手势或子页返回按钮完成。
 */
import { settings } from '../settings.js'
import { openSettingsPage } from '../settingsnav.js'
import Icon from './Icon.vue'
</script>

<template>
  <main class="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface-1">
    <h1 class="px-4 pt-4 pb-2 text-[22px] text-on-surface">设置</h1>

    <ul class="flex flex-col gap-1 px-2">
      <li>
        <button
          class="state-layer flex w-full items-center gap-3 rounded-2xl bg-surface-2 px-3 py-3 text-left"
          @click="openSettingsPage('keyboard')"
        >
          <Icon name="keyboard" :size="22" class="flex-none text-primary" />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-[15px] text-on-surface">键盘增强</span>
            <span class="mt-0.5 block truncate text-[11px] text-on-surface-variant">
              {{ settings.keyBarEnabled ? '已开启 · 终端按键栏与按键布局' : '已关闭' }}
            </span>
          </span>
          <Icon name="chevron_right" :size="20" class="flex-none text-on-surface-variant" />
        </button>
      </li>
    </ul>

    <p class="px-4 py-3 text-[11px] leading-relaxed text-on-surface-variant/70">
      设置保存在根目录的 <code>.kfm-settings.json</code>（不会出现在文件列表中）。
    </p>
  </main>
</template>
