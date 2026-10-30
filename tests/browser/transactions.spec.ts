import { expect,test } from '@playwright/test';
const lot='20000000-0000-0000-0000-000000000701';
test.beforeEach(async({request})=>{await request.post('http://127.0.0.1:54399/_test/state',{data:{mode:'transactions'}});});
for(const width of [390,1280])test(`private address, order and message flows at ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await page.goto('/login?next=/account/addresses');
 await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Delivery Addresses',exact:true})).toBeVisible();
 for(const [label,value] of [['Full recipient name','Buyer'],['Address line 1','10 Example Road'],['Town / city','London'],['Postcode','SW1A 1AA'],['Country','United Kingdom']])await page.getByLabel(label,{exact:false}).fill(value);
 await page.getByRole('button',{name:'Save address',exact:true}).click();await expect(page.getByRole('heading',{name:'Buyer',exact:true})).toBeVisible();
 await page.goto(`/orders/${lot}`);await page.getByRole('button',{name:'Confirm order address'}).click();await expect(page.getByRole('heading',{name:'AWAITING DISPATCH'})).toBeVisible();await expect(page.getByText('Payment: not recorded.',{exact:false})).toBeVisible();
 await page.getByRole('button',{name:'Contact seller',exact:true}).click();await expect(page).toHaveURL(/messages\?conversation=/);
 await page.getByLabel('Message',{exact:true}).fill('Please confirm delivery arrangements.');await page.getByRole('button',{name:'Send message',exact:true}).click();await expect(page.getByText('Please confirm delivery arrangements.',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.goto(`/login?next=/orders/${lot}`);await page.getByLabel('Email',{exact:true}).fill('two@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();
 await expect(page.getByText('10 Example Road',{exact:false})).toBeVisible();await page.getByLabel('Courier / service',{exact:true}).fill('Royal Mail');await page.getByLabel('Tracking reference',{exact:true}).fill('TRACK123');await page.getByRole('combobox',{name:'Shipping status',exact:true}).selectOption('DISPATCHED');await page.getByRole('button',{name:'Save shipping update',exact:true}).click();await expect(page.getByRole('heading',{name:'DISPATCHED',exact:true})).toBeVisible();
 await expect(page.getByRole('link',{name:'Track with carrier',exact:false})).toHaveAttribute('href',/^https:\/\/www\.royalmail\.com\//);
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.goto(`/login?next=/orders/${lot}`);await page.getByLabel('Email',{exact:true}).fill('one@example.test');await page.getByLabel('Password',{exact:true}).fill('fixturepassword');await page.getByRole('button',{name:'Sign In',exact:true}).click();await page.getByRole('button',{name:'Confirm I have received this item',exact:true}).click();await expect(page.getByRole('heading',{name:'DELIVERED',exact:true})).toBeVisible();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});


