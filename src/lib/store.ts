export const storeScript = `
  const KEY = 'campuscare:v1';
  function getState(){try{const saved=JSON.parse(localStorage.getItem(KEY)||'{}');return {user:saved.mode==='api'?saved.user||null:null,mode:saved.mode==='api'?'api':null}}catch{return {user:null,mode:null}}}
  function saveState(state){localStorage.setItem(KEY,JSON.stringify({user:state.user||null,mode:state.user?'api':null}));return state}
  async function logout(){await fetch('/api/auth/logout',{method:'POST',credentials:'same-origin'}).catch(()=>{});localStorage.removeItem(KEY);location.replace('/login')}
  function escapeHtml(value){return String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]))}
  window.CampusCare={getState,saveState,escapeHtml,logout};
`;
