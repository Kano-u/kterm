/* 路径语义的无依赖回归测试（纯 node）：
 *   cd frontend && node test/paths.test.mjs
 *
 * 覆盖「访问范围无限制」重构后的路径契约：
 *   1. 不区分绝对 / 相对路径的拼接（joinPath）；
 *   2. 上级目录 parentPath：'' 表示起始目录、'/' 与 'C:/' 是根（返回 null 禁用按钮）；
 *   3. 展示名 baseName：起始目录不叫「根目录」，而是起始目录的最后一段；
 *   4. 终端 cwd 绝对路径 → 展示路径（起始目录内用相对路径，之外用绝对路径）；
 *   5. 路径栏层级从文件系统根开始展开。
 */
const {
  state, isAbsPath, isWinAbs, joinPath, parentPath, baseName, applyListing, newTab,
} = await import('../src/store.js')
const { absToDisplay } = await import('../src/terminal.js')

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

/* ---------- 1. 绝对路径判定 / 拼接 ---------- */
{
  assert(isAbsPath('/sdcard') === true, 'POSIX 绝对路径')
  assert(isAbsPath('C:/Users') === true, 'Windows 盘符绝对路径')
  assert(isAbsPath('a/b') === false, '相对路径不是绝对路径')
  assert(isWinAbs('c:/x') === true, '盘符判定大小写不敏感')
  assert(isWinAbs('/x') === false, '/x 不是盘符路径')

  assert(joinPath('', 'a') === 'a', '起始目录下拼接')
  assert(joinPath('a', 'b') === 'a/b', '相对路径拼接')
  assert(joinPath('/sdcard', 'b') === '/sdcard/b', '绝对路径拼接')
  assert(joinPath('C:/', 'b') === 'C:/b', '盘符根拼接不留双斜杠')
}

/* ---------- 2. 上级目录 ---------- */
{
  assert(parentPath('') === null, "起始目录不能用 '' 表示无上级（会与根混淆）")
  assert(parentPath('a') === '', '单级相对路径的上级是起始目录')
  assert(parentPath('a/b') === 'a', '相对路径逐级向上')
  assert(parentPath('a/b/c') === 'a/b', '多级相对路径')
  assert(parentPath('/') === null, 'POSIX 根没有上级（禁用按钮）')
  assert(parentPath('/sdcard') === '/', '/sdcard 的上级是 /')
  assert(parentPath('/a/b') === '/a', 'POSIX 多级')
  assert(parentPath('C:/') === null, '盘符根没有上级')
  assert(parentPath('C:/Users') === 'C:/', '盘符下第一级的上级是 C:/')
  assert(parentPath('C:/Users/x') === 'C:/Users', '盘符多级')
  // 越出起始目录的相对路径也能继续向上（访问范围不受限）
  assert(parentPath('..') === '', "'..' 的上级是起始目录")
  assert(parentPath('../..') === '..', "'../..' 可以继续向上")
}

/* ---------- 3. 展示名 ---------- */
{
  state.startDir = '/home/kano/proj'
  assert(baseName('') === 'proj', "起始目录用自身的最后一段，而不是「根目录」")
  state.startDir = 'C:\\Users\\kano\\proj'
  assert(baseName('') === 'proj', 'Windows 起始目录同样取最后一段')
  state.startDir = ''
  assert(baseName('') === '起始目录', '起始目录未知时的兜底文案')
  assert(baseName('/sdcard') === 'sdcard', '绝对路径取最后一段')
  assert(baseName('a/b') === 'b', '相对路径取最后一段')
  assert(baseName('/') === '/', '文件系统根自身')
  assert(baseName('C:/') === 'C:', '盘符根自身')
  state.startDir = '/home/kano/proj'
}

/* ---------- 4. 终端 cwd → 展示路径 ---------- */
{
  const start = '/home/kano/proj'
  assert(absToDisplay('/home/kano/proj', start) === '', '起始目录本身 → 空路径')
  assert(absToDisplay('/home/kano/proj/a/b', start) === 'a/b', '起始目录内 → 相对路径')
  assert(absToDisplay('/sdcard/x', start) === '/sdcard/x', '起始目录外 → 绝对路径（不再被丢弃）')
  assert(absToDisplay('/home/kano/other', start) === '/home/kano/other', '同前缀的兄弟目录不被误判为子目录')
  // Windows：盘符大小写不一致时仍能识别为起始目录内
  assert(absToDisplay('c:\\Users\\kano\\proj\\a', 'C:\\Users\\kano\\proj') === 'a', 'Windows 分隔符与盘符大小写归一')
}

/* ---------- 5. 列表结果驱动路径栏层级 ---------- */
{
  const tab = newTab('')
  applyListing(tab, { path: 'sdcard/Download', abs: '/sdcard/Download', entries: [] })
  assert(tab.path === 'sdcard/Download' && tab.abs === '/sdcard/Download', '导航同时记录展示路径与绝对路径')
  const parts = tab.abs.split('/').filter(Boolean)
  assert(parts.join(',') === 'sdcard,Download', '绝对路径可逐级展开为面包屑')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')
