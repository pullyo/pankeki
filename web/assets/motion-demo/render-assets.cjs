'use strict';
// Original SVG artwork -> real RGBA PNG through the already installed browser.
const fs=require('node:fs'),path=require('node:path');
const {chromium}=require('C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');
const dir=__dirname, names=['background','body','eyes','mouth'];
(async()=>{
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking']});
 try{
  const page=await browser.newPage();
  const source={};
  for(const name of names){
   source[name]=fs.readFileSync(path.join(dir,name+'.svg'),'utf8');
   const png=await page.evaluate(async svg=>{
    const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));await image.decode();
    const c=document.createElement('canvas');c.width=image.naturalWidth;c.height=image.naturalHeight;c.getContext('2d').drawImage(image,0,0);return c.toDataURL('image/png').split(',')[1];
   },source[name]);
   fs.writeFileSync(path.join(dir,name+'.png'),Buffer.from(png,'base64'));
  }
  const data=Object.fromEntries(names.map(name=>[name,'data:image/png;base64,'+fs.readFileSync(path.join(dir,name+'.png')).toString('base64')]));
  const composite=await page.evaluate(async data=>{
   const images={};for(const [name,url]of Object.entries(data)){const i=new Image();i.src=url;await i.decode();images[name]=i;}
   const c=document.createElement('canvas');c.width=c.height=640;const ctx=c.getContext('2d');
   ctx.drawImage(images.background,0,0);ctx.drawImage(images.body,100,125);ctx.drawImage(images.eyes,240,319);ctx.drawImage(images.mouth,286,369,68,8);
   return c.toDataURL('image/png').split(',')[1];
  },data);
  fs.writeFileSync(path.join(dir,'source.png'),Buffer.from(composite,'base64'));
  const inner=svg=>svg.replace(/^<svg\b[^>]*>/,'').replace(/<\/svg>\s*$/,'');
  const master=`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="640" viewBox="0 0 640 640"><title>Pankeki original layered pancake character — editable design master</title><g id="clean-background">${inner(source.background)}</g><g id="body" transform="translate(100 125)">${inner(source.body)}</g><g id="eyes" transform="translate(240 319)">${inner(source.eyes)}</g><g id="mouth-default" transform="translate(286 369) scale(1 ${8/36})">${inner(source.mouth)}</g></svg>`;
  fs.writeFileSync(path.join(dir,'source-design.svg'),master);
  console.log(JSON.stringify({rendered:[...names,'source'].map(name=>name+'.png'),method:'SVG rasterized to Canvas RGBA PNG; default source composed from actual prepared PNG layers.'}));
 }finally{await browser.close();}
})();
