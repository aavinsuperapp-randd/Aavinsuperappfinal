const fs = require('fs');
const path = require('path');

function processHtmlFiles() {
    const htmlDir = path.join(__dirname, 'frontend', 'eo');
    if (!fs.existsSync(htmlDir)) return;
    const files = fs.readdirSync(htmlDir).filter(f => f.endsWith('.html'));
    
    for (const f of files) {
        const file = path.join(htmlDir, f);
        let content = fs.readFileSync(file, 'utf8');
        content = content.replace(/General Manager/g, 'Executive Officer');
        content = content.replace(/GM PORTAL/g, 'EO PORTAL');
        content = content.replace(/gm-sidebar/g, 'eo-sidebar');
        content = content.replace(/header-gm-name/g, 'header-eo-name');
        content = content.replace(/main-gm-content/g, 'main-eo-content');
        content = content.replace(/gm-api\.js/g, 'eo-api.js');
        content = content.replace(/gm-dashboard\.js/g, 'eo-dashboard.js');
        content = content.replace(/gm-qc-overview\.js/g, 'eo-qc-overview.js');
        content = content.replace(/gm-bmcs\.js/g, 'eo-bmcs.js');
        content = content.replace(/gm-bmc-profile\.js/g, 'eo-bmc-profile.js');
        content = content.replace(/<div class="header-avatar">GM<\/div>/g, '<div class="header-avatar">EO</div>');
        content = content.replace(/<a href="fleet\.html".*?<\/a>\r?\n?/g, '');
        content = content.replace(/<a href="analysis\.html".*?<\/a>\r?\n?/g, '');
        content = content.replace(/<a href="requirements\.html".*?<\/a>\r?\n?/g, '');
        content = content.replace(/<a href="issues\.html".*?<\/a>\r?\n?/g, '');
        fs.writeFileSync(file, content);
        console.log('Processed', file);
    }
}

function processJsFiles() {
    const jsDir = path.join(__dirname, 'frontend', 'js');
    if (!fs.existsSync(jsDir)) return;
    const files = fs.readdirSync(jsDir).filter(f => f.startsWith('eo-') && f.endsWith('.js'));
    
    for (const f of files) {
        const file = path.join(jsDir, f);
        let content = fs.readFileSync(file, 'utf8');
        content = content.replace(/'gm'/g, "'executive_officer'");
        content = content.replace(/"gm"/g, '"executive_officer"');
        content = content.replace(/GM PORTAL/g, 'EO PORTAL');
        content = content.replace(/main-gm-content/g, 'main-eo-content');
        content = content.replace(/header-gm-name/g, 'header-eo-name');
        content = content.replace(/gm-sidebar/g, 'eo-sidebar');
        content = content.replace(/gmFetch/g, 'eoFetch');
        fs.writeFileSync(file, content);
        console.log('Processed', file);
    }
}

processHtmlFiles();
processJsFiles();
