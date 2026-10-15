// Builds dist/ditherlab.html: one self-contained file with the CSS and all scripts inlined.
// Usage: node tools/build.js
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..');
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, p) => '<style>\n' + fs.readFileSync(path.join(root, p), 'utf8') + '\n</style>');
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, p) => {
  const code = fs.readFileSync(path.join(root, p), 'utf8');
  if (code.includes('</script>')) throw new Error(p + ' contains a closing script tag');
  return '<script>\n' + code + '\n</script>';
});
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'ditherlab.html'), html);
console.log('wrote dist/ditherlab.html (' + html.length + ' bytes)');
