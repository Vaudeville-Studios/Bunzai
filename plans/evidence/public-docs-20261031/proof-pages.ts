import {chromium} from "playwright-core";
type ResponsiveLayout={viewport:number;pageWidth:number;sidebar:{x:number;y:number;bottom:number;width:number};article:{x:number;y:number;bottom:number;width:number};toc:{x:number;y:number;bottom:number;width:number};navHeight:number;navContentHeight:number};
const browser=await chromium.launch({headless:true,executablePath:chromium.executablePath()});
const origin=process.env.DOCS_PREVIEW_ORIGIN??"http://127.0.0.1:18877";
try {
 const page=await browser.newPage({viewport:{width:1365,height:900},deviceScaleFactor:1});
 const errors:string[]=[]; const blocked:string[]=[]; const offOrigin:string[]=[];
 page.on("pageerror",e=>errors.push(e.message));
 page.on("request",request=>{if(new URL(request.url()).origin!==new URL(origin).origin)offOrigin.push(request.url());});
 await page.route("https://api.github.com/**",async route=>{blocked.push(route.request().url());await route.abort("blockedbyclient");});
 await page.goto(`${origin}/Bunzai/`,{waitUntil:"networkidle"});
 const home={title:await page.title(),docsLink:await page.getByRole("link",{name:/docs/i}).count(),star:await page.getByRole("link",{name:/star/i}).count()};
 await page.getByRole("link",{name:/docs/i}).first().click();
 await page.waitForURL(/\/Bunzai\/docs\/index\.html/);
 const docsIndex={title:await page.title(),pages:await page.locator(".docs-sidebar nav a").count(),searchStatus:await page.locator("[data-doc-search-status]").textContent()};
 const input=page.getByRole("searchbox",{name:"Search docs"}); await input.fill("Bun 1.3.14");
 await page.waitForFunction(()=>document.querySelectorAll("[data-doc-search-results] a").length>0);
 const searchCount=await page.locator("[data-doc-search-results] a").count();
 await page.screenshot({path:"plans/evidence/public-docs-20261031/pages-docs-index.png",fullPage:true});
 await page.goto(`${origin}/Bunzai/docs/guide/installation.html#doc-run-from-source`,{waitUntil:"networkidle"});
 const install={title:await page.title(),heading:await page.locator("#doc-run-from-source").count(),image:await page.locator("img[alt*=first-run]").count(),allLocalLinks:await page.locator("a[href^='/Bunzai/docs/']").count()};
 await page.screenshot({path:"plans/evidence/public-docs-20261031/pages-installation.png",fullPage:true});
 await page.goto(`${origin}/Bunzai/docs/guide/installation.html`,{waitUntil:"networkidle"});
 const layouts:ResponsiveLayout[]=[];
 for(const width of [375,768,1440]) {
  await page.setViewportSize({width,height:900});
  await page.evaluate(()=>window.scrollTo(0,0));
  const layout=await page.locator(".docs-layout").evaluate(node=>{
   const box=(selector:string)=>{const rect=node.querySelector(selector)!.getBoundingClientRect();return{x:rect.x,y:rect.y,bottom:rect.bottom,width:rect.width};};
   const nav=node.querySelector(".docs-sidebar nav")!;
   return{viewport:document.documentElement.clientWidth,pageWidth:document.documentElement.scrollWidth,sidebar:box(".docs-sidebar"),article:box(".docs-article"),toc:box(".docs-toc"),navHeight:nav.clientHeight,navContentHeight:nav.scrollHeight};
  });
  layouts.push(layout);
  await page.screenshot({path:`plans/evidence/public-docs-20261031/pages-${width}.png`});
 }
 const result={home,docsIndex,searchCount,install,layouts,blocked,offOrigin,errors};console.log(JSON.stringify(result,null,2));
 const mobile=layouts[0]!;const desktop=layouts[2]!;
 if(mobile.pageWidth>mobile.viewport||mobile.article.y<mobile.sidebar.bottom-1||mobile.navHeight>260||mobile.navContentHeight<=mobile.navHeight)throw new Error("mobile Docs layout did not stack or bound the page list");
 if(desktop.pageWidth>desktop.viewport||desktop.article.x<=desktop.sidebar.x||desktop.toc.x<=desktop.article.x)throw new Error("desktop Docs columns did not remain side by side");
 if(home.docsLink===0||docsIndex.pages<140||searchCount===0||install.heading!==1||errors.length||offOrigin.length)throw new Error("Pages browser proof failed");
} finally {await browser.close();}
