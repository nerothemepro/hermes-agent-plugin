#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, 'record-one-spine.js'), 'utf8');

assert.match(source, /width:\s*2560,\s*height:\s*1440/);
assert.match(source, /recordVideo/);
assert.match(source, /fs\.openSync\(path\.join\(logsDir, name \+ '\.log'\), 'a'\)/);
assert.match(source, /fs\.closeSync\(server\.fd\)/);
assert.match(source, /sdtk-design/);
assert.match(source, /await locator\.isVisible\(\)/);
assert.doesNotMatch(source, /process\.exit\(2\)/);
assert.match(source, /const atlasUrl = kanbanUrl/);
assert.match(source, /data-panel=\"graph\"/);
assert.match(source, /Open Full Detail/);
assert.match(source, /graph-focus-doc-title/);
assert.match(source, /#graph-search-results \.result-item/);
assert.match(source, /data-panel=\"docs\"/);
assert.doesNotMatch(source, /\[\x27#graph-toolbar-peek\x27, \x27#graph-toolbar-toggle\x27\]/);
assert.ok(source.indexOf('const kanbanUrl') < source.indexOf('const atlasUrl = kanbanUrl'));
assert.doesNotMatch(source, /sdtk-wiki', \['atlas', 'open'/);
assert.match(source, /sdtk-wiki', \['kanban'/);
assert.match(source, /one-spine-terminal\.sh/);
assert.match(source, /Output .*JSON\.stringify\(output\)/);
assert.match(source, /VHS_NO_SANDBOX/);
assert.match(source, /JSON\.stringify\(\"bash \" \+ helper\)/);
assert.match(source, /graph-docs/);
assert.match(source, /design\.mp4/);
assert.match(source, /gallery\.mp4/);
assert.match(source, /ask\.mp4/);
assert.match(source, /kanban\.mp4/);
assert.match(source, /terminal\.mp4/);
assert.doesNotMatch(source, /sdtk-agent.?dashboard/i);

process.stdout.write('one spine recorder contract: OK\n');
