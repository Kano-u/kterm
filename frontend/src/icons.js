/* Material Symbols 图标封装 */
import Icon from './components/Icon.vue'

export { Icon }

/* 文件列表图标：按类型区分 */
export function fileIcon(e) {
  if (e.isDir) return 'folder'
  if (/\.(png|jpe?g|gif|webp|bmp|svg|heic)$/i.test(e.name)) return 'image'
  return 'draft'
}
