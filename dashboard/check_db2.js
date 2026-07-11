const fs = require('fs');
const path = require('path');

function walkDir(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(function(file) {
    file = path.join(dir, file);
    const stat = fs.statSync(file);
    if (stat && stat.isDirectory()) {
      results = results.concat(walkDir(file));
    } else {
      if (file.endsWith('.ts')) results.push(file);
    }
  });
  return results;
}

const files = walkDir('C:/Users/kakij/OneDrive/ドキュメント/多様化bot/dashboard/src/app/api/guilds');
for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  if (content.includes('parseInt(params.guild_id)')) {
    content = content.replace(/parseInt\(params\.guild_id\)/g, 'params.guild_id');
    content = content.replace(/if\s*\(isNaN\(guildId\)\)\s*return\s*NextResponse\.json\(\{\s*error:\s*'Invalid guild_id'\s*\},\s*\{\s*status:\s*400\s*\}\);/g, '');
    fs.writeFileSync(file, content);
    console.log('Fixed', file);
  }
}
