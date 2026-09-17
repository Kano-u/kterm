/* 新建面板「常用扩展名」快捷块的回归测试（纯 node，无第三方依赖）：
 *   cd frontend && node test/nameext.test.mjs
 *
 * 手机上敲 `.json` 要在软键盘上切两次布局，所以给一排一点即得的扩展名。
 * 点击语义只有一条：**只把扩展名填进输入框，不创建任何东西**（创建仍旧由
 * 「文件」按钮触发），因此 applyExt 必须是可预测的纯字符串变换。
 *
 * 锁定三件事：
 *   1. 已有扩展名 → 替换；没有 → 追加；
 *   2. 隐藏文件名（.gitignore）与「目录名里的点」不被误判为扩展名；
 *   3. 光标落在主名末尾（不是整个字符串末尾），否则接着打名字会被打到扩展名后。
 */

const { applyExt, extStart, EXT_PRESETS } = await import('../src/nameext.js')

const assert = (cond, msg) => {
  if (!cond) {
    console.error('FAIL ' + msg)
    process.exitCode = 1
  } else console.log('ok   ' + msg)
}

/* ---------- 1. 快捷块集合 ---------- */
{
  assert(EXT_PRESETS.length === 5, '内置 5 个扩展名')
  assert(
    EXT_PRESETS.join(' ') === '.txt .md .json .py .css',
    '集合为 .txt .md .json .py .css',
  )
  assert(EXT_PRESETS.every((e) => e.startsWith('.')), '每个都带前导点（点一下即可用）')
  assert(new Set(EXT_PRESETS).size === EXT_PRESETS.length, '没有重复项')
  // 窄屏 360px 下一行放得下：块内文字约 4*7+13=41px，两字中文不会换行
  const widths = EXT_PRESETS.map((e) => [...e].reduce((a, c) => a + 7, 0))
  assert(widths.every((w) => w <= 42), '每个标签都很短（窄屏一行铺得下、不换行）')
}

/* ---------- 2. 追加（输入框为空 / 只有主名） ---------- */
{
  assert(applyExt('', '.md').value === '.md', "空输入 + .md → '.md'（先选扩展名再打名字）")
  assert(applyExt('', '.md').caret === 0, '光标停在点之前，接着打主名')
  assert(applyExt('note', '.md').value === 'note.md', "「note」+ .md → 'note.md'")
  assert(applyExt('note', '.md').caret === 4, '光标停在主名末尾（note|.md）')
  assert(applyExt('我的笔记', '.txt').value === '我的笔记.txt', '中文名同样追加')
  assert(applyExt('a b', '.json').value === 'a b.json', '带空格的名字不受影响')
}

/* ---------- 3. 替换已有扩展名 ---------- */
{
  assert(applyExt('note.txt', '.md').value === 'note.md', '替换已有扩展名')
  assert(applyExt('note.txt', '.md').caret === 4, '替换后光标仍在主名末尾')
  assert(applyExt('a.b.c', '.css').value === 'a.b.css', '只替换最后一段扩展名')
  assert(applyExt('note.TXT', '.md').value === 'note.md', '大写扩展名同样被替换（大小写不敏感）')
  assert(applyExt('note.', '.md').value === 'note.md', "末尾只有点（'note.'）也按替换处理")
  assert(applyExt('note.', '.md').caret === 4, '光标在点之前')
}

/* ---------- 4. 不把「不是扩展名」的东西当扩展名 ---------- */
{
  // 以点开头的隐藏文件名：整串都是主名，追加而不替换
  assert(extStart('.gitignore') === -1, '.gitignore 没有可替换的扩展名')
  assert(applyExt('.gitignore', '.md').value === '.gitignore.md',
    '隐藏文件名不被替换（否则会丢掉整个名字）')
  assert(applyExt('.env', '.txt').value === '.env.txt', '.env 同理')
  assert(extStart('') === -1, '空串没有扩展名')
  assert(extStart('note') === -1, '无点 → 没有扩展名')
  assert(extStart('.') === -1, '只有一个点 → 不视为扩展名')
  // 目录名里的点：点之后出现斜杠就不算扩展名
  assert(extStart('a.b/c') === -1, 'a.b/c 的点不是扩展名（点后有斜杠）')
  assert(applyExt('a.b/c', '.md').value === 'a.b/c.md', '这种情况按追加处理，不破坏路径')
  assert(extStart('a.b\\c') === -1, 'Windows 反斜杠同理')
  assert(extStart(null) === -1, 'null 不抛错')
  assert(extStart(undefined) === -1, 'undefined 不抛错')
}

/* ---------- 5. 幂等 / 连续点击 ---------- */
{
  // 连点两个扩展名：第二次替换第一次的结果，不会累积成 note.md.txt
  const once = applyExt('note', '.md')
  const twice = applyExt(once.value, '.txt')
  assert(twice.value === 'note.txt', '连续点击不同扩展名 → 互相替换，不累积')
  // 点同一个两次结果不变
  assert(applyExt(applyExt('note', '.py').value, '.py').value === 'note.py', '重复点同一个 → 幂等')
  // 从空输入连点：仍是单一扩展名
  assert(applyExt(applyExt('', '.txt').value, '.md').value === '.md', '先点再点也不累积')
}

/* ---------- 6. 异常输入不抛错（对话框兜底） ---------- */
{
  assert(applyExt(null, '.md').value === '.md', 'null 输入按空处理')
  assert(applyExt(undefined, '.md').value === '.md', 'undefined 输入按空处理')
  assert(applyExt('note', null).value === 'note', '扩展名为 null → 原样')
  assert(applyExt('note', '').value === 'note', '扩展名为空串 → 原样')
  assert(applyExt('note.txt', null).value === 'note', '扩展名缺失时仍按「替换」切掉旧扩展名')
  assert(applyExt('note.txt', null).caret === 4, '此时光标仍在主名末尾')
}

console.log(process.exitCode ? '\n有失败用例' : '\n全部通过')
