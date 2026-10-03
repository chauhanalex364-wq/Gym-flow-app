const CACHE='gymflow-shell-v4';
const APP_SHELL=['./','./index.html','./styles.css','./app.js','./manifest.json','./icon.svg','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP_SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  const url=new URL(req.url);
  if(url.origin===self.location.origin){
    event.respondWith(caches.match(req).then(cached=>cached||fetch(req).then(res=>{const copy=res.clone();caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{});return res}).catch(()=>caches.match('./index.html'))));
  }
});
self.addEventListener('push',event=>{
  let data={title:'GymFlow',body:'You have a new gym update.',url:'./',icon:'./icon-192.png',badge:'./icon-192.png',tag:'gymflow'};
  try{data={...data,...(event.data?event.data.json():{})}}catch(e){try{data.body=event.data.text()}catch(_) {}}
  event.waitUntil(self.registration.showNotification(data.title,{body:data.body,icon:data.icon,badge:data.badge||data.icon,data:{url:data.url||'./',notificationId:data.notificationId,kind:data.kind},tag:data.tag||'gymflow',renotify:true,vibrate:[80,40,80]}));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  event.waitUntil((async()=>{
    const target=new URL(event.notification.data?.url||'./',self.location.origin).href;
    const list=await clients.matchAll({type:'window',includeUncontrolled:true});
    for(const c of list){if('focus' in c){c.postMessage({type:'OPEN_NOTIFICATION',notification:event.notification.data||{}});return c.focus();}}
    if(clients.openWindow)return clients.openWindow(target);
  })());
});
