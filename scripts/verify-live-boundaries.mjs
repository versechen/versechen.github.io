import assert from 'node:assert/strict';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.env.PREVIEW_URL||'http://127.0.0.2:4322';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox']});
const page=await browser.newPage();
await page.goto(base+'/editor-preview/');
const replacement='替换后的 **海边写作**。';
const cases=[['heading','## 从一个小想法开始\n\n后续正文。','h2'],['list','- 第一项\n- 第二项','ul'],['code','```js\nconst answer = 42;\n```','pre']];
for(const [name,next,selector] of cases){
 for(const separator of ['\n\n','\n\n\n']){
  await page.locator('#demo-source').click();
  const original='# 前文\n\n待替换段落。'+separator+next+'\n';
  const expected='# 前文\n\n'+replacement+separator+next+'\n';
  await page.locator('#demo-body').fill(original);
  await page.locator('#demo-live').click();
  await page.locator('#demo-rendered p').filter({hasText:'待替换段落。'}).click();
  await page.locator('.notes-live__input').fill(replacement);
  // Source must be valid even before commit: autosave consumes every input.
  assert.equal(await page.locator('#demo-body').inputValue(),expected,`${name}: input boundary`);
  await page.locator('.notes-live__input').press('Control+Enter');
  assert.equal(await page.locator('#demo-body').inputValue(),expected,`${name}: commit boundary`);
  assert.equal(await page.locator('#demo-rendered '+selector).count(),1);
  await page.locator('#demo-undo').click();assert.equal(await page.locator('#demo-body').inputValue(),original);
  await page.locator('#demo-redo').click();assert.equal(await page.locator('#demo-body').inputValue(),expected);
  await page.locator('#demo-source').click();assert.equal(await page.locator('#demo-body').inputValue(),expected);
  await page.locator('#demo-live').click();assert.equal(await page.locator('#demo-body').inputValue(),expected);
 }
}
console.log('PASS paragraph replacement without trailing newline before heading/list/code; exact separators, input autosave source, commit, undo/redo and source roundtrip (6 cases)');
await browser.close();
