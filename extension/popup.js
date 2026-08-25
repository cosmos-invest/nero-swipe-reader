'use strict';
document.getElementById('openReader').addEventListener('click',async()=>{await browser.runtime.sendMessage({type:'NERO_OPEN_READER'});window.close();});
document.getElementById('openNeroReader').addEventListener('click',async()=>{await browser.runtime.sendMessage({type:'NERO_OPEN_NERO_READER'});window.close();});
document.getElementById('openLogin').addEventListener('click',async()=>{await browser.runtime.sendMessage({type:'NERO_OPEN_NOTE_LOGIN'});window.close();});
