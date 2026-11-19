import {chromium} from '@playwright/test';
const browser=await chromium.launch({headless:true});
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const healthResponse=page.waitForResponse(response=>response.url().endsWith('/api/health')&&response.status()===200);
  await page.goto('http://127.0.0.1:3000');
  await page.locator('aside nav').getByRole('button',{name:'Settings',exact:true}).click();
  await page.getByRole('heading',{name:'Preferred export folder',exact:true}).waitFor();
  await page.getByRole('heading',{name:'YouTube account (optional)',exact:true}).waitFor();
  const version=await(await page.request.get('http://127.0.0.1:3000/api/version')).json();
  if(version.version!=='1.11.7' || errors.length)throw new Error(JSON.stringify({version,errors}));
  const health=await(await healthResponse).json();
  if(!health.ffmpeg || !health.python)throw new Error('Required media engines are unavailable');
  await page.getByText('Ready',{exact:true}).first().waitFor();
  await page.screenshot({path:'verification/snap-ninja-regression/running-settings.png',fullPage:true});
  console.log(JSON.stringify({version:version.version,runtimeErrors:errors,settingsReady:true}));
}finally{await browser.close();}

