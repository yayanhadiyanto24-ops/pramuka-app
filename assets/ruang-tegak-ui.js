/* Penanda aktif berpindah ke tombol terakhir yang dipilih dalam kelompoknya. */
(()=>{if(window.__rtButtonStateReady)return;window.__rtButtonStateReady=true;
const eligible=e=>e instanceof Element&&e.matches('button:not(.signature-control):not(#clearSignature):not(:disabled),[role="button"]:not([aria-disabled="true"]),[role="tab"]');
document.addEventListener('click',event=>{
 const target=event.target instanceof Element?event.target.closest('button,[role="button"],[role="tab"]'):null;
 if(!target||!eligible(target))return;
 if(target.matches('.danger,.btn-danger,.delete,.remove,[data-variant="danger"]'))return;
 const group=target.closest('[role="tablist],nav,[data-button-group],.button-group,.tabs')||target.parentElement;
 if(group){group.querySelectorAll('button.rt-button-active,[role="button"].rt-button-active,[role="tab"].rt-button-active').forEach(item=>item.classList.remove('rt-button-active'));}
 target.classList.add('rt-button-active');
},true);
})();